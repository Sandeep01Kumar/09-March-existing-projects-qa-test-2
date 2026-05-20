/**
 * middleware/bodyParserErrorHandler.js — Body-parser compatibility shim that
 * preserves the byte-exact HTTP response contract (AAP §0.7.2 Rule R-001).
 *
 * Background — why this module exists
 * ------------------------------------
 * The canonical Express middleware order documented in AAP §0.5.3 places the
 * built-in body parsers (`express.json()` and `express.urlencoded(...)`)
 * BEFORE the catch-all route in `routes/index.js`:
 *
 *     helmet -> compression -> express.json -> express.urlencoded
 *     -> requestLogger -> routes -> notFoundHandler -> errorHandler
 *
 * When a client sends a payload that the body parser rejects (malformed
 * JSON, oversized body, unsupported charset, unsupported encoding, etc.),
 * the parser short-circuits the chain by calling `next(err)` with the
 * error carrying `err.status` set to 400 / 413 / 415 / 403 depending on
 * the failure mode. Express then skips forward through the chain looking
 * for the next 4-argument error-handling middleware, which is
 * `middleware/errorHandler.js`. errorHandler — correctly per its own
 * contract — responds with `{ "error": "Internal server error" }` and the
 * error's HTTP status (e.g., 400).
 *
 * This breaks Rule R-001, which states that EVERY HTTP request, regardless
 * of method, path, headers, OR payload, must receive a byte-exact
 * `Hello, World!\n` response with status 200 and `Content-Type: text/plain`.
 * R-001 is a CRITICAL constraint anchored to the Backprop integration test
 * fixture; it takes precedence over the middleware composition shown in
 * AAP §0.5.3.
 *
 * Code Review Finding (Checkpoint 2, FINAL) — CRITICAL, server.js:346-347:
 *     "`express.json()` and `express.urlencoded({ extended: true })` are
 *      registered before the catch-all route. These parsers can reject
 *      malformed JSON/form/oversized bodies before `routes/index.js` runs,
 *      so not every inbound request receives the required HTTP 200 +
 *      `text/plain` + `Hello, World!\\n` response."
 *
 * Resolution Strategy
 * -------------------
 * Per the review's enumerated resolution options, we adopt Option 4:
 *
 *     "...add a parser-error compatibility middleware immediately after
 *      body parsers that returns the exact `200`, `Content-Type:
 *      text/plain`, `Hello, World!\\n` response for body-parser errors."
 *
 * This is the most surgical fix: it preserves the AAP-documented middleware
 * order (helmet -> compression -> json -> urlencoded -> ...) while
 * inserting a focused 4-arg error-handling middleware between the body
 * parsers and `requestLogger` that translates body-parser failures into
 * the byte-exact R-001 response. Errors that are NOT from body-parser
 * fall through to the existing `errorHandler` for the normal JSON
 * `Internal server error` response.
 *
 * Registration order (enforced in server.js after this module is created):
 *
 *     app.use(helmet());
 *     app.use(compression());
 *     app.use(express.json());
 *     app.use(express.urlencoded({ extended: true }));
 *     app.use(bodyParserErrorHandler);   // <-- this module (4-arg error mw)
 *     app.use(requestLogger);
 *     app.use('/', routes);
 *     app.use(notFoundHandler);
 *     app.use(errorHandler);
 *
 * Function Signature — FOUR arguments (CRITICAL for Express classification)
 * --------------------------------------------------------------------------
 * Express's middleware classifier inspects `fn.length`. A function with
 * `length === 4` is treated as ERROR-handling middleware; a function with
 * `length <= 3` is treated as REGULAR middleware. This module MUST have
 * exactly four formal parameters `(err, req, res, next)` so Express only
 * invokes it on the error path (i.e., when a body parser propagates
 * `next(err)`). Regular requests bypass this middleware entirely — the
 * chain proceeds directly from `express.urlencoded` to `requestLogger`.
 *
 * Body-Parser Error Detection
 * ----------------------------
 * The bundled `body-parser` library (re-exported by Express 5 as
 * `express.json` and `express.urlencoded`) attaches an `err.type` field to
 * every error it creates. The complete set of body-parser / raw-body error
 * types is enumerated in `BODY_PARSER_ERROR_TYPES` below (sourced from
 * `node_modules/body-parser/lib/*.js` and `node_modules/raw-body/index.js`
 * at the pinned versions in `package-lock.json`).
 *
 * We discriminate on `err.type` rather than `err.status` because:
 *   1. `err.status` is a generic HTTP status field that any middleware
 *      may set. Treating it as a body-parser signal would risk catching
 *      400/413/415 errors thrown by non-body-parser code (e.g., future
 *      validation middleware).
 *   2. `err.type` is body-parser-specific. Matching against the curated
 *      set guarantees we only mask body-parser failures and leave every
 *      other error path intact for the main `errorHandler`.
 *
 * Non-body-parser errors propagate via `next(err)` to the main
 * `errorHandler` middleware unchanged, so the global error semantics
 * (JSON `{ error: 'Internal server error' }` with the propagated status)
 * remain intact for all other error sources.
 *
 * Byte-Exact Response Construction
 * --------------------------------
 * The 200 response emitted by this middleware MUST be byte-identical to
 * the response produced by `routes/index.js`. The construction sequence
 * is therefore IDENTICAL to the catch-all route handler:
 *
 *     res.status(200);
 *     res.setHeader('Content-Type', 'text/plain');     // Node-level setHeader
 *     res.send(Buffer.from('Hello, World!\n', 'utf8')); // Buffer body
 *
 * Three Express behaviors are deliberately defeated here (see the detailed
 * code-level rationale in `routes/index.js` — file header, sections 2 and
 * 3 of "Response-Construction Note"):
 *
 *   1) We do NOT use `res.type('text/plain')` — that path goes through
 *      `mime.contentType()` which APPENDS `; charset=utf-8` to text/*
 *      MIME types.
 *   2) We do NOT use `res.set('Content-Type', 'text/plain')` either —
 *      `res.set` ALSO runs the Content-Type value through
 *      `mime.contentType()`. We instead use Node's underlying
 *      `res.setHeader(...)` which writes the value verbatim.
 *   3) We pass a Buffer body (not a string) to `.send(...)`. String bodies
 *      trigger Express's internal `setCharset(type, 'utf-8')` call which
 *      mutates a pre-set Content-Type from `text/plain` to
 *      `text/plain; charset=utf-8`. Buffer bodies skip that path.
 *
 * Hex verification of the body bytes:
 *   48 65 6c 6c 6f 2c 20 57 6f 72 6c 64 21 0a   (14 bytes; trailing 0x0A)
 *
 * Logging Behavior
 * ----------------
 * Body-parser errors that this middleware masks are logged at the `debug`
 * severity level with structured metadata (the error type, the propagated
 * HTTP status, the request method, and the request URL). Rationale:
 *
 *   - At the default production log level (`info`), debug entries are
 *     suppressed entirely, so production log volume is unaffected.
 *   - In development (LOG_LEVEL=debug), the entry confirms that the
 *     compatibility shim engaged and helps developers understand why a
 *     malformed payload received a 200 response.
 *   - We do NOT log at `error` or `warn` severity because, from the AAP's
 *     R-001 perspective, masked body-parser failures are now part of the
 *     intended success path — not anomalies.
 *
 * res.headersSent Guard
 * ---------------------
 * If a body parser somehow propagates an error AFTER the response has
 * already started (e.g., a downstream middleware peeked at `req.body` and
 * began writing the response before the parser finished), writing
 * additional headers/body would throw `ERR_HTTP_HEADERS_SENT` and crash
 * the worker. In that case we delegate to `next(err)` so Express's
 * default error handler can destroy the socket cleanly. This is the
 * same defensive pattern used in `errorHandler.js`.
 *
 * Out-of-Scope (per AAP §0.3.2)
 * ------------------------------
 * - No content-negotiation: this middleware always emits text/plain.
 * - No localized error messages.
 * - No metrics counters (Prometheus, StatsD, etc.).
 * - No conditional behavior based on `NODE_ENV` — the byte-exact response
 *   is emitted in every environment.
 * - No client-side hints: the response is identical to a normal success
 *   response; clients cannot tell that their payload was malformed by
 *   inspecting the response (this is intentional — it matches the legacy
 *   Flask catch-all behavior which would have ignored the body entirely).
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
//     cache (keyed by the resolved absolute path), so the entry produced
//     by this middleware flows through the same transports, format, and
//     `defaultMeta` (i.e., `service: 'hao-backprop-test'`) as every other
//     log in the application.
//
// We intentionally do NOT require:
//   - `express` — error middleware functions don't need to import Express
//     itself; they just need the (err, req, res, next) duck-typed contract.
//   - `http-errors`, `http` — no low-level HTTP API is touched; the
//     response is constructed with Node's `res.setHeader(...)` and the
//     Express response surface.

const logger = require('../config/logger');

// -----------------------------------------------------------------------------
// 2. Body-parser error type enumeration
// -----------------------------------------------------------------------------
//
// Curated from the implementation files of body-parser 1.x and raw-body
// at the versions pinned in `package-lock.json`. Every error created by
// these libraries via `http-errors.createError(status, msg, { type: ... })`
// carries one of the strings below as `err.type`. Matching against this
// curated set guarantees this middleware ONLY masks body-parser failures;
// every other error path (helmet, compression, route handlers, etc.)
// propagates to the main `errorHandler` middleware unchanged.
//
// Source files referenced (pinned versions):
//   - node_modules/body-parser/lib/read.js          (entity.* and charset/encoding)
//   - node_modules/body-parser/lib/types/json.js    (entity.parse.failed)
//   - node_modules/body-parser/lib/types/urlencoded.js (parameters/querystring)
//   - node_modules/raw-body/index.js                (entity.too.large, request.*)
//
// If body-parser is upgraded and introduces a new error type, this set
// must be revisited. The current enumeration covers every type the
// bundled body-parser+raw-body emits.

const BODY_PARSER_ERROR_TYPES = new Set([
  // body-parser parse failures (HTTP 400)
  'entity.parse.failed',          // SyntaxError on malformed JSON / form data
  'entity.verify.failed',         // verify-callback rejection

  // raw-body size / stream failures (HTTP 413 / 400 / 500)
  'entity.too.large',             // payload exceeds configured limit
  'request.aborted',              // client closed the connection mid-upload
  'request.size.invalid',         // declared Content-Length does not match
  'stream.encoding.set',          // stream was prematurely encoded
  'stream.not.readable',          // stream was consumed before parser ran

  // charset / encoding failures (HTTP 415 / 403)
  'charset.unsupported',          // Content-Type charset is not supported
  'encoding.unsupported',         // Content-Encoding is not supported

  // urlencoded-specific failures (HTTP 400 / 413)
  'parameters.too.many',          // too many keys in form payload
  'querystring.parse.rangeError'  // qs library threw a RangeError
]);

// -----------------------------------------------------------------------------
// 3. The body-parser compatibility middleware
// -----------------------------------------------------------------------------
//
// Signature: `(err, req, res, next)` — exactly FOUR formal parameters.
// JavaScript's `Function.prototype.length` counts the number of formal
// parameters BEFORE the first default value and BEFORE any rest
// parameter, so we deliberately do NOT use ES2015 default parameter
// values or rest parameters in this function declaration. The four
// parameters yield `fn.length === 4`, which is what Express's middleware
// classifier requires to treat this as ERROR-handling middleware.
//
// Behavior:
//   1. Inspect `err.type`. If it matches the body-parser enumeration
//      above, this is a body-parser failure that R-001 requires we mask.
//   2. If it is NOT a body-parser error, call `next(err)` to delegate to
//      the main `errorHandler` middleware downstream.
//   3. If `res.headersSent` is true (response already in flight), call
//      `next(err)` — we cannot safely overwrite an in-flight response,
//      and Express's default error handler will destroy the socket.
//   4. Otherwise, emit the byte-exact 200 response: status 200, header
//      `Content-Type: text/plain` (verbatim, no charset suffix), body
//      `Hello, World!\n` (Buffer-encoded, 14 bytes).
//   5. Return implicitly; do not call `next()` after sending a response.

function bodyParserErrorHandler(err, req, res, next) {
  // --- Step 1: discriminate body-parser errors from other errors ----------
  //
  // `err && err.type` short-circuits cleanly when `err` is null/undefined
  // or otherwise non-object (e.g., `throw 'oops'` throws a string). The
  // `Set.prototype.has` check is O(1) and correctly returns `false` for
  // `undefined` (unset `err.type`).

  const errType = err && err.type;
  const isBodyParserError =
    typeof errType === 'string' && BODY_PARSER_ERROR_TYPES.has(errType);

  // --- Step 2: delegate non-body-parser errors --------------------------
  //
  // Any error whose `err.type` is NOT in the body-parser enumeration is
  // forwarded unchanged to the next error-handling middleware in the chain
  // (`errorHandler.js`). This preserves the global JSON error semantics
  // for application-level errors (e.g., a future route that throws, a
  // helmet/compression failure, etc.).

  if (!isBodyParserError) {
    return next(err);
  }

  // --- Step 3: in-flight response guard --------------------------------
  //
  // If headers have already been transmitted, writing the byte-exact
  // response would throw `ERR_HTTP_HEADERS_SENT`. Delegate to the main
  // error handler so Express's default behavior destroys the socket.
  // This path should never fire in practice because body parsers always
  // run BEFORE any response writing — but the guard is defensive.

  if (res.headersSent) {
    return next(err);
  }

  // --- Step 4: log the masked body-parser error -----------------------
  //
  // `logger.debug` is intentionally chosen over `warn` or `error`:
  //   - From the application's perspective (post-R-001), the masked
  //     response is the normal success path. Logging at `warn`/`error`
  //     would create alarming entries for behavior that is now expected.
  //   - `debug` entries are suppressed at the default production
  //     `LOG_LEVEL=info`, so production log volume is unaffected.
  //   - In development, operators can opt-in to seeing these entries
  //     via `LOG_LEVEL=debug` (the default in the bundled `.env`).
  //
  // Structured metadata fields:
  //   - `type`: the body-parser err.type string (e.g., 'entity.parse.failed')
  //   - `status`: the HTTP status body-parser intended (kept for
  //     observability even though we override it to 200)
  //   - `method`: the inbound HTTP verb
  //   - `url`: `req.originalUrl || req.url` for parity with the other
  //     middleware (and to survive any future mount-path rewrites)

  logger.debug('Body-parser error masked to preserve R-001 byte-exact contract', {
    type: errType,
    status: err.status || err.statusCode,
    method: req.method,
    url: req.originalUrl || req.url
  });

  // --- Step 5: emit the byte-exact 200 response (IDENTICAL to routes/index.js) ---
  //
  // Construction order:
  //   1. `res.status(200)` sets the status code and returns `res` (chain).
  //   2. `res.setHeader('Content-Type', 'text/plain')` writes the header
  //      verbatim. CRITICAL: this is Node's underlying setHeader, NOT
  //      Express's `res.set` — the latter would run the value through
  //      `mime.contentType()` and append `; charset=utf-8`.
  //   3. `res.send(Buffer.from('Hello, World!\n', 'utf8'))` writes the
  //      14-byte body and ends the response. CRITICAL: the body is a
  //      Buffer, not a string — string bodies trigger Express's internal
  //      `setCharset(type, 'utf-8')` which mutates the Content-Type.
  //
  // Hex verification (matches routes/index.js):
  //   48 65 6c 6c 6f 2c 20 57 6f 72 6c 64 21 0a
  //
  // See `routes/index.js` "Response-Construction Note" in its file
  // header for the full code-level rationale with Express 5 line
  // references.

  res.status(200);
  res.setHeader('Content-Type', 'text/plain');
  res.send(Buffer.from('Hello, World!\n', 'utf8'));
}

// -----------------------------------------------------------------------------
// 4. Singleton default export
// -----------------------------------------------------------------------------
//
// CommonJS default export (per AAP §0.8.2 "Plain JavaScript (CommonJS)" —
// no ESM, no transpilation, no TypeScript). Downstream usage in server.js:
//
//     const bodyParserErrorHandler = require('./middleware/bodyParserErrorHandler');
//     // ... after `app.use(express.urlencoded({ extended: true }));` ...
//     app.use(bodyParserErrorHandler);
//
// The function is intentionally exported as a NAMED function declaration
// (not an anonymous arrow function) for two reasons:
//   1. `fn.name === 'bodyParserErrorHandler'` — useful for diagnostic tools
//      (Node.js inspector, profilers, error stack traces).
//   2. `fn.length === 4` — JavaScript's `Function.prototype.length`
//      counts the formal parameters before any default value or rest
//      parameter. The four parameters `(err, req, res, next)` produce
//      `length === 4`, which is what Express's middleware classifier
//      requires to treat this as ERROR-handling middleware.
//
// Re-requiring this module from anywhere in the application returns the
// same function reference (Node module cache, keyed by resolved absolute
// path), but since the function is stateless, that's incidental — every
// invocation behaves identically regardless of how many `app.use(...)`
// registrations reference it.

module.exports = bodyParserErrorHandler;
