/**
 * middleware/notFoundHandler.js — Defensive 404 fallback middleware.
 *
 * Runs ONLY when no upstream route has matched the incoming request. In the
 * current application, `routes/index.js` is intentionally a catch-all
 * (`router.all('/{*splat}', handler)`) that matches every HTTP method and
 * every path, so this handler should NEVER fire during normal operation.
 * It exists as a defensive layer that future-proofs the application against
 * route refactors that might tighten the matching rules (per AAP §0.5.2:
 * "Defensive layer to log unmatched paths even though the current router
 * intentionally matches everything; future-proofs the application against
 * route refactors").
 *
 * Registration order (per AAP §0.5.3, enforced in server.js):
 *
 *     app.use(helmet());
 *     app.use(compression());
 *     app.use(express.json());
 *     app.use(express.urlencoded({ extended: true }));
 *     app.use(requestLogger);
 *     app.use('/', routes);
 *     app.use(notFoundHandler);        // <-- this module
 *     app.use(errorHandler);
 *
 * This handler MUST come AFTER `routes` (otherwise every request would land
 * here and the catch-all would never run) and BEFORE `errorHandler` (which
 * is a 4-arg error-middleware that only fires when `next(err)` is invoked
 * upstream — a different propagation channel that this 404 handler does
 * not participate in).
 *
 * Function Signature — THREE arguments (per AAP §0.6.2 and §Phase 2 of the
 *   agent prompt):
 *
 *     function notFoundHandler(req, res, next)
 *
 *   Express's middleware classifier inspects `fn.length`. A function with
 *   `length === 4` is treated as error-handling middleware (the
 *   `(err, req, res, next)` shape used by `errorHandler.js`); a function
 *   with `length <= 3` is treated as regular middleware. This handler
 *   MUST have exactly three formal parameters so Express invokes it on
 *   every unmatched request (rather than only on errors).
 *
 *   The `next` parameter is part of the signature for idiomatic clarity
 *   but is intentionally NOT invoked: this handler terminates the
 *   request/response cycle itself by calling `res.json(...)`. Calling
 *   `next()` AFTER sending a response would either be a no-op (Express
 *   detects the sent response and shortcuts) or, in pathological cases,
 *   trigger downstream middleware to attempt a second write — a
 *   `ERR_HTTP_HEADERS_SENT` failure mode worth avoiding entirely. The
 *   discipline here: respond, return.
 *
 * Log Behavior (per AAP §0.6.2):
 *   - Severity: `warn` — unmatched paths are anomalous (the catch-all
 *     route should have handled them) but not server failures. WARN is
 *     the operator-tier signal: reviewed in dashboards, not paged
 *     on-call. Using `error` here would inappropriately escalate a
 *     client-side mistake; using `info` would understate the anomaly
 *     of the catch-all having missed a request.
 *   - Structured payload: includes `method`, `url`, and `ip` for
 *     traceability. The `url` field uses `req.originalUrl || req.url`
 *     so that even if upstream middleware reassigns `req.url` (e.g.,
 *     by mounting the router at a sub-path), the original public
 *     request URL is preserved in the log.
 *   - No request body in the log: unmatched paths often have small or
 *     no bodies, and logging body content adds noise without
 *     incremental diagnostic value for a 404 (the URL alone is enough
 *     to identify the routing mismatch).
 *
 * Response Behavior (per AAP §0.6.2 and Rule R-001):
 *   - HTTP status: 404 — the canonical "Not Found" status code per
 *     RFC 9110 §15.5.5.
 *   - Content-Type: application/json (set automatically by `res.json`).
 *   - Response body: `{ "error": "Not Found" }` — the literal
 *     conventional reason phrase from RFC 9110 §15.5.5, JSON-encoded.
 *
 *   Note that this response shape DIFFERS from the catch-all route's
 *   plaintext `Hello, World!\n` body. The byte-exact response contract
 *   (per Rule R-001: status 200, Content-Type text/plain, body
 *   `Hello, World!\n`) applies only to the catch-all route — that is
 *   the application's "success" contract. This 404 handler is the
 *   "error contract", which is JSON for parser consistency with the
 *   `errorHandler.js` 500-error response shape.
 *
 * Out-of-Scope (per AAP §0.3.2 and §Phase 8 of the agent prompt):
 *   - No HTTP 405 (Method Not Allowed) special handling — Express 5's
 *     routing layer doesn't distinguish 404 from 405 without explicit
 *     route definitions, and we have only the catch-all route anyway.
 *   - No HTML error pages — response is JSON only, matching the
 *     errorHandler.js response shape for API parser consistency.
 *   - No localized error messages — single English reason phrase.
 *   - No "Did you mean..." suggestions, no fuzzy-match against
 *     known routes.
 *   - No metric counters (Prometheus, StatsD, etc.).
 *   - No client-side redirect rules, no fallback to a static file.
 */

'use strict';

// -----------------------------------------------------------------------------
// 1. Module imports
// -----------------------------------------------------------------------------
//
// Internal imports only:
//   - `../config/logger` — relative path from the `middleware/` directory
//     up one level into `config/`. Resolves to `config/logger.js`, which
//     exports the configured winston singleton (per AAP §0.5.2 logger
//     factory description). The singleton is shared across every module
//     in the application via Node's CommonJS module cache, so every log
//     entry from this handler flows through the same transports, format,
//     and `defaultMeta` as logs from `server.js`, `routes/index.js`,
//     `errorHandler.js`, and the `requestLogger.js` morgan stream.
//
// We intentionally do NOT require:
//   - `express` — middleware functions don't need to import Express
//     itself; they just need the (req, res, next) duck-typed contract.
//   - `http` — no low-level HTTP API is touched; `res.status().json()` is
//     entirely sufficient.
//   - `util` — no inspection or formatting helpers needed (winston handles
//     structured payload serialization in `config/logger.js`).
//   - `http-errors`, `serve-static`, or any other 404-related package —
//     a 404 with a JSON body is a four-line function; pulling in a
//     dependency for it would violate the minimalist philosophy of the
//     project (per AAP §0.3.2 "no unnecessary file creation" and
//     §0.7.2 R-011).

const logger = require('../config/logger');

// -----------------------------------------------------------------------------
// 2. The 404 fallback middleware
// -----------------------------------------------------------------------------
//
// Signature: `(req, res, next)` — exactly three formal parameters. See the
// header comment for why this is critical for Express's middleware
// classification.
//
// Behavior:
//   1. Emit a structured WARN log capturing method, URL, and client IP so
//      operators can identify both who triggered the unmatched path and
//      which request semantics (verb + path) failed to match.
//   2. Send an HTTP 404 response with a JSON body matching the
//      conventional error envelope `{ error: 'Not Found' }`.
//   3. Return implicitly; do not call `next()`.

function notFoundHandler(req, res, next) {
  // --- Step 1: structured WARN log -----------------------------------------
  //
  // The log message is the human-readable summary string `'Route not found'`;
  // the second argument is the structured metadata object that winston
  // merges into the log entry's info object before formatting.
  //
  // Field rationale:
  //   - `method`: HTTP verb. Distinguishes `GET /unknown` from `POST /unknown`
  //     — different verbs on the same path may indicate different client
  //     bugs (e.g., a misconfigured frontend issuing the wrong method).
  //   - `url`: Use `req.originalUrl` if present, falling back to `req.url`.
  //     `req.originalUrl` is preserved by Express across `req.url`
  //     rewrites that occur when middleware mounts routers at sub-paths,
  //     so it reflects the public URL the client actually requested.
  //     `req.url` is the fallback for the trivial case where no rewrite
  //     has occurred (which is the normal case for this single-router
  //     application; both values are identical here, but the fallback
  //     is defensive against future routing refactors).
  //   - `ip`: Client IP address. Express 5 derives this from the socket
  //     address by default, OR from `X-Forwarded-For` when `trust proxy`
  //     is set (per AAP §0.5.3 production hardening notes). In the
  //     current local development posture (no reverse proxy), this will
  //     typically be `::1` (IPv6 loopback) or `127.0.0.1`.

  logger.warn('Route not found', {
    method: req.method,
    url: req.originalUrl || req.url,
    ip: req.ip
  });

  // --- Step 2: HTTP 404 JSON response --------------------------------------
  //
  // `res.status(404)` sets the response status code and returns `res` for
  // method chaining. `.json({ ... })` serializes the object as JSON,
  // sets `Content-Type: application/json; charset=utf-8`, and ends the
  // response. After this call, the response is sealed: any further
  // `res.write` / `res.end` / `res.json` invocation in downstream
  // middleware would throw `ERR_HTTP_HEADERS_SENT`.
  //
  // We deliberately do NOT call `next()` after this — the response is
  // final, and propagating to additional middleware would be incorrect.
  // The `next` parameter is part of the signature for Express middleware
  // classification (see header comment Phase 2.1 of the agent prompt)
  // but is intentionally unused in the function body. ESLint would warn
  // about this unused parameter under `no-unused-vars`; if linting is
  // ever added (it is explicitly excluded by AAP §0.3.2), the convention
  // is to name the unused parameter `_next` or annotate it with an
  // ignore-pattern comment. For now, no linter runs against this
  // codebase, so the natural `next` name is retained for readability.

  res.status(404).json({ error: 'Not Found' });
}

// -----------------------------------------------------------------------------
// 3. Singleton default export
// -----------------------------------------------------------------------------
//
// CommonJS default export (per AAP §0.8.2 "Plain JavaScript (CommonJS)" —
// no ESM, no transpilation, no TypeScript). Downstream usage in server.js:
//
//     const notFoundHandler = require('./middleware/notFoundHandler');
//     // ... after `app.use('/', routes)` ...
//     app.use(notFoundHandler);
//
// Per the file schema, this is a default-exported function named
// `notFoundHandler`. CommonJS satisfies the "default export" semantic via
// `module.exports = <value>` (vs. the named-exports pattern
// `module.exports.notFoundHandler = ...` which would require consumers
// to write `require('./middleware/notFoundHandler').notFoundHandler`).
//
// Re-requiring this module from anywhere in the application returns the
// same function reference (Node module cache, keyed by resolved absolute
// path), but since the function is stateless, that's incidental — every
// invocation behaves identically regardless of how many `app.use(...)`
// registrations reference it.

module.exports = notFoundHandler;
