/**
 * middleware/requestLogger.js — Morgan HTTP access logger streamed into winston.
 *
 * Implements the canonical "two-logger pattern" for an Express application
 * (AAP §0.5.1, Rule R-004): morgan handles HTTP access logs while winston
 * handles structured application logs. By piping morgan's output through a
 * stream adapter that calls `logger.http(...)` on the winston singleton,
 * every formatted access-log line is forwarded into the same logger that
 * the rest of the application uses — so HTTP and application logs share
 * one format, one set of transports, and one severity threshold.
 *
 * Registration order (per AAP §0.5.3, enforced in server.js):
 *
 *     app.use(helmet());
 *     app.use(compression());
 *     app.use(express.json());
 *     app.use(express.urlencoded({ extended: true }));
 *     app.use(requestLogger);          // <-- this module
 *     app.use('/', routes);
 *     app.use(notFoundHandler);
 *     app.use(errorHandler);
 *
 * Placing requestLogger AFTER security/body-parsing middleware and BEFORE
 * the route handlers means every accepted request is logged exactly once,
 * including requests that body-parser would reject (those flow into the
 * downstream errorHandler, which logs the error separately at `error`
 * severity).
 *
 * Format Choice (per AAP §0.6.2):
 *   `'combined'` — Apache Combined Log Format. Captures remote address,
 *   remote user, timestamp, request line (method/URL/HTTP version),
 *   response status, content length, referrer, and user-agent. This is
 *   the de-facto standard for HTTP access logs and is rich enough for
 *   client-side incident diagnosis without resorting to custom tokens.
 *
 *   The full format string morgan expands internally:
 *     :remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version"
 *     :status :res[content-length] ":referrer" ":user-agent"
 *
 * Severity Choice (per AAP §0.5.1):
 *   `logger.http(...)` — winston's npm severity 3 (between `info` at 2 and
 *   `verbose` at 4) is reserved for HTTP access logs. Using a distinct
 *   severity lets operators filter HTTP access traffic separately from
 *   application info/warn/error logs. In production with the default
 *   `LOG_LEVEL=info`, HTTP access logs are intentionally suppressed by
 *   winston's level threshold (because http=3 is numerically greater than
 *   info=2 in npm severities) — PM2's own `logs/pm2-out.log` provides the
 *   process-level access trail at that posture. Operators who want HTTP
 *   access logs persisted in production can set `LOG_LEVEL=http` (or
 *   `debug`) in `ecosystem.config.js`'s `env_production` block.
 *
 * Stream Adapter Contract:
 *   morgan accepts a `stream` option whose value MUST be an object with a
 *   `write(message)` method (Node.js Writable-stream duck-typed interface).
 *   morgan calls `stream.write(line)` once per inbound request with a
 *   newline-terminated string (i.e., the formatted access-log line plus
 *   a trailing `\n`). The adapter below trims that trailing newline so
 *   winston's JSON/printf format produces clean entries — without `.trim()`,
 *   JSON output would contain an awkward embedded `\n` in the `message`
 *   field, and the dev printf format would emit a blank line after each
 *   request.
 *
 * Out-of-Scope (per AAP §0.3.2 and the agent prompt §Phase 8):
 *   - No custom morgan tokens (correlation IDs, response time, etc.)
 *   - No request or response body logging
 *   - No skip function (the application has no health-check endpoint; the
 *     catch-all route handles every request identically, so there is
 *     nothing meaningful to skip)
 *   - No conditional format selection (production vs development format
 *     differences live entirely in `config/logger.js`)
 *   - No metrics collection, no async hooks, no multiple morgan instances
 */

'use strict';

// -----------------------------------------------------------------------------
// 1. Module imports
// -----------------------------------------------------------------------------
//
// Order:
//   1. Third-party packages (morgan) — installed via npm (^1.10.0 per AAP
//      §0.4.1)
//   2. Internal modules (../config/logger) — relative path from the
//      `middleware/` directory up one level to `config/`
//
// We do NOT require('winston') directly; the winston instance is owned
// exclusively by `config/logger.js` which exports the configured singleton.
// This keeps the format/transports/defaultMeta configuration in exactly
// one place and lets this middleware remain ignorant of winston details.

const morgan = require('morgan');

const logger = require('../config/logger');

// -----------------------------------------------------------------------------
// 2. Stream adapter — bridges morgan's write-stream interface to winston
// -----------------------------------------------------------------------------
//
// morgan's stream option expects an object that satisfies the minimum
// Writable-stream contract: a `write(message)` method that accepts a
// single string argument. Internally morgan invokes
//
//     opts.stream.write(line + '\n')
//
// where `line` is the format-expanded access-log entry. The trailing `\n`
// is morgan's convention so that when its default stream (process.stdout)
// receives the data, each entry appears on its own terminal line.
//
// We don't want that trailing `\n` flowing into winston because:
//   - In production JSON format, the `\n` would appear as a literal
//     escape sequence inside the `"message"` field of the resulting JSON
//     object: `{"message":"GET / HTTP/1.1 200 ...\n", ...}` — valid JSON
//     but visually distracting and slightly bloating downstream tooling.
//   - In development printf format, winston itself appends a `\n` between
//     entries; morgan's `\n` would then produce a blank line after each
//     access log line.
//
// `String.prototype.trim()` removes whitespace (including `\n`) from both
// ends of the string. Morgan never produces leading whitespace, so this
// is functionally equivalent to `replace(/\n$/, '')` while being slightly
// more permissive against any future morgan format that adds extra
// trailing whitespace.
//
// `logger.http(...)` is bound on the winston logger because the default
// `npm` levels (which winston uses out of the box) include `http` at
// numeric severity 3. The winston logger emits the entry only if its
// configured `level` is at or above `http` in npm severity — see the
// header comment for the production posture rationale.

const stream = {
  write: (message) => {
    logger.http(message.trim());
  }
};

// -----------------------------------------------------------------------------
// 3. Morgan middleware construction and export
// -----------------------------------------------------------------------------
//
// `morgan('combined', { stream })` returns an Express middleware function
// with the standard `(req, res, next)` signature. The middleware:
//
//   1. Captures the request start time and headers when invoked.
//   2. Registers a one-shot listener on the response's `finish` event.
//   3. On `finish`, expands the `combined` format tokens against the
//      finalized req/res pair and calls `stream.write(formattedLine + '\n')`.
//   4. Calls `next()` synchronously so the request progresses through
//      the rest of the middleware chain.
//
// Because the log line is written on `finish` (not on entry), the captured
// `:status` reflects the actual HTTP response status, including statuses
// that downstream middleware sets via `res.status(...)` or that errorHandler
// emits for unhandled errors. This is the desired access-log semantics.
//
// We export the constructed middleware directly (not a factory) so server.js
// can register it with the canonical Express idiom:
//
//     const requestLogger = require('./middleware/requestLogger');
//     app.use(requestLogger);
//
// rather than the less-canonical `app.use(requestLogger())`. The schema for
// this file declares `requestLogger` as a default-exported function — that
// is satisfied here because CommonJS `module.exports = <fn>` is the
// idiomatic equivalent of a default function export.

module.exports = morgan('combined', { stream });
