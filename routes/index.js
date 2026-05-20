/**
 * routes/index.js — Catch-all Express router preserving the byte-exact
 * HTTP response contract from the legacy Flask implementation
 * (`app.py`:L26-L49).
 *
 * Behavioral Contract (per AAP §0.7.2 Rule R-001):
 *   For every HTTP method (GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD —
 *   and any other method a client might invent) on every URL path (the
 *   root '/' and any nested path of any depth), this router responds with:
 *
 *     - Status:       200
 *     - Headers:      Content-Type: text/plain   (NO `; charset=utf-8` suffix)
 *     - Body:         "Hello, World!\n"          (14 bytes, terminating 0x0A)
 *
 *   This 14-byte body is consumed verbatim by the Backprop integration test
 *   fixture, which asserts byte-exact equality. Any deviation (extra
 *   whitespace, missing trailing newline, charset suffix on Content-Type,
 *   different status code) breaks the contract.
 *
 * Express 5 Path-Matcher Note (per AAP cite 7-14 and §0.5.3):
 *   Express 5 overhauled the path matcher for improved security. The
 *   legacy Express 4 wildcard `'*'` is REJECTED in Express 5 with an
 *   error like:
 *     "TypeError: Missing parameter name at 1: ..."
 *
 *   The correct Express 5 syntax for a catch-all that matches the root
 *   path AND any nested path in a single route declaration is
 *   `'/{*splat}'` — the named splat parameter. The `{...}` braces make
 *   the segment optional, so the route matches:
 *     /               (splat is empty)
 *     /foo            (splat is ['foo'])
 *     /foo/bar/baz    (splat is ['foo', 'bar', 'baz'])
 *
 *   This single declaration replaces the Flask dual-decorator pattern at
 *   `app.py`:L26-L27 which used `@app.route('/', defaults={'path': ''})`
 *   plus `@app.route('/<path:path>')` to cover the same two cases.
 *
 * Method-Matcher Note (per Phase 3.2 of the agent prompt):
 *   `router.all(pattern, handler)` matches every HTTP method without
 *   needing to enumerate them. Express dispatches OPTIONS and HEAD to
 *   this handler the same as GET/POST/PUT/DELETE/PATCH. HEAD specifically
 *   is handled by Express's internal mechanism that strips the response
 *   body but preserves the headers — so a HEAD request still receives
 *   Content-Type: text/plain with no body, per HTTP spec.
 *
 * Response-Construction Note (per AAP §0.8.2 "No charset suffix"):
 *   The original Flask response is `Response(..., content_type='text/plain')`
 *   with NO charset suffix (`app.py`:L49). Three Express behaviors threaten
 *   this byte-exact parity and must ALL be defeated:
 *
 *   1) `res.type('text/plain')` would emit `Content-Type: text/plain;
 *      charset=utf-8` because it delegates to the `mime-types` package
 *      which appends the default charset for text/* MIME types. We do
 *      NOT use `res.type(...)`.
 *
 *   2) `res.set('Content-Type', 'text/plain')` ALSO appends the charset.
 *      Verified against Express 5 source (`node_modules/express/lib/
 *      response.js` line ~671, the `res.set`/`res.header` definition):
 *
 *        if (field.toLowerCase() === 'content-type') {
 *          // ...
 *          value = mime.contentType(value)   // appends '; charset=utf-8'
 *        }
 *        this.setHeader(field, value);
 *
 *      Because of this, this handler does NOT use Express's `res.set(...)`
 *      for the Content-Type header. Instead, it uses Node's underlying
 *      `res.setHeader('Content-Type', 'text/plain')` which writes the
 *      value verbatim with no normalization.
 *
 *   3) `res.send(stringBody)` ALSO appends `; charset=utf-8` to a pre-set
 *      text/* Content-Type. Verified against Express 5 source
 *      (`node_modules/express/lib/response.js` line ~163):
 *
 *        if (typeof chunk === 'string') {
 *          encoding = 'utf8';
 *          type = this.get('Content-Type');
 *          if (typeof type === 'string') {
 *            this.set('Content-Type', setCharset(type, 'utf-8'));
 *          }
 *        }
 *
 *      Even if the Content-Type was set verbatim via `setHeader`, this
 *      code path would re-mutate it once `res.send(string)` is called.
 *      The only way to bypass it is to pass a non-string body. Buffer
 *      chunks skip the `setCharset` call entirely:
 *
 *        case 'object':
 *          if (ArrayBuffer.isView(chunk)) {  // Buffer extends Uint8Array
 *            if (!this.get('Content-Type')) {
 *              this.type('bin');
 *            }
 *          }
 *
 *      So sending `Buffer.from('Hello, World!\n', 'utf8')` preserves the
 *      Content-Type header verbatim while still emitting the identical
 *      14 wire bytes (the UTF-8 encoding of the literal string is
 *      `48 65 6c 6c 6f 2c 20 57 6f 72 6c 64 21 0a`).
 *
 *   Combined fix:
 *     res.status(200);
 *     res.setHeader('Content-Type', 'text/plain');  // Node-level, NOT res.set
 *     res.send(Buffer.from('Hello, World!\n', 'utf8'));   // Buffer, NOT string
 *
 * Logger Usage:
 *   The morgan-based `requestLogger` middleware (registered in `server.js`)
 *   already logs every HTTP request at the `http` severity level. This
 *   catch-all handler additionally emits a `debug`-level diagnostic entry
 *   that captures the method + originalUrl pair, which is useful when
 *   tracing routing decisions during development. At the default
 *   production log level (`info`), debug entries are suppressed, so this
 *   does not add to production log volume.
 *
 * Mount Point:
 *   This router is consumed by `server.js` via:
 *     const routes = require('./routes');
 *     app.use('/', routes);
 *
 *   Mounting at '/' means the router sees the full URL path. Combined
 *   with the `/{*splat}` matcher, that produces the desired global
 *   catch-all behavior.
 *
 * Out-of-Scope (per AAP §0.3.2 and Phase 9 of the agent prompt):
 *   This router intentionally does NOT include:
 *     - Additional routes beyond the catch-all
 *     - Route-specific middleware
 *     - Authentication / authorization checks
 *     - Rate limiting
 *     - CORS handling
 *     - Body parsing (globally registered in server.js)
 *     - Response negotiation, template rendering, cookies, or static files
 */

'use strict';

// -----------------------------------------------------------------------------
// 1. Module imports
// -----------------------------------------------------------------------------
//
// Imports are ordered:
//   1. Third-party packages (express)   — installed under node_modules/
//   2. Internal modules    (../config/logger) — the winston singleton
//
// CommonJS (`require(...)`) per AAP §0.8.2 ("Plain JavaScript (CommonJS)").
// No ES modules, no transpilation step.

const express = require('express');

// The winston logger singleton from `config/logger.js`. The relative path
// goes up one directory from `routes/` into the project root, then into
// `config/`. Node's CommonJS module cache returns the same singleton
// instance to every consumer (server.js, middleware/*, routes/*), so this
// router shares format, transports, and `defaultMeta` with all other logs.
//
// Usage in this module is intentionally restricted to `logger.debug(...)`
// — see "Logger Usage" in the file header for the rationale.
const logger = require('../config/logger');

// -----------------------------------------------------------------------------
// 2. Router instantiation
// -----------------------------------------------------------------------------
//
// `express.Router()` returns a fresh, isolated middleware/route stack
// (it is itself a middleware function with `.use`, `.all`, `.get`, etc.
// methods attached). Attaching routes to this Router rather than directly
// to the Express app gives `server.js` a clean composition point —
// `app.use('/', routes)` mounts the entire router as a single unit.
//
// The router exposes the per-method registration methods enumerated in
// the file's `members_exposed` schema (use, all, get, post, put, delete,
// patch, options, head) and a `stack` array that holds the registered
// layers (used by the validation suite to confirm route registration).

const router = express.Router();

// -----------------------------------------------------------------------------
// 3. Catch-all route handler
// -----------------------------------------------------------------------------
//
// Path matcher:
//   '/{*splat}' — Express 5 named splat parameter. The braces make the
//   segment optional, so this single declaration matches:
//     - GET    /                  -> req.params.splat === undefined
//     - POST   /foo               -> req.params.splat === ['foo']
//     - PUT    /a/b/c/d           -> req.params.splat === ['a','b','c','d']
//     - DELETE /foo?bar=baz       -> req.params.splat === ['foo'] (querystring ignored by matcher)
//   The captured `splat` value is intentionally ignored — the response is
//   identical regardless of path content, matching the legacy Flask
//   handler's behavior where the `path` argument is never read.
//
// Method matcher:
//   `router.all(...)` matches every HTTP method including non-standard
//   methods. The HTTP/1.1 standard methods covered are GET, POST, PUT,
//   DELETE, PATCH, OPTIONS, HEAD. Express's built-in HEAD handling
//   automatically strips the body but preserves headers.
//
// Handler signature:
//   `(req, res) => { ... }` — terminal handler; `next` is intentionally
//   omitted because the response is sent here and no downstream handler
//   in this router needs to run. The four-argument error handler signature
//   is unrelated and not applicable here.
//
// Response construction order:
//   1. `res.status(200)`                          — sets the response status
//   2. `res.setHeader('Content-Type', 'text/plain')` — sets the header
//                                                       verbatim. CRITICAL:
//                                                       uses Node's underlying
//                                                       setHeader, NOT
//                                                       Express's res.set,
//                                                       because the latter
//                                                       calls mime.contentType()
//                                                       which appends the
//                                                       charset to text/*
//                                                       MIME types.
//   3. `res.send(Buffer)`                         — writes the 14-byte body
//                                                    and ends the response.
//                                                    CRITICAL: the body is a
//                                                    Buffer, not a string —
//                                                    string bodies trigger
//                                                    Express's setCharset()
//                                                    logic which would
//                                                    re-append the charset.
//
// See the "Response-Construction Note" in the file header for the full
// code-level rationale (Express 5 response.js line references included).

router.all('/{*splat}', (req, res) => {
  // Optional route-level diagnostic logging at the `debug` severity level.
  //
  // At the default production log level (`info`), this entry is dropped at
  // the logger and never reaches any transport — so production performance
  // and log volume are unaffected.
  //
  // In development (LOG_LEVEL=debug), this entry helps developers confirm
  // that the catch-all matched a specific request, which is useful when
  // debugging route-mounting or middleware-order issues.
  //
  // The morgan-based `requestLogger` middleware (registered in `server.js`)
  // is the canonical access-log mechanism. This `logger.debug` call is a
  // supplemental, route-level diagnostic — not a replacement for morgan.
  logger.debug('catch-all handler invoked', {
    method: req.method,
    path: req.originalUrl
  });

  // Send the byte-exact response per AAP Rule R-001:
  //   - status 200
  //   - Content-Type: text/plain (no charset suffix)
  //   - body 'Hello, World!\n' (14 bytes: H e l l o , SP W o r l d ! 0x0A)
  //
  // Hex verification of the body bytes:
  //   48 65 6c 6c 6f 2c 20 57 6f 72 6c 64 21 0a
  //
  // Three Express behaviors are defeated here to preserve the byte-exact
  // contract — see the file header's "Response-Construction Note" for
  // the full code-level rationale with line references:
  //
  //   1. We do NOT use `res.type('text/plain')` (mime-types appends
  //      `; charset=utf-8` for text/* MIME types).
  //
  //   2. We do NOT use `res.set('Content-Type', 'text/plain')` either.
  //      Express's res.set runs the value through `mime.contentType(value)`
  //      for the Content-Type field, which ALSO appends `; charset=utf-8`.
  //      Instead, we use Node's underlying `res.setHeader(...)` which
  //      writes the header value verbatim.
  //
  //   3. We pass a Buffer body (not a string) to `.send(...)`. String
  //      bodies trigger Express's internal `setCharset(type, 'utf-8')`
  //      call which mutates a pre-set Content-Type from `text/plain` to
  //      `text/plain; charset=utf-8`. Buffer bodies skip that code path
  //      entirely — the pre-set header is preserved verbatim.
  //
  // `Buffer.from(s, 'utf8')` produces the identical 14-byte sequence as
  // the string literal would have on the wire, so the response body
  // bytes match the legacy Flask response exactly.
  res.status(200);
  res.setHeader('Content-Type', 'text/plain');
  res.send(Buffer.from('Hello, World!\n', 'utf8'));
});

// -----------------------------------------------------------------------------
// 4. Singleton export
// -----------------------------------------------------------------------------
//
// CommonJS default export (per AAP §0.8.2). The router instance is
// exported directly — NOT wrapped in an object — so that consumers can
// mount it cleanly:
//
//   const routes = require('./routes');
//   app.use('/', routes);
//
// Re-requiring this module returns the cached router instance via Node's
// module cache. The router is constructed exactly once per process and
// its registered routes persist for the lifetime of the application.

module.exports = router;
