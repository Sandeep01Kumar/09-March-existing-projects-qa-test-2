/**
 * server.js — Express application bootstrap and lifecycle manager.
 *
 * This module is the entry point for both local development (`node server.js`
 * / `npm start` / `npm run dev`) and production deployment under PM2
 * (`pm2 start ecosystem.config.js --env production`). It supersedes the
 * legacy Python Flask implementation that previously lived in `app.py`,
 * preserving the byte-exact HTTP response contract that the Backprop
 * integration test fixture depends on (per AAP §0.7.2 Rule R-001):
 *
 *     - Status:       200
 *     - Headers:      Content-Type: text/plain   (NO `; charset=utf-8` suffix)
 *     - Body:         "Hello, World!\n"          (14 bytes, terminating 0x0A)
 *
 * The response contract itself is implemented inside `routes/index.js`; this
 * file is responsible only for composing the Express application, wiring up
 * middleware in the canonical order, binding the HTTP listener, and managing
 * the process lifecycle.
 *
 * Responsibilities (per AAP §0.5.1, §0.5.3, §0.6.1, §0.6.2):
 *   1. Load environment variables from `.env` via dotenv as the VERY FIRST
 *      statement so that downstream modules (especially `./config`) read
 *      already-populated `process.env.*` values.
 *   2. Instantiate the Express application factory.
 *   3. Disable the `X-Powered-By` response header (security hygiene).
 *   4. Enable `trust proxy` when running under production (so client IP
 *      derivation works correctly behind a reverse proxy).
 *   5. Register middleware in the canonical Express ordering:
 *        helmet -> compression -> express.json -> express.urlencoded
 *        -> requestLogger -> routes -> notFoundHandler -> errorHandler
 *   6. Bind the HTTP listener to `config.host:config.port`.
 *   7. Emit the PM2 `ready` signal (gated on `process.send` so direct `node`
 *      execution does not crash).
 *   8. Register `SIGINT` and `SIGTERM` handlers for graceful shutdown.
 *   9. Register `uncaughtException` / `unhandledRejection` safety nets that
 *      log the failure and trigger the same graceful shutdown sequence.
 *
 * Critical Rules (per the agent prompt's Phase 10 and AAP Rules R-001..R-012):
 *   - `require('dotenv').config()` MUST be the first statement.
 *   - Middleware order is fixed; reordering breaks the security / logging /
 *     error semantics defined in the AAP.
 *   - `app.disable('x-powered-by')` is mandatory for security hygiene.
 *   - The `process.send('ready')` call MUST be guarded by `if (process.send)`
 *     so direct `node server.js` execution (without PM2) does not throw.
 *   - SIGINT and SIGTERM handlers MUST be registered.
 *   - `app.listen(port, host, ...)` MUST pass both `port` and `host` so the
 *     listener binds to the loopback interface by default (matches the
 *     legacy `app.run(host=HOSTNAME, port=PORT)` at `app.py`:L58).
 *   - CommonJS only (`require` / `module.exports`).
 *
 * PM2 Cluster Mode Notes (per AAP §0.5.3, §0.7.2 Rule R-005):
 *   In cluster mode, PM2 forks N copies of this script (where N = the number
 *   of CPU cores on the host) and gives each worker an IPC channel via
 *   `process.send`. All workers bind to the same port; PM2's master process
 *   manages the shared socket. `wait_ready: true` in `ecosystem.config.js`
 *   instructs PM2 to wait for each worker to call `process.send('ready')`
 *   before considering it healthy. Workers that fail to signal readiness
 *   within `listen_timeout: 10000 ms` are killed and restarted, so the
 *   `process.send('ready')` call inside the `app.listen` callback is
 *   load-bearing for cluster mode operation.
 *
 * Graceful Shutdown Contract (per AAP §0.5.3, Rule R-010):
 *   PM2 sends SIGINT to workers on `pm2 stop`, and SIGTERM on `pm2 reload`
 *   (zero-downtime restart). Both signals MUST trigger the same shutdown
 *   sequence:
 *     1. Set the `isShuttingDown` re-entry guard so duplicate signals don't
 *        cause double-close errors.
 *     2. Log the signal at `info` severity.
 *     3. Call `server.close(cb)` which stops accepting new connections and
 *        invokes the callback once all in-flight requests have drained.
 *     4. Exit with code 0 on clean drain, or code 1 if `close` callback
 *        receives an error or the drain timeout (10 s) is exceeded.
 *
 *   The 10-second drain timeout exceeds PM2's default `kill_timeout: 5000`
 *   ms so that PM2's SIGKILL (sent after `kill_timeout`) is the dominant
 *   abort mechanism in cluster mode. The local `setTimeout` is a final
 *   defense for cases where PM2 isn't managing the process (e.g., direct
 *   `node server.js` execution under a foreground terminal).
 *
 * Out-of-Scope (per AAP §0.3.2):
 *   - No TLS/HTTPS termination (no `https.createServer`).
 *   - No CORS middleware.
 *   - No rate-limiting middleware.
 *   - No authentication / authorization / session middleware.
 *   - No static file serving (`express.static`).
 *   - No templating engine (EJS / Handlebars / etc.).
 *   - No automated test infrastructure (Jest / Mocha / Supertest).
 *   - No custom JSON serialization beyond the route handler in
 *     `routes/index.js`.
 */

'use strict';

// =============================================================================
// 1. Environment Bootstrap (MUST be the first executable statement)
// =============================================================================
//
// `require('dotenv').config()` synchronously reads `.env` from the current
// working directory (CWD), parses each `KEY=value` line, and assigns each
// key to `process.env` UNLESS that key is already set. This pre-population
// is REQUIRED before any subsequent `require()` call that reads process.env
// (notably `./config`, which is the sole module in the application that
// touches `process.env` directly — per AAP Rule R-003).
//
// Why dotenv must be first:
//   Node's CommonJS `require()` is evaluation-once and cached. The first
//   call to `require('./config')` evaluates `config/index.js`, snapshots
//   `process.env.HOST`, `process.env.PORT`, etc., and freezes the resulting
//   object. If dotenv runs AFTER that snapshot, the env-file values would
//   never reach `config` — `config` would expose the unset / default values
//   even though `.env` exists on disk. Loading dotenv first eliminates this
//   ordering hazard.
//
// CWD discipline (per AAP §0.5.3 PM2 + dotenv interaction):
//   `dotenv.config()` resolves `.env` against `process.cwd()`. PM2 may
//   start the process with a CWD that differs from the project root,
//   causing dotenv to silently fail to find `.env`. The mitigation, per
//   AAP §0.7.2 Rule R-009, lives in `ecosystem.config.js` which sets
//   `cwd: __dirname` for every PM2-managed instance — pinning the worker
//   CWD to the project root so dotenv always finds `.env` here.
//
// Production posture:
//   In production under PM2 (with `env_production` populated in
//   `ecosystem.config.js`), the env-file values may be IDENTICAL to or
//   COMPLEMENTED BY the values PM2 itself injects into `process.env`. PM2's
//   injection happens BEFORE Node starts the script, so by the time this
//   line runs, `process.env.NODE_ENV === 'production'` (set by PM2) is
//   already populated. dotenv treats already-set keys as authoritative and
//   does NOT overwrite them — this is the intended precedence:
//     env_production block (PM2)  >  .env file (dotenv)  >  in-code defaults
//
// Failure mode:
//   If `.env` is missing, dotenv emits a non-fatal log message and returns
//   `{ parsed: undefined, error: <Error> }`. We deliberately do NOT call
//   `.config({ path: ..., debug: true })` or attach any error handler — the
//   "no .env file present" condition is the normal startup state for a
//   fresh clone before `cp .env.example .env`, and we want defaults to
//   take over silently in that case.

require('dotenv').config();

// =============================================================================
// 2. External Dependencies
// =============================================================================
//
// Order:
//   1. `express`     — the application factory and built-in middleware
//      (express.json, express.urlencoded). Pinned at ^5.2.1 per AAP §0.4.1.
//      Express 5 introduces native async/await error propagation, a stricter
//      path matcher, and security-hardened defaults (per AAP cite 7-14).
//   2. `helmet`      — security-header middleware (X-Frame-Options,
//      X-Content-Type-Options, Strict-Transport-Security, etc.). Pinned at
//      ^8.0.0 per AAP §0.4.1.
//   3. `compression` — gzip/deflate response compression middleware. Pinned
//      at ^1.7.5 per AAP §0.4.1. For the 14-byte response body the catch-all
//      route produces, compression has zero practical effect (the default
//      threshold is 1024 bytes), but the middleware is registered
//      defensively so larger payloads from any future endpoint benefit
//      automatically.
//
// Notes:
//   - `morgan` is consumed by `middleware/requestLogger.js`, NOT here.
//     This file imports the already-constructed middleware function.
//   - `winston` is consumed by `config/logger.js`, NOT here. This file
//     imports the configured logger singleton.

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');

// =============================================================================
// 3. Internal Modules
// =============================================================================
//
// Internal imports follow the dependency graph laid out in AAP §0.6.5.
// Every require below resolves to a file in this repository (config/,
// middleware/, routes/) and conforms to the contract declared in its
// respective file schema. Cross-file consistency is enforced by the AAP:
//
//   - `./config`                      -> frozen object { host, port, nodeEnv,
//                                          logLevel, logDir }
//   - `./config/logger`               -> winston logger singleton with the
//                                          npm severity methods (.error,
//                                          .warn, .info, .http, .verbose,
//                                          .debug, .silly)
//   - `./middleware/requestLogger`    -> morgan middleware (function)
//   - `./middleware/notFoundHandler`  -> 3-arg Express middleware (function)
//                                          [length === 3 -> regular middleware]
//   - `./middleware/errorHandler`     -> 4-arg Express error middleware
//                                          (function) [length === 4 ->
//                                          error-handling middleware]
//   - `./routes`                      -> express.Router() with the catch-all
//                                          handler that preserves the
//                                          byte-exact response contract
//
// Module evaluation order:
//   1. `./config` evaluates first (it's depended on by `./config/logger`).
//      The `.env`-populated `process.env` values are snapshotted into the
//      frozen config object at this point.
//   2. `./config/logger` evaluates next, reading `config.logDir`,
//      `config.logLevel`, and `config.nodeEnv` to construct the winston
//      transport list and to call `fs.mkdirSync(config.logDir, { recursive:
//      true })` (per AAP Rule R-008).
//   3. The three middleware modules evaluate; each imports the winston
//      singleton from step 2 via Node's cached module reference.
//   4. `./routes` evaluates last, also using the winston singleton.

const config = require('./config');
const logger = require('./config/logger');
const requestLogger = require('./middleware/requestLogger');
const notFoundHandler = require('./middleware/notFoundHandler');
const errorHandler = require('./middleware/errorHandler');
const routes = require('./routes');

// =============================================================================
// 4. Express Application Construction
// =============================================================================
//
// `express()` returns a callable Application object that satisfies the
// (req, res) HTTP-server callback signature. It has methods to register
// middleware (`.use`, `.all`, `.get`, `.post`, `.put`, `.delete`), to read
// and write application-level settings (`.get(name)`, `.set(name, value)`,
// `.enable(name)`, `.disable(name)`), and to bind an HTTP listener
// (`.listen`). The instance is exported at the bottom of this file so that
// tooling (e.g., supertest, future test harnesses) can require this module
// and exercise the app without re-binding the port.

const app = express();

// --- Security hygiene: disable the X-Powered-By header ----------------------
//
// By default, Express adds `X-Powered-By: Express` to every response. This
// is a minor information-disclosure issue: it tells attackers which web
// framework is serving the request, narrowing the attack surface they need
// to probe. Disabling the header is a free, conventional hardening step
// recommended by every Express security guide (per AAP §0.5.3 and cite 35-3).
//
// `app.disable('x-powered-by')` is equivalent to `app.set('x-powered-by',
// false)` but is more idiomatic for boolean toggles. The header name
// matching is case-insensitive; we use the lowercased form because that's
// Express's internal canonical representation.

app.disable('x-powered-by');

// --- Trust proxy in production (per AAP cite 35-6) --------------------------
//
// When the application runs behind a reverse proxy (e.g., nginx, AWS ALB,
// Cloudflare), the client's real IP and protocol are NOT in the TCP socket
// peer address but in the `X-Forwarded-*` headers the proxy adds. By
// default, Express trusts the socket peer (the proxy itself) — which means
// `req.ip` returns the proxy's address rather than the actual client's.
//
// Setting `trust proxy` to a truthy value (here `1`, meaning "trust the
// first proxy in the X-Forwarded-For chain") causes Express to:
//   - Set `req.ip` from `X-Forwarded-For`.
//   - Set `req.protocol` from `X-Forwarded-Proto`.
//   - Set `req.hostname` from `X-Forwarded-Host`.
//   - Set `req.secure` from `req.protocol === 'https'`.
//
// We guard with `config.nodeEnv === 'production'` because:
//   1. Local development has no proxy; trusting non-existent proxy headers
//      would let a malicious client forge `X-Forwarded-For` and spoof their
//      IP in our logs.
//   2. Production deployment is the only environment expected to sit
//      behind a proxy (per the AAP's PM2 + reverse-proxy posture).
//
// The value `1` is preferred over the boolean `true` because `true` trusts
// ALL forwarded entries (which could include attacker-injected hops);
// `1` trusts only the single immediate upstream proxy, which is the
// canonical configuration when there's exactly one hop between the
// public internet and Node.

if (config.nodeEnv === 'production') {
  app.set('trust proxy', 1);
}

// =============================================================================
// 5. Middleware Registration (CRITICAL ORDER — DO NOT REORDER)
// =============================================================================
//
// Express middleware executes top-to-bottom in registration order. The
// ordering below is mandated by AAP §0.5.3 and is operationally significant
// — reordering any pair of these middlewares changes the security, logging,
// or error-handling semantics of the application.
//
// Stage 1: Security Headers (helmet, MUST be first)
// -------------------------------------------------
// helmet() returns a middleware function that sets ~15 secure HTTP response
// headers (X-Content-Type-Options, X-Frame-Options, Strict-Transport-
// Security, Cross-Origin-Resource-Policy, etc. — per AAP cite 33-5). These
// headers are written when downstream middleware calls `res.writeHead()` or
// the first `res.write()`. Registering helmet BEFORE any other middleware
// guarantees its headers are present on every response, including those
// produced by error paths or short-circuit middleware.

app.use(helmet());

// Stage 2: Response Compression (compression)
// -------------------------------------------
// compression() returns a middleware function that wraps `res.write` /
// `res.end` to gzip/deflate the response body when:
//   - The client's Accept-Encoding header includes 'gzip' or 'deflate'.
//   - The response body exceeds the threshold (default 1024 bytes).
//   - The response Content-Type matches a compressible MIME type (text/*,
//     application/json, etc.).
//
// For the current catch-all route's 14-byte body, the threshold check
// short-circuits the compression, so the wire response is byte-identical
// to an uncompressed response. The middleware is registered defensively so
// any future endpoint with a larger payload gets compression automatically.
//
// Registration order rationale: compression must come BEFORE any middleware
// that writes the response body (i.e., before the routes). It must come
// AFTER helmet so that security headers are applied to the
// already-compression-instrumented response object.

app.use(compression());

// Stage 3: Body Parsers (express.json + express.urlencoded)
// ----------------------------------------------------------
// Express 5 ships with built-in body parsers (which were external in
// Express 4, requiring the separate `body-parser` package). They parse the
// request body BEFORE downstream handlers run, populating `req.body` with
// the parsed value:
//   - `express.json()` parses `Content-Type: application/json` bodies into
//     a JavaScript object.
//   - `express.urlencoded({ extended: true })` parses `Content-Type:
//     application/x-www-form-urlencoded` bodies using the `qs` library
//     (which supports nested objects via bracket notation — that's what
//     `extended: true` selects).
//
// The current catch-all route ignores `req.body` entirely (it sends the
// same response regardless of input). The parsers are registered
// defensively for future endpoints. Parser errors (malformed JSON,
// oversized payloads) propagate via `next(err)` and surface in the
// `errorHandler` at the end of the chain, where they receive a 400 or 413
// response per the parser's `err.status` field.
//
// Registration order rationale: body parsing happens BEFORE the request
// logger so that `req.body` is available to any morgan token that wants
// it (the default 'combined' format does not log the body, but the
// ordering remains canonical). Registering parsers AFTER compression
// is fine — compression operates on the response, parsers operate on
// the request, so they don't interact.

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Stage 4: HTTP Request Logging (requestLogger / morgan)
// -------------------------------------------------------
// The `requestLogger` middleware imported above is the morgan instance
// constructed in `middleware/requestLogger.js`. It wraps every request
// with an `res.on('finish', ...)` listener that emits the formatted
// access-log line into the winston `http` severity level once the
// response completes.
//
// Registration order rationale: morgan must come AFTER the body parsers
// (so it sees the finalized request) and BEFORE the routes (so EVERY
// request is logged, including those that match the catch-all). Placing
// morgan here means body-parser errors that propagate to errorHandler
// are NOT logged by morgan (because their `finish` event fires inside
// errorHandler's response — which is the desired behavior; errors are
// logged by errorHandler itself at `error` severity).

app.use(requestLogger);

// Stage 5: Routes (catch-all router)
// -----------------------------------
// `routes` is the `express.Router()` instance from `routes/index.js` with
// a single `router.all('/{*splat}', handler)` registration. Mounting it
// at the application root via `app.use('/', routes)` means the router
// sees the full URL path, and its catch-all matcher handles every
// inbound request with the byte-exact `Hello, World!\n` response.
//
// Registration order rationale: the router must come AFTER all
// middleware (so middleware applies to every request) and BEFORE the
// 404 / error handlers (so unmatched requests fall through and errors
// can be caught downstream).

app.use('/', routes);

// Stage 6: 404 Fallback (notFoundHandler, defensive)
// ---------------------------------------------------
// If the catch-all router somehow fails to match (impossible in the
// current configuration but possible if the route module is refactored),
// the `notFoundHandler` middleware fires, logs the unmatched path at
// WARN severity, and returns a JSON 404 response. This is a defensive
// layer per AAP §0.5.2 — it should NEVER execute during normal
// operation but it future-proofs the application against route refactors.
//
// `notFoundHandler` has 3 formal parameters (`req, res, next`), so
// Express's middleware classifier treats it as REGULAR middleware (not
// error-handling middleware). It is invoked on every request that falls
// through the routes chain.

app.use(notFoundHandler);

// Stage 7: Error Handler (errorHandler, MUST be last)
// ----------------------------------------------------
// The `errorHandler` middleware is registered LAST. It has 4 formal
// parameters (`err, req, res, next`), so Express's middleware classifier
// treats it as ERROR-handling middleware — meaning it is invoked ONLY
// when `next(err)` is called upstream, when a synchronous handler throws,
// or when an async handler's returned Promise rejects (Express 5 surfaces
// async rejections automatically per AAP cite 7-14).
//
// Registering errorHandler LAST is required for two reasons:
//   1. Express's error-handling middleware ONLY catches errors propagated
//      from middleware registered ABOVE it.
//   2. Multiple error handlers can be registered, but only the FIRST one
//      reached in the chain handles a given error. Placing this handler
//      last means it acts as the final safety net for every error path.
//
// The handler logs the error at `error` severity with structured request
// context (per AAP §0.6.2) and emits a JSON `{ error: 'Internal server
// error' }` response, withholding stack traces from the client (per
// AAP §0.8.2 "Never expose stack traces in production").

app.use(errorHandler);

// =============================================================================
// 6. HTTP Server Binding
// =============================================================================
//
// `app.listen(port, host, callback)` binds the underlying Node http.Server
// to the specified TCP address and returns the http.Server instance.
// We capture the returned instance in `server` so:
//   1. The graceful shutdown handlers (Section 7) can call `server.close()`
//      to stop accepting new connections and drain in-flight requests.
//   2. The instance is exported at the bottom of this file for external
//      consumers (e.g., process monitors that introspect `.address()`).
//
// Port + Host: both are explicitly passed.
//   - Passing both arguments restricts the listener to the specified
//     interface. `config.host` defaults to `'127.0.0.1'` (loopback only)
//     to preserve the security posture of the legacy Flask implementation
//     (`app.py`:L22: `HOSTNAME = '127.0.0.1'`; `app.py`:L58: `app.run(host=
//     HOSTNAME, port=PORT)`). Operators may override via the HOST env var
//     to expose on other interfaces (e.g., `HOST=0.0.0.0` for all
//     interfaces) when running behind a firewall or reverse proxy.
//   - `config.port` defaults to `3000` (matches `app.py`:L23 and the
//     Backprop integration test fixture's documented expectation).
//
// Listener Callback:
//   The callback fires once the server is bound and ready to accept
//   connections. We use it to:
//     1. Emit a startup info log (functional parity with `app.py`:L55's
//        `print(f'Server running at http://{HOSTNAME}:{PORT}/')`).
//     2. Signal PM2 readiness via `process.send('ready')` so that PM2's
//        `wait_ready: true` in `ecosystem.config.js` can treat this worker
//        as healthy.
//
// PM2 Cluster Mode Caveat:
//   In cluster mode, PM2 forks N copies of this script. Each fork gets its
//   own `app.listen()` callback invocation; each calls `process.send('ready')`
//   independently. PM2 tracks per-worker readiness and considers the cluster
//   healthy only when ALL workers have signaled ready (or when
//   `listen_timeout: 10000 ms` is reached, whichever comes first).

const server = app.listen(config.port, config.host, () => {
  // --- Startup info log (winston, functional parity with app.py:L55) ------
  //
  // The legacy Flask implementation emitted a startup line via `print(...)`
  // to stdout. Here we route the equivalent message through winston's
  // `info` severity so:
  //   - In development (LOG_LEVEL=debug or info), the message appears on
  //     stdout/stderr via winston's Console transport.
  //   - In production (NODE_ENV=production), the message ALSO appears in
  //     the combined.log file (because the File transport is added in
  //     production by `config/logger.js`).
  //   - In every environment, the entry inherits winston's `defaultMeta:
  //     { service: 'hao-backprop-test' }` so log aggregators can filter
  //     by service.
  //
  // The structured metadata captures `nodeEnv` and `pid` for operational
  // visibility:
  //   - `nodeEnv` confirms which env block PM2 selected (--env production
  //     vs default --env). Useful for catching misconfigured starts.
  //   - `pid` identifies the worker process. In cluster mode every worker
  //     has a distinct PID; the log aggregator can use this to group
  //     log lines per worker for incident analysis.

  logger.info(`Server running at http://${config.host}:${config.port}/`, {
    nodeEnv: config.nodeEnv,
    pid: process.pid
  });

  // --- PM2 readiness signal (per AAP Rule R-010) ---------------------------
  //
  // `process.send` is undefined unless the Node.js process was spawned with
  // an IPC channel (i.e., as a child of another Node process, typically
  // PM2's master in cluster mode). When `process.send` IS defined, calling
  // it sends a structured message to the parent process; PM2 specifically
  // listens for the literal string `'ready'` to satisfy `wait_ready: true`.
  //
  // The `if (process.send)` guard prevents a TypeError when running
  // standalone via `node server.js` or `npm start` (no parent IPC channel).
  // This dual-mode operation is the conventional pattern for PM2-aware
  // Node applications.
  //
  // Why this matters in cluster mode:
  //   `wait_ready: true` instructs PM2 to wait for each worker to call
  //   `process.send('ready')` BEFORE marking the worker as 'online' and
  //   routing traffic to it. Without this signal, PM2 falls back to a
  //   timer-based heuristic (`listen_timeout: 10000 ms`) and may consider
  //   a worker healthy before it's actually accepting connections. With
  //   the signal, PM2 makes zero-downtime reloads truly seamless: a new
  //   worker is only added to the load balancer after it's confirmed
  //   ready.

  if (process.send) {
    process.send('ready');
  }
});

// =============================================================================
// 7. Graceful Shutdown
// =============================================================================
//
// Process signals supported (per AAP Rule R-010):
//   - SIGINT  — sent by terminal Ctrl+C and by `pm2 stop` (default signal)
//   - SIGTERM — sent by `pm2 reload`, `pm2 restart`, systemd's stop unit,
//                Docker's container stop, and Kubernetes' pod termination
//
// Shutdown sequence:
//   1. Set the `isShuttingDown` re-entry guard. If a second signal arrives
//      (e.g., the operator hits Ctrl+C twice), we ignore it rather than
//      attempt to close the server again.
//   2. Log the signal at `info` severity so the operator and log
//      aggregator can observe the shutdown initiation.
//   3. Call `server.close(cb)`:
//        - Stops accepting NEW connections immediately.
//        - Calls the callback once all in-flight connections have
//          finished (or errors out if a connection is hung).
//      Note: `server.close` does NOT forcibly terminate in-flight
//      connections; it waits for them. For Node.js 18.2+, `server.closeAllConnections()`
//      exists to force-close, but the AAP intentionally relies on PM2's
//      `kill_timeout: 5000` as the force-kill mechanism (per the shutdown
//      contract in the file header), so we don't call it here.
//   4. On clean drain, log success and `process.exit(0)`.
//   5. On drain error, log the error with structured metadata and
//      `process.exit(1)`.
//   6. If drain takes longer than 10 seconds, the `setTimeout` safety net
//      logs a forced-shutdown error and exits with code 1. The 10-second
//      window is longer than PM2's default `kill_timeout: 5000` ms, so
//      under PM2 management this safety net is rarely reached — PM2's
//      SIGKILL terminates the worker first. Under direct `node` execution
//      (without PM2), this safety net is the only guard against
//      indefinite hang.
//
// The `setTimeout(...).unref()` call deserves explanation:
//   - `setTimeout(fn, ms)` returns a Timer object that, by default, keeps
//     the Node.js event loop alive (preventing the process from exiting
//     while the timer is pending).
//   - We CALL `.unref()` on the timer to detach it from the event loop:
//     once `server.close(cb)` invokes its callback and `process.exit(0)`
//     runs, the timer is no longer needed. If `.unref()` were omitted,
//     the event loop would stay alive until the timer fires (or until
//     the process exits) — which causes a 10-second hang on clean
//     shutdowns. With `.unref()`, the timer fires ONLY if it's the last
//     thing keeping the event loop alive — i.e., only if `server.close`
//     hasn't completed yet, which is exactly the "drain stuck" condition
//     we want to time out on.

let isShuttingDown = false;

function gracefulShutdown(signal) {
  // --- Step 1: re-entry guard ---------------------------------------------
  //
  // Without this guard, a double-signal (e.g., two Ctrl+C's in rapid
  // succession) would cause `server.close()` to be called twice. The
  // second call would synchronously invoke its callback with an
  // ERR_SERVER_NOT_RUNNING error (because the server is already closing),
  // which would then call `process.exit(1)` — masking the original clean
  // shutdown. The guard ensures the first signal owns the shutdown
  // sequence; subsequent signals are no-ops.

  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  // --- Step 2: log signal receipt ------------------------------------------
  //
  // The signal name is included in the log message so operators can
  // distinguish operator-initiated shutdowns (SIGINT from Ctrl+C) from
  // process-manager-initiated shutdowns (SIGTERM from PM2 reload) when
  // reviewing post-mortem logs. We also pass `signal` and `pid` in the
  // structured metadata so a log aggregator can filter/group by these
  // fields without parsing the message text.

  logger.info(`${signal} received; initiating graceful shutdown`, {
    signal,
    pid: process.pid
  });

  // --- Step 3-5: close the HTTP server and exit ----------------------------
  //
  // `server.close(callback)` stops accepting new connections and invokes
  // the callback once all existing connections have closed. The callback
  // receives an error argument ONLY if the server is in an invalid state
  // (e.g., never bound, or already closed); for the normal case the error
  // argument is `undefined`.
  //
  // We do NOT chain a `.unref()` on the http.Server: PM2 manages the
  // listening socket in cluster mode (it's a shared FD across workers),
  // and unref'ing it could destabilize the cluster's socket bookkeeping.
  // Letting `server.close` complete naturally is the correct shutdown
  // semantic.

  server.close((err) => {
    if (err) {
      logger.error('Error during server.close()', {
        error: err && err.message,
        stack: err && err.stack
      });
      // eslint-disable-next-line n/no-process-exit -- intentional shutdown
      process.exit(1);
      return;
    }
    logger.info('HTTP server closed; exiting process');
    // eslint-disable-next-line n/no-process-exit -- intentional shutdown
    process.exit(0);
  });

  // --- Step 6: drain-timeout safety net ------------------------------------
  //
  // If `server.close`'s callback hasn't fired within 10 seconds, we
  // forcibly exit. This covers the "stuck connection" case where a slow
  // client or a hung downstream service prevents the connection from
  // ever closing on its own.
  //
  // Under PM2 (cluster mode with kill_timeout: 5000), PM2 will send
  // SIGKILL to the worker after 5 seconds, terminating it BEFORE this
  // 10-second timer fires. So in production, this safety net is
  // effectively a fallback for the edge case where PM2 itself is not
  // managing the process (direct `node server.js`) or PM2 has crashed.
  //
  // `.unref()` is critical (see header comment) — it lets the process
  // exit cleanly if `server.close` finishes before the timer fires.

  setTimeout(() => {
    logger.error('Forced shutdown after drain timeout', {
      timeoutMs: 10000,
      signal,
      pid: process.pid
    });
    // eslint-disable-next-line n/no-process-exit -- intentional shutdown
    process.exit(1);
  }, 10000).unref();
}

// --- Register signal handlers ------------------------------------------------
//
// Wrap `gracefulShutdown` in an arrow function so the signal name is
// captured and passed in. Node delivers the signal name as the first
// argument to the handler, so we could equivalently write
// `process.on('SIGINT', gracefulShutdown)` — but the explicit arrow
// makes the call shape obvious and aligns with the agent prompt's
// Phase 6 reference shutdown handler skeleton.
//
// `process.on('SIGINT', ...)` overrides Node.js's default SIGINT
// behavior (which is to print '^C' and exit). The override is intentional:
// we want the graceful shutdown sequence to run instead of an immediate
// exit.

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// =============================================================================
// 8. Process-Level Safety Nets (Defensive)
// =============================================================================
//
// Express 5's native async/await error propagation catches errors from
// async route handlers and routes them through the standard error
// middleware chain (terminating in `errorHandler`). However, two
// categories of failure bypass that chain entirely:
//
//   1. `uncaughtException` — A synchronous throw inside an event handler
//      (e.g., `setTimeout(() => { throw new Error('boom'); })`) or any
//      throw outside the Express request/response lifecycle. Express
//      cannot intercept these.
//
//   2. `unhandledRejection` — A Promise that rejects without a `.catch`
//      handler or `await` that propagates the rejection upstream. Node
//      reports these as 'unhandledRejection' events. As of Node 15, the
//      default behavior is to terminate the process; we override to log
//      first.
//
// Both safety nets:
//   - Log the failure at `error` severity with full diagnostic metadata
//     (message and stack) so post-mortem analysis has the original
//     context.
//   - Trigger `gracefulShutdown` to drain the HTTP server before exiting.
//     A crashed worker that exits without draining drops in-flight
//     requests — these requests fail with a connection-reset error on
//     the client side. Triggering graceful shutdown gives the existing
//     requests a chance to complete before the process exits.
//
// Why these are "safety nets" rather than primary error handlers:
//   - The Express `errorHandler` middleware is the PRIMARY error handler
//     for HTTP request lifecycles. These process-level handlers exist
//     ONLY for the residual error paths that bypass Express.
//   - In a healthy application, these handlers should NEVER fire. If
//     they do fire, that's a signal of a serious bug somewhere (or an
//     issue in a third-party library); the log entry should be treated
//     as an actionable alert.
//
// Caveats:
//   - After `uncaughtException`, Node's documentation warns that the
//     process state may be corrupt. The recommended pattern is to LOG
//     the error and EXIT — DO NOT attempt to keep running. Our
//     `gracefulShutdown` calls `process.exit(0)` (or 1 on error), which
//     honors this recommendation.
//   - For `unhandledRejection`, the `reason` may be anything (not
//     necessarily an Error). We convert it via `String(reason)` so the
//     log entry never throws even for exotic rejection values like
//     undefined or a circular object.

process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', {
    error: err && err.message,
    stack: err && err.stack,
    name: err && err.name
  });
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', {
    reason: String(reason),
    // If the rejection reason is an Error instance, also capture stack
    // and name. Otherwise these fields are undefined and winston omits
    // them from the JSON entry.
    stack: reason && reason.stack,
    name: reason && reason.name
  });
  gracefulShutdown('unhandledRejection');
});

// =============================================================================
// 9. Module Exports (defensive, for future tooling)
// =============================================================================
//
// Exporting `app` and `server` is OPTIONAL but useful for future tooling
// that wants to introspect or exercise the running application:
//   - `app` is the Express application instance. External consumers can
//     read `app.get('setting-name')` to query configuration, or attach
//     additional middleware programmatically before the listener binds
//     (note: by the time anyone can require this file, `app.listen` has
//     already run, so further middleware would be registered too late).
//   - `server` is the http.Server instance returned by `app.listen(...)`.
//     External consumers can read `server.address()` to discover the
//     actual bound port (useful when PORT=0 is used to pick a random
//     ephemeral port for testing), or attach connection-level event
//     listeners.
//
// IMPORTANT: requiring this file from external code WILL execute the
// `app.listen(...)` call at module evaluation time, binding the port
// and starting the HTTP server. There is no `if (require.main ===
// module)` guard around the listener — per the agent prompt's Phase 8
// recommendation, the AAP excludes test infrastructure from scope
// (§0.3.2), so the file is meant to be invoked as the entry point and
// not require()'d as a library.
//
// Schema conformance (per AAP exports schema):
//   - `app` exposes: use(), listen(), set(), disable(), get(), post(),
//     put(), delete(), all() — all present on the Express Application
//     instance.
//   - `server` exposes: close(), listen(), address(), on() — all present
//     on the Node http.Server instance returned by `app.listen(...)`.

module.exports = { app, server };
