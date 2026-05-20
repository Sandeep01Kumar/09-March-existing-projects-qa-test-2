/**
 * config/index.js — Centralized application configuration loader.
 *
 * Reads runtime parameters from `process.env` (populated by `dotenv` in
 * `server.js`) and exports a frozen object with safe defaults that preserve
 * backward compatibility with the legacy Flask implementation
 * (`app.py`:L22-L23):
 *
 *   - HOSTNAME = '127.0.0.1' -> config.host
 *   - PORT     = 3000        -> config.port
 *
 * Per Rule R-003 of the Agent Action Plan, this is the SOLE module in the
 * application that reads `process.env` directly. All downstream modules
 * (`config/logger.js`, `server.js`, `middleware/*`, `routes/*`) MUST import
 * this module and read structured properties (e.g., `config.host`,
 * `config.port`) instead of touching `process.env`.
 *
 * Load Order Contract (per AAP §0.4.3 and Rule R-009):
 *   1. `server.js` calls `require('dotenv').config()` as its FIRST statement.
 *   2. `server.js` then `require('./config')` — this module evaluates.
 *   3. This module reads the already-populated `process.env.*` values.
 *
 * This module does NOT call `require('dotenv').config()` itself; doing so
 * would (a) create a circular load-order dependency, and (b) force every
 * consumer to depend on dotenv whether they want it loaded or not (e.g.,
 * unit-test runners that inject env vars directly).
 *
 * Module Cache Behavior:
 *   Node's `require()` caches modules by resolved path. This module is
 *   evaluated exactly ONCE per process; subsequent `require('./config')`
 *   calls return the same frozen object. The object is frozen via
 *   `Object.freeze(...)` to prevent accidental mutation by downstream
 *   consumers — a mutation in one consumer would propagate to every other
 *   consumer through the shared cache reference.
 *
 * Defaults Rationale (cross-file consistency per AAP §0.6.5):
 *   - host    '127.0.0.1' -> matches `.env` HOST, `.env.example` HOST,
 *                            and `ecosystem.config.js` env/env_production HOST
 *   - port    3000        -> matches `.env` PORT, `.env.example` PORT,
 *                            and `ecosystem.config.js` env/env_production PORT
 *   - nodeEnv 'development' -> matches `.env` NODE_ENV (dev default);
 *                            `ecosystem.config.js` env_production overrides
 *                            to 'production'
 *   - logLevel 'info'     -> middle-ground npm severity (between dev's
 *                            'debug' and production's 'info'); winston
 *                            accepts any level string and treats unknown
 *                            levels gracefully
 *   - logDir  './logs'    -> repository-relative; PM2's `cwd: __dirname`
 *                            ensures this resolves to the project root
 *                            regardless of where `pm2 start` is invoked
 *
 * Operator (Logical OR) vs Nullish Coalescing for string fields:
 *   For `host`, `nodeEnv`, `logLevel`, and `logDir`, this module uses
 *   `||` (logical OR) rather than `??` (nullish coalescing) for defaults.
 *   Rationale: `||` treats empty strings (`''`) as fallback triggers, which
 *   is the desired behavior here (`HOST=` should fall back to '127.0.0.1',
 *   not pass an empty string through to `app.listen`). `??` would only
 *   trigger on `null`/`undefined`, allowing these invalid values to pass
 *   through.
 *
 * PORT — fail-safe validation:
 *   `config.port` does NOT use simple `||` because that pattern only
 *   guards against falsy values (NaN, 0). An operator could still set
 *   `PORT=99999`, `PORT=-1`, or `PORT=3.14` — all of which `Number(...)`
 *   coerces to a truthy but invalid value. To honor AAP §0.6.2 "safe
 *   defaults / basic validation" and the fail-safe configuration
 *   requirement, PORT is parsed by the `parsePort(...)` helper below, which
 *   validates the integer range [1, 65535] and falls back to the default
 *   3000 (with a `console.warn`) for any value outside that range. This
 *   guarantees downstream consumers can rely on `config.port` always being
 *   a valid TCP port number.
 */

'use strict';

// -----------------------------------------------------------------------------
// Default values (single source of truth)
// -----------------------------------------------------------------------------
//
// Centralizing the defaults at the top of the module makes them auditable
// at a glance and prevents subtle drift between the validation helper and
// the configuration object construction below.

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_NODE_ENV = 'development';
const DEFAULT_LOG_LEVEL = 'info';
const DEFAULT_LOG_DIR = './logs';

// Valid TCP/UDP port range per IANA / RFC 6335.
const MIN_PORT = 1;
const MAX_PORT = 65535;

// -----------------------------------------------------------------------------
// Fail-safe PORT parser
// -----------------------------------------------------------------------------
//
// `process.env.*` values are always strings (or `undefined` when unset).
// We must:
//   1. Treat unset / empty values as "use the default" silently (this is
//      the normal local-development case and emitting a warning would be
//      noisy).
//   2. Coerce numeric strings to a Number and validate that the result is
//      an integer within the valid TCP port range [1, 65535].
//   3. For any other value (non-numeric, NaN, fractional, negative,
//      zero, above 65535, etc.) emit a `console.warn` and fall back to
//      the default port. Falling back rather than letting `app.listen()`
//      reject the value (or worse, silently mis-bind) honors the AAP
//      §0.6.2 "safe defaults / basic validation" requirement and the
//      Checkpoint 1 fail-safe configuration requirement.
//
// Why `console.warn` and not `winston.warn`:
//   `config/logger.js` depends on this module (it reads `config.logDir`,
//   `config.logLevel`, `config.nodeEnv`). Calling winston from here would
//   create a circular load-order dependency. `console.warn` writes to
//   stderr immediately and is captured by PM2's `error_file`.
//
// Examples of accepted vs. rejected values:
//   PORT unset   -> returns DEFAULT_PORT silently
//   PORT=''      -> returns DEFAULT_PORT silently (operator left it blank)
//   PORT='3000'  -> returns 3000
//   PORT='1'     -> returns 1 (minimum valid port)
//   PORT='65535' -> returns 65535 (maximum valid port)
//   PORT='abc'   -> warns, returns DEFAULT_PORT (Number('abc') is NaN)
//   PORT='0'     -> warns, returns DEFAULT_PORT (port 0 is reserved)
//   PORT='-1'    -> warns, returns DEFAULT_PORT (negative)
//   PORT='99999' -> warns, returns DEFAULT_PORT (exceeds MAX_PORT)
//   PORT='3.14'  -> warns, returns DEFAULT_PORT (not an integer)

function parsePort(rawValue, defaultPort) {
  if (rawValue === undefined || rawValue === '') {
    return defaultPort;
  }
  const parsed = Number(rawValue);
  // `Number.isInteger` correctly rejects NaN, Infinity, and fractional
  // values like 3.14. The explicit range check rejects 0, negative numbers,
  // and values above the TCP port maximum.
  if (
    Number.isInteger(parsed) &&
    parsed >= MIN_PORT &&
    parsed <= MAX_PORT
  ) {
    return parsed;
  }
  // eslint-disable-next-line no-console
  console.warn(
    '[config] Invalid PORT value (' +
      String(rawValue) +
      '); valid range is ' +
      String(MIN_PORT) +
      '-' +
      String(MAX_PORT) +
      ' (integer). ' +
      'Falling back to default port=' +
      String(defaultPort) +
      '. Set a valid integer port in the environment and restart.'
  );
  return defaultPort;
}

// -----------------------------------------------------------------------------
// Configuration object construction
// -----------------------------------------------------------------------------
//
// Each property reads its corresponding `process.env.*` variable and falls
// back to the safe default when the variable is missing, empty, or invalid.
// PORT goes through the dedicated `parsePort` helper above so that invalid
// truthy values (e.g., 99999, -1, 3.14) are rejected and replaced with the
// safe default rather than being exported to downstream consumers.

const config = {
  // Network interface to bind the HTTP listener to. Defaults to the loopback
  // address to preserve the security posture of the original Flask
  // implementation (app.py:L22). Operators may override via the HOST env var
  // (e.g., HOST=0.0.0.0 to expose on all interfaces).
  host: process.env.HOST || DEFAULT_HOST,

  // TCP port to listen on. Coerced from string to number and validated via
  // `parsePort(...)`. Invalid values trigger a `console.warn` and fall back
  // to DEFAULT_PORT (3000), so downstream consumers can rely on `config.port`
  // always being a finite positive integer in the valid TCP port range.
  port: parsePort(process.env.PORT, DEFAULT_PORT),

  // Runtime mode: 'development' | 'production' | 'test'. Used by
  // `config/logger.js` to gate file transports, by `server.js` to gate the
  // `trust proxy` setting, and by `middleware/errorHandler.js` to suppress
  // stack traces in production responses (per AAP §0.8.2).
  nodeEnv: process.env.NODE_ENV || DEFAULT_NODE_ENV,

  // Winston severity threshold:
  //   error < warn < info < http < verbose < debug < silly
  // Logs at or above this level are emitted; lower-priority logs are
  // dropped. Development typically uses 'debug'; production uses 'info'.
  logLevel: process.env.LOG_LEVEL || DEFAULT_LOG_LEVEL,

  // Directory where log files are written. Relative paths resolve against
  // `process.cwd()`. PM2's `cwd: __dirname` (see `ecosystem.config.js`)
  // ensures `./logs` always resolves to the project root regardless of
  // where `pm2 start` was invoked from. `config/logger.js` is responsible
  // for ensuring this directory exists at startup (winston's File transport
  // does not create directories automatically — see AAP §0.5.3).
  logDir: process.env.LOG_DIR || DEFAULT_LOG_DIR
};

// -----------------------------------------------------------------------------
// Freeze and export
// -----------------------------------------------------------------------------
//
// `Object.freeze(config)` makes the configuration object immutable so that
// downstream modules cannot accidentally (or intentionally) mutate the
// shared config and break other modules. In strict mode, an assignment like
// `config.port = 4000` will throw a TypeError; in non-strict mode it
// silently fails. Either way, the misuse is contained.
//
// CommonJS export (per AAP §0.8.2 "Plain JavaScript (CommonJS)" — no ESM,
// no transpilation). Default export: the frozen config object.

module.exports = Object.freeze(config);
