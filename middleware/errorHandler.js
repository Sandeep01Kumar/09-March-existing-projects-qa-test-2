/**
 * middleware/errorHandler.js — Centralized Express error-handling middleware.
 *
 * Implements the FINAL middleware in the Express request-handling chain
 * (per AAP §0.5.3 middleware registration order) and the canonical Express
 * error-handler contract: a four-argument function `(err, req, res, next)`
 * that the Express router invokes only when an upstream handler propagates
 * an error via `next(err)`, throws a synchronous error, or rejects an
 * async/await Promise (Express 5 surfaces async rejections automatically
 * per AAP cite 7-14).
 *
 * Responsibilities:
 *   1. Log every propagated error to the winston singleton with structured
 *      context (error metadata + request metadata) so production log
 *      aggregators (ELK, Splunk, Datadog, CloudWatch) can index, search,
 *      and alert on error patterns.
 *   2. Delegate to Express's default error handler when the response has
 *      already started — writing additional headers/body at that point
 *      would throw `ERR_HTTP_HEADERS_SENT` and crash the worker.
 *   3. Otherwise emit a deterministic JSON error envelope to the client
 *      with the error's HTTP status (default 500), withholding stack
 *      traces and internal error messages from the response body per
 *      AAP §0.8.2 "Never expose stack traces in production".
 *
 * Registration order (per AAP §0.5.3, enforced in server.js):
 *
 *     app.use(helmet());
 *     app.use(compression());
 *     app.use(express.json());
 *     app.use(express.urlencoded({ extended: true }));
 *     app.use(requestLogger);
 *     app.use('/', routes);
 *     app.use(notFoundHandler);
 *     app.use(errorHandler);          // <-- this module (MUST be last)
 *
 * This handler MUST be the LAST middleware registered so that every other
 * middleware in the chain can propagate to it via `next(err)`. Any
 * middleware registered AFTER it would never receive errors emitted by
 * this handler (and there is nothing meaningful to register after an
 * error terminator anyway).
 *
 * Function Signature — FOUR arguments (per AAP §0.6.2 and §Phase 2.1 of
 *   the agent prompt):
 *
 *     function errorHandler(err, req, res, next)
 *
 *   Express's middleware classifier inspects `fn.length` — the JavaScript
 *   built-in property exposing the number of formal parameters declared
 *   on a function. A function with `length === 4` is classified as
 *   error-handling middleware and is invoked ONLY when `next(err)` is
 *   called upstream OR when a synchronous handler throws OR when an async
 *   handler's returned Promise rejects. A function with `length <= 3` is
 *   classified as regular middleware and is invoked on every request,
 *   completely bypassing the error-propagation channel.
 *
 *   This is the most common Express error-handling pitfall: a handler
 *   written as `(err, req, res) => {...}` reports `length === 3`,
 *   Express treats it as a normal middleware, and the application's
 *   error paths silently fall through to Express's default handler
 *   (which exposes stack traces in development — a security regression
 *   relative to the controlled output here).
 *
 *   For the same reason, this module MUST NOT use ES2015 default
 *   parameter values (e.g., `next = () => {}`) on the function — default
 *   values reduce `fn.length` and would re-classify the handler as
 *   regular middleware. See:
 *     - ECMAScript §10.2.4 "FunctionDeclaration: function f(...)"
 *     - MDN "Function: length" — formal parameters with a default
 *       value or after a rest parameter are NOT counted.
 *
 * Response Contract — Note on AAP Rule R-001:
 *   Rule R-001 (byte-exact `Hello, World!\n` response) applies ONLY to
 *   the catch-all success route in `routes/index.js`. Error responses
 *   are a separate JSON contract:
 *
 *     HTTP/1.1 {statusCode} ...
 *     Content-Type: application/json; charset=utf-8
 *
 *     {"error":"Internal server error"}
 *
 *   The 500 status default is overridden by `err.status` or
 *   `err.statusCode` when present — these are conventional fields on
 *   library-thrown HTTP errors (e.g., body-parser's SyntaxError carries
 *   `err.status === 400` for malformed JSON; the `http-errors` npm
 *   package follows the same convention; Express 5's built-in
 *   error-throwing helpers also set one or both).
 *
 * Security Posture (per AAP §0.8.2):
 *   - Response body contains ONLY the fixed string
 *     `{"error":"Internal server error"}`. No `err.message`, no
 *     `err.stack`, no `err.code`, no request echo. The error envelope
 *     does not leak implementation details, library names, file paths,
 *     line numbers, or other information useful to an attacker probing
 *     for vulnerabilities.
 *   - Stack traces and structured error metadata are routed to the
 *     LOGS (winston transports) where they are accessible only to
 *     operators with log-aggregator access. This is the defense-in-depth
 *     posture for production HTTP services.
 *   - No conditional behavior based on `NODE_ENV` — the AAP keeps the
 *     response body strict regardless of environment. Operators
 *     debugging in development can read the structured log entry on the
 *     console; they do not need stack-trace exposure in the HTTP body.
 *
 * Out-of-Scope (per AAP §0.3.2 and §Phase 8 of the agent prompt):
 *   - No CORS error handling — CORS is outside the project scope.
 *   - No rate-limiting error responses (e.g., 429) — rate limiting is
 *     not part of this enhancement.
 *   - No localized error messages — single English reason phrase.
 *   - No error reporting to external services (Sentry, Bugsnag,
 *     Rollbar, Honeybadger).
 *   - No error metadata sanitization beyond the structured fields
 *     captured below (the inputs are assumed trusted-from-the-process,
 *     not user-supplied data).
 *   - No development-mode stack-trace exposure — the AAP keeps the
 *     error body strict regardless of NODE_ENV.
 *   - No custom error classes (e.g., `ApiError`, `ValidationError`);
 *     this handler accepts any Error-like input via duck-typed property
 *     access guarded by `err && err.x` checks.
 *   - No HTML error pages — response is JSON only for parser
 *     consistency with the `notFoundHandler.js` 404-error response shape.
 *   - No metrics counters (Prometheus, StatsD, etc.).
 */

'use strict';

// -----------------------------------------------------------------------------
// 1. Module imports
// -----------------------------------------------------------------------------
//
// Internal imports only:
//   - `../config/logger` — relative path from the `middleware/` directory
//     up one level into `config/`. Resolves to `config/logger.js`, which
//     exports the configured winston singleton. The singleton is shared
//     across every module in the application via Node's CommonJS module
//     cache (keyed by the resolved absolute path), so every log entry
//     from this handler flows through the same transports, format, and
//     `defaultMeta` (i.e., `service: 'hao-backprop-test'`) as logs from
//     `server.js`, `routes/index.js`, `notFoundHandler.js`, and the
//     `requestLogger.js` morgan stream.
//
// We intentionally do NOT require:
//   - `express` — error middleware functions don't need to import Express
//     itself; they just need the (err, req, res, next) duck-typed contract.
//     Express is a duck-typed framework: the (req, res) objects it passes
//     are plain objects with documented method/property shapes, not
//     instances of a constructor we need to import.
//   - `http`, `http-errors`, `boom` — no low-level HTTP API or third-party
//     error-construction helpers are needed. The response shape is a
//     fixed JSON envelope; the status code is read from the input error.
//   - `util` — no inspection or formatting helpers needed (winston handles
//     structured payload serialization in `config/logger.js`).
//
// Per AAP §0.4.1, no external npm packages are listed for this file's
// `external_imports` — only `winston` (transitively, through the logger
// singleton). This keeps the module's dependency surface minimal and
// auditable.

const logger = require('../config/logger');

// -----------------------------------------------------------------------------
// 2. The error-handling middleware
// -----------------------------------------------------------------------------
//
// Signature: `(err, req, res, next)` — exactly FOUR formal parameters.
// See the header comment for why this is critical for Express's
// middleware classification.
//
// Behavior:
//   1. Emit a structured ERROR log capturing the error's message, stack,
//      name, and code along with the request's method, URL, and client IP
//      so operators can correlate the failure with the inbound request
//      that triggered it.
//   2. If the response has already started (`res.headersSent`), delegate
//      to Express's default error handler via `next(err)`. The default
//      handler will simply close the connection because writing additional
//      headers/body at that point would throw `ERR_HTTP_HEADERS_SENT` and
//      crash the worker process (and under PM2 cluster mode, churn
//      worker restarts pointlessly).
//   3. Otherwise, send a JSON error envelope with the error's HTTP status
//      (default 500). Return implicitly; do not call `next()` after
//      sending a response.

function errorHandler(err, req, res, next) {
  // --- Step 1: structured ERROR log ----------------------------------------
  //
  // Log first, respond second. This ordering matters because:
  //   - If `res.status(...).json(...)` throws (e.g., due to a corrupt
  //     response state we did not detect), we still want the log entry
  //     persisted so post-mortem analysis has the original error context.
  //   - If the process crashes while sending the response (e.g., the
  //     downstream socket closes mid-write), the log entry has already
  //     been queued to the winston transports and the JSON log file
  //     will retain the diagnostic record.
  //
  // The first argument to `logger.error` is the human-readable summary
  // string `'Unhandled error'`; the second argument is the structured
  // metadata object that winston merges into the log entry's info object
  // before formatting. In production (NODE_ENV=production), winston's
  // `format.json()` serializes the merged object into a single NDJSON
  // line; in development, the printf format renders the metadata
  // inline as JSON after the message.
  //
  // Field rationale:
  //   - `error.message`: The Error instance's human-readable message,
  //     suitable for grep'ing log files for known error patterns.
  //   - `error.stack`: The captured stack trace string (multi-line).
  //     winston's `format.errors({ stack: true })` in config/logger.js
  //     would also auto-extract this if we passed the Error directly,
  //     but explicit capture via structured metadata gives finer control
  //     and works uniformly whether `err` is a real Error or a
  //     plain-object error (e.g., `{ status: 400, message: '...' }`).
  //   - `error.name`: The Error subclass name ('TypeError',
  //     'SyntaxError', 'ReferenceError', etc.). Useful for log
  //     aggregator filters that want to count or alert on specific
  //     error kinds.
  //   - `error.code`: Many Node.js system errors carry a `code` string
  //     ('ENOENT', 'ECONNREFUSED', 'EADDRINUSE', etc.). Capturing it
  //     enables operators to identify infrastructure failure modes
  //     without parsing the message text.
  //   - `request.method`: HTTP verb of the inbound request.
  //   - `request.url`: Use `req.originalUrl` if present, falling back
  //     to `req.url`. `req.originalUrl` is preserved by Express across
  //     `req.url` rewrites that occur when middleware mounts routers
  //     at sub-paths, so it reflects the public URL the client actually
  //     requested. `req.url` is the fallback for the trivial case
  //     where no rewrite has occurred.
  //   - `request.ip`: Client IP address. Express 5 derives this from
  //     the socket peer address by default, OR from `X-Forwarded-For`
  //     when `trust proxy` is set. Useful for security incident triage
  //     (correlating error spikes with a specific source address).
  //
  // Defensive `err && err.X` access: Some thrown values in JavaScript
  // are not Error instances — `throw 'oops'` throws a string, and
  // library code sometimes throws plain objects or null/undefined.
  // The short-circuit `err && err.message` evaluates to `undefined`
  // (which winston serializes as a missing/omitted field) rather than
  // raising `TypeError: Cannot read properties of null/undefined`
  // during the log call itself. We do NOT apply the same guard to
  // `req` because Express guarantees a Request object on every
  // middleware invocation; if `req` were somehow null/undefined, the
  // middleware chain itself is already broken at a level this handler
  // cannot recover.

  logger.error('Unhandled error', {
    error: {
      message: err && err.message,
      stack: err && err.stack,
      name: err && err.name,
      code: err && err.code
    },
    request: {
      method: req.method,
      url: req.originalUrl || req.url,
      ip: req.ip
    }
  });

  // --- Step 2: delegate when response already in flight --------------------
  //
  // `res.headersSent` is a boolean property of the Express Response
  // object (proxied from Node's `http.ServerResponse`) that becomes
  // `true` once any portion of the response status line and headers
  // has been transmitted to the client. After that point, writing
  // additional headers or status codes throws
  // `ERR_HTTP_HEADERS_SENT` and the response cannot be modified.
  //
  // The canonical Express recommendation in this situation is to
  // delegate to the framework's default error handler via `next(err)`.
  // Express's default handler will:
  //   1. Detect that `res.headersSent === true`.
  //   2. Skip the usual write-error-page logic.
  //   3. Destroy the underlying socket connection so the client sees
  //      a truncated response instead of a hanging connection.
  //
  // The `return` here prevents the function from falling through to
  // Step 3 (which would unconditionally call `res.status(...).json(...)`
  // and crash). Express's documentation for this pattern:
  // https://expressjs.com/en/guide/error-handling.html

  if (res.headersSent) {
    return next(err);
  }

  // --- Step 3: send JSON error response ------------------------------------
  //
  // Determine the HTTP status code:
  //   - `err.status` — convention used by body-parser
  //     (e.g., 400 for malformed JSON), the `http-errors` npm package,
  //     and most Express middleware ecosystems.
  //   - `err.statusCode` — alternate convention used by some libraries
  //     (e.g., `request`, `axios`); supported here for compatibility.
  //   - 500 — default when neither field is present. This is the
  //     correct HTTP status for "the server encountered an unexpected
  //     condition that prevented it from fulfilling the request"
  //     per RFC 9110 §15.6.1.
  //
  // `err && (...)` guards against `err` being a non-object/null value.
  // The `||` short-circuit chain selects the first truthy value; 0 is
  // not a valid HTTP status code (status 0 means "no response received"
  // in client-side contexts and never appears as a server-emitted
  // status), so treating 0 as falsy is acceptable. Likewise, any
  // string value (e.g., `err.status === '400'`) is truthy and would be
  // forwarded as-is to `res.status(...)`, which Node.js coerces to a
  // number internally.
  //
  // The response body is the FIXED JSON envelope
  // `{ "error": "Internal server error" }`. Per AAP §0.8.2 and Rule
  // R-001 (Note: byte-exact contract applies only to the catch-all
  // route, not to error responses), this body is identical across
  // every error path — no `err.message` leak, no stack trace leak,
  // no environment-conditional verbosity. The trade-off (less helpful
  // for client-side debugging) is accepted in exchange for the
  // information-disclosure security property.
  //
  // `res.status(statusCode).json(body)`:
  //   - `res.status(n)` sets the response status code and returns `res`
  //     for method chaining.
  //   - `.json(obj)` serializes `obj` as JSON via `JSON.stringify`,
  //     sets `Content-Type: application/json; charset=utf-8` if not
  //     already set, sets `Content-Length` to the byte length of the
  //     serialized body, and ends the response.
  //
  // After this call returns, the response is sealed: any further write
  // attempt would trigger `ERR_HTTP_HEADERS_SENT`. We deliberately do
  // NOT call `next()` afterwards — the response is final, and
  // propagation to further middleware would be incorrect.

  const statusCode = (err && (err.status || err.statusCode)) || 500;
  res.status(statusCode).json({ error: 'Internal server error' });
}

// -----------------------------------------------------------------------------
// 3. Singleton default export
// -----------------------------------------------------------------------------
//
// CommonJS default export (per AAP §0.8.2 "Plain JavaScript (CommonJS)" —
// no ESM, no transpilation, no TypeScript). Downstream usage in server.js:
//
//     const errorHandler = require('./middleware/errorHandler');
//     // ... after `app.use(notFoundHandler);` ...
//     app.use(errorHandler);
//
// Per the file schema, this is a default-exported function named
// `errorHandler`. CommonJS satisfies the "default export" semantic via
// `module.exports = <value>` — the assigned value becomes the module's
// public interface. Consumers write `const x = require(...)` rather than
// `const { errorHandler } = require(...)`.
//
// The function is intentionally exported as a NAMED function declaration
// (not an anonymous arrow function) for two reasons:
//   1. `fn.name === 'errorHandler'` — useful for diagnostic tools
//      (Node.js inspector, profilers, error stack traces) that display
//      function names.
//   2. `fn.length === 4` — JavaScript's `Function.prototype.length`
//      counts the number of formal parameters BEFORE the first default
//      value and BEFORE any rest parameter. The four formal parameters
//      `(err, req, res, next)` produce `length === 4`, which is what
//      Express's middleware classifier requires (see header comment).
//
// Re-requiring this module from anywhere in the application returns the
// same function reference (Node module cache, keyed by resolved absolute
// path), but since the function is stateless, that's incidental — every
// invocation behaves identically regardless of how many `app.use(...)`
// registrations reference it.

module.exports = errorHandler;
