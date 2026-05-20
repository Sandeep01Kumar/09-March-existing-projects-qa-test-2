/**
 * config/logger.js — Winston logger factory.
 *
 * Provides a singleton winston logger instance that supplies the structured,
 * level-based application-logging substrate required by every other module
 * in the Express application:
 *
 *   - `server.js` — startup / shutdown lifecycle events
 *   - `middleware/requestLogger.js` — morgan HTTP access log stream sink
 *   - `middleware/errorHandler.js` — centralized error logging
 *   - `middleware/notFoundHandler.js` — 404 warning logs
 *   - `routes/index.js` — optional route-level diagnostics
 *
 * The logger is intentionally a singleton: Node's CommonJS module cache
 * guarantees that every `require('./logger')` call after the first returns
 * the exact same instance, so every module shares the same transports,
 * format, and `defaultMeta`.
 *
 * Configuration Source (per AAP Rule R-003):
 *   This module imports `./index` (config/index.js) and reads its
 *   `nodeEnv`, `logLevel`, and `logDir` properties. It does NOT touch
 *   `process.env` directly — config/index.js is the sole module in the
 *   application that reads environment variables. This separation keeps
 *   the env-var contract auditable in exactly one location and lets
 *   logger.js remain pure with respect to its inputs.
 *
 * Format Selection (per AAP §0.8.2):
 *   - Production (`NODE_ENV === 'production'`): JSON output with timestamp,
 *     full error stack traces, and the `service` metadata field — designed
 *     for ingestion by log aggregators (ELK, Splunk, Datadog, CloudWatch).
 *   - Non-production (development, test, etc.): Colorized, human-readable
 *     single-line output with a friendlier timestamp — designed for
 *     developer eyeballs in a terminal.
 *
 * Transport Selection (per AAP §0.5.1, §0.6.2):
 *   - Console transport is ALWAYS present (visible regardless of NODE_ENV;
 *     also captured by PM2 into pm2-out.log / pm2-error.log).
 *   - File transports (`error.log`, `combined.log`) are ONLY added when
 *     `NODE_ENV === 'production'`. Rationale: development environments
 *     don't need file logs (terminal output is sufficient), while
 *     production environments need durable on-disk records that survive
 *     terminal disconnection.
 *
 * Logs Directory Creation (per AAP §0.5.3, Rule R-008):
 *   Winston's `File` transport does not create directories automatically.
 *   Attempting to instantiate a `File` transport whose `filename` lives in
 *   a non-existent directory results in an `ENOENT` error at runtime. To
 *   prevent this, we call `fs.mkdirSync(config.logDir, { recursive: true })`
 *   at the very top of the module, BEFORE any transport construction.
 *
 *   This is paired with a committed `logs/.gitkeep` placeholder (per
 *   AAP §0.8.1) — the `.gitkeep` ensures the directory exists in fresh
 *   clones, while the `mkdirSync` here ensures it exists at runtime even
 *   if a developer/operator removed the directory between clones and
 *   `npm start`. Both layers are required: dual-defensive.
 *
 *   `recursive: true` makes the call idempotent — no error is thrown if
 *   the directory already exists or if intermediate parent directories
 *   need to be created.
 *
 * Singleton & Module Cache:
 *   The module exports the constructed `logger` (not a factory function),
 *   so re-requiring the module returns the cached instance. Every consumer
 *   sees the same transports list, the same level, and the same
 *   `defaultMeta`. Mutating any of these from one consumer will leak to
 *   every other consumer through the shared reference; this is the
 *   expected and desired behavior for a global application logger.
 *
 * PM2 Cluster Mode Caveat (per AAP §0.5.3 R-005):
 *   In cluster mode, PM2 forks N worker processes; each worker has its
 *   own winston logger instance and its own file-stream handle. All
 *   workers write to the same `error.log` / `combined.log` files. Node's
 *   filesystem writes are atomic at the line level (the libuv write
 *   syscall is single-shot), so concurrent writes from multiple workers
 *   interleave at the line boundary without corruption — this is the
 *   conventional Node.js file-logging pattern under cluster mode.
 *
 *   PM2 ALSO captures stdout/stderr of every worker into its own
 *   `pm2-out.log` / `pm2-error.log` (configured in ecosystem.config.js
 *   with `merge_logs: true`). Those PM2 logs and winston's logs serve
 *   different purposes: PM2's are unstructured process I/O capture;
 *   winston's are structured JSON suitable for ingestion.
 *
 * Out-of-Scope (per AAP §0.3.2 and §Phase 10 of the agent prompt):
 *   No remote log shipping, no daily rotation, no HTTP transport, no
 *   sampling, no audit-trail features, no exception/rejection handlers
 *   (uncaught exceptions are managed in server.js directly).
 */

'use strict';

// -----------------------------------------------------------------------------
// 1. Module imports
// -----------------------------------------------------------------------------
//
// Order:
//   1. Node.js built-ins (fs, path) — zero-cost, always available
//   2. Third-party packages (winston) — installed via npm
//   3. Internal modules (./index — the sibling config object)
//
// We intentionally do NOT require('dotenv') here. `server.js` is responsible
// for loading dotenv as the very first statement in the application; by the
// time this module is evaluated (via the require chain server -> config ->
// logger), `process.env.*` is already populated. config/index.js then reads
// those values and exposes them as structured properties — which we consume
// below.

const fs = require('fs');
const path = require('path');
const winston = require('winston');

const config = require('./index');

// -----------------------------------------------------------------------------
// 2. Dual-defensive logs directory creation
// -----------------------------------------------------------------------------
//
// Winston's File transport opens its target file with the equivalent of
// `fs.createWriteStream(filename, { flags: 'a' })`. If the directory portion
// of `filename` does not exist, this throws ENOENT and the application
// crashes at startup. The fix is to ensure the directory exists BEFORE
// constructing any File transport.
//
// Why `recursive: true`:
//   - Idempotent: no error if the directory already exists (the common case).
//   - Creates parent directories: handles `logDir` values like `./var/log/app`
//     where intermediate directories may also be missing.
//
// Why this runs at module top-level (not lazily inside a function):
//   - The transports array (Step 4 below) is constructed at module
//     evaluation time, so the directory must exist by then.
//   - Top-level execution runs exactly once per process (Node module cache),
//     so there is no performance penalty.
//
// Failure mode:
//   If `fs.mkdirSync` itself fails (e.g., permission denied, path is a file
//   not a directory), the error propagates and the application crashes at
//   startup with a clear stack trace pointing here. This is the desired
//   behavior: a misconfigured log directory is a fatal startup error, not
//   a silent runtime degradation.

fs.mkdirSync(config.logDir, { recursive: true });

// -----------------------------------------------------------------------------
// 3. Environment-aware format construction
// -----------------------------------------------------------------------------
//
// Two formats are pre-constructed so the runtime decision below is just a
// pointer selection — no work happens per-log-line beyond what each format
// chain itself performs.

const isProduction = config.nodeEnv === 'production';

// -- 3a. Production format: structured JSON --------------------------------
//
// `combine(timestamp, errors({ stack: true }), json)` is the canonical
// winston structured-logging chain (per AAP cite 27-1):
//
//   - timestamp()             -> adds ISO-8601 `timestamp` field
//   - errors({ stack: true }) -> when the log payload is an Error instance,
//                                 captures `.stack` as a string field
//                                 (otherwise winston serializes only
//                                 `.message`, losing diagnostic value)
//   - json()                  -> serializes the entry as a single JSON line
//
// The resulting output is a stream of newline-delimited JSON objects (NDJSON),
// which is the de-facto standard ingest format for log aggregators.

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// -- 3b. Development format: human-readable, colorized ---------------------
//
// Development logs are read by humans in terminals, so:
//
//   - colorize()              -> wraps the `level` token with ANSI codes
//                                 (error=red, warn=yellow, info=green, etc.)
//                                 — ONLY used in dev because ANSI escape
//                                 sequences corrupt log files and break
//                                 most log-aggregator parsers
//   - timestamp({ format })   -> short, human-friendly timestamp instead
//                                 of full ISO-8601 (which is fine for
//                                 machines but noisy for eyeballs)
//   - errors({ stack: true }) -> same as production — preserve stack traces
//   - printf(fn)              -> custom one-line layout: "timestamp [level]
//                                 [service] message {meta}\nstack" (the
//                                 stack appears on its own line, indented
//                                 implicitly by its own newlines)
//
// The `printf` callback receives the full log info object. We destructure
// the standard fields (timestamp, level, message, stack, service) and
// collect everything else into `meta` so arbitrary log payloads
// (e.g., `logger.info('req', { method, url })`) render nicely.

const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, stack, service } = info;
    // Build the `meta` view by copying everything that isn't a standard
    // field. This avoids the `Symbol.for('level')` / `Symbol.for('message')`
    // / `Symbol.for('splat')` winston internals leaking into the JSON
    // stringification below (Object spread/rest does not include symbol
    // keys, but explicit copying is clearer for future maintainers).
    const meta = {};
    for (const key of Object.keys(info)) {
      if (
        key !== 'timestamp' &&
        key !== 'level' &&
        key !== 'message' &&
        key !== 'stack' &&
        key !== 'service'
      ) {
        meta[key] = info[key];
      }
    }
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    const serviceStr = service ? ` [${service}]` : '';
    const stackStr = stack ? `\n${stack}` : '';
    return `${timestamp} [${level}]${serviceStr} ${message}${metaStr}${stackStr}`;
  })
);

// -----------------------------------------------------------------------------
// 4. Transport construction
// -----------------------------------------------------------------------------
//
// Console transport is ALWAYS present so:
//   - In development: developers see logs in their terminal.
//   - In production under PM2: PM2 captures the worker's stdout/stderr into
//     `./logs/pm2-out.log` and `./logs/pm2-error.log` (with merge_logs:true
//     in ecosystem.config.js), giving PM2's own log management visibility.
//
// File transports are added ONLY in production. Rationale:
//   - Development logs are transient and high-volume; file writes add
//     unnecessary disk I/O.
//   - Production logs are durable records needed for incident response,
//     audit, and aggregator ingestion.
//
// `error.log` filters to `level: 'error'` so it's a fast-scan file when
// debugging incidents — only the most severe entries appear.
// `combined.log` has no explicit level, so it inherits the logger-wide
// level (config.logLevel, typically `info` in production) and captures
// everything at or above that threshold.

const transports = [
  // Console transport: stdout/stderr-bound; carries every level at or
  // above the logger-wide level. No format override — inherits from the
  // top-level format below.
  new winston.transports.Console()
];

if (isProduction) {
  // Error-only file sink. `path.join` produces the correct separator on
  // POSIX (`/`) and Windows (`\`); never use string concatenation here.
  transports.push(
    new winston.transports.File({
      filename: path.join(config.logDir, 'error.log'),
      level: 'error'
    })
  );

  // Combined file sink: no `level` override means it captures everything
  // the logger-wide `level` lets through (typically info+ in production).
  transports.push(
    new winston.transports.File({
      filename: path.join(config.logDir, 'combined.log')
    })
  );
}

// -----------------------------------------------------------------------------
// 5. Logger construction
// -----------------------------------------------------------------------------
//
// `winston.createLogger` returns a logger instance with the standard npm
// severity methods bound: `logger.error`, `logger.warn`, `logger.info`,
// `logger.http`, `logger.verbose`, `logger.debug`, `logger.silly`. These
// correspond to numeric severities 0 (error) through 6 (silly), with
// `level` setting the threshold — entries strictly more severe (numerically
// less) are emitted; entries strictly less severe are dropped silently.
//
// `defaultMeta` is merged into every log entry's info object before
// formatting, so every JSON line contains `"service":"hao-backprop-test"`
// — useful for filtering this app's logs out of a multi-service log
// aggregator stream.

const logger = winston.createLogger({
  // Logger-wide severity threshold. Entries at or above this level are
  // forwarded to transports; lower-priority entries are dropped at the
  // logger level (so transports never see them).
  level: config.logLevel,

  // Format applied to every log entry before it reaches transports. Each
  // transport may further override its own format if needed, but no
  // override is configured here — all transports share this format.
  format: isProduction ? prodFormat : devFormat,

  // Static metadata merged into every log entry. The `service` field is
  // the canonical service-identifier label per AAP §0.6.2 and matches
  // the `name` field in package.json and ecosystem.config.js.
  defaultMeta: { service: 'hao-backprop-test' },

  // List of transports (already constructed above). Console always
  // present; file transports gated on isProduction.
  transports
});

// -----------------------------------------------------------------------------
// 6. Singleton export
// -----------------------------------------------------------------------------
//
// CommonJS default export (per AAP §0.8.2 — no ESM, no transpilation).
// Downstream usage:
//
//   const logger = require('./config/logger');     // from server.js
//   const logger = require('../config/logger');    // from middleware/*, routes/*
//   logger.info('Server listening on port 3000');
//   logger.error('Database connection failed', { error: err });
//   logger.http('GET /api/health 200 - 3ms');
//
// Re-requiring this module from anywhere in the application returns the
// same instance (Node module cache, keyed by resolved absolute path), so
// every module's logs flow through the same transports and share the
// same format and `defaultMeta`.

module.exports = logger;
