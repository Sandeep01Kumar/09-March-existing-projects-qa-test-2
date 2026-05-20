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
 * Operator (Logical OR) vs Nullish Coalescing:
 *   This module uses `||` (logical OR) rather than `??` (nullish coalescing)
 *   for defaults. Rationale: `||` treats empty strings (`''`), `0`, and
 *   `NaN` as fallback triggers — which is the desired behavior here. For
 *   example, if an operator sets `PORT=` (empty value) or `PORT=0`, we want
 *   to fall back to the default 3000 rather than honor the broken setting.
 *   `??` would only trigger on `null`/`undefined`, allowing these invalid
 *   values to pass through.
 */

'use strict';

// -----------------------------------------------------------------------------
// Configuration object construction
// -----------------------------------------------------------------------------
//
// Each property reads its corresponding `process.env.*` variable and falls
// back to the safe default when the variable is missing, empty, or invalid.
// `Number(process.env.PORT)` returns NaN for non-numeric values, which is
// falsy, so the `|| 3000` fallback correctly handles cases like
// `PORT=abc`, `PORT=`, and unset PORT.

const config = {
  // Network interface to bind the HTTP listener to. Defaults to the loopback
  // address to preserve the security posture of the original Flask
  // implementation (app.py:L22). Operators may override via the HOST env var
  // (e.g., HOST=0.0.0.0 to expose on all interfaces).
  host: process.env.HOST || '127.0.0.1',

  // TCP port to listen on. Coerced from string to number because
  // `process.env.*` values are always strings. Downstream consumers
  // (e.g., `app.listen(config.port, ...)`) expect a numeric port per the
  // documented config object contract.
  port: Number(process.env.PORT) || 3000,

  // Runtime mode: 'development' | 'production' | 'test'. Used by
  // `config/logger.js` to gate file transports, by `server.js` to gate the
  // `trust proxy` setting, and by `middleware/errorHandler.js` to suppress
  // stack traces in production responses (per AAP §0.8.2).
  nodeEnv: process.env.NODE_ENV || 'development',

  // Winston severity threshold:
  //   error < warn < info < http < verbose < debug < silly
  // Logs at or above this level are emitted; lower-priority logs are
  // dropped. Development typically uses 'debug'; production uses 'info'.
  logLevel: process.env.LOG_LEVEL || 'info',

  // Directory where log files are written. Relative paths resolve against
  // `process.cwd()`. PM2's `cwd: __dirname` (see `ecosystem.config.js`)
  // ensures `./logs` always resolves to the project root regardless of
  // where `pm2 start` was invoked from. `config/logger.js` is responsible
  // for ensuring this directory exists at startup (winston's File transport
  // does not create directories automatically — see AAP §0.5.3).
  logDir: process.env.LOG_DIR || './logs'
};

// -----------------------------------------------------------------------------
// Defensive port-range validation
// -----------------------------------------------------------------------------
//
// The `|| 3000` fallback above already handles falsy values (`NaN`, `0`,
// missing env var). However, an operator could still set a value that
// successfully parses as a non-zero number but falls outside the valid
// TCP port range, e.g.:
//
//   PORT=99999  -> Number(...) === 99999, which is truthy, so it bypasses
//                  the `|| 3000` fallback even though it's an invalid port.
//   PORT=-1     -> Number(...) === -1, also truthy, also invalid.
//   PORT=3.14   -> Number(...) === 3.14, truthy, but not an integer.
//
// In such cases, we emit a `console.warn` (winston is not yet initialized
// at this load-order stage, since `config/logger.js` depends on this module)
// to surface the misconfiguration without throwing. The application will
// still start with the invalid value, which `app.listen()` will then either
// reject with a clearer error or silently coerce — either way, the operator
// sees the warning in the stderr stream and can correct the env var and
// restart.

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  // eslint-disable-next-line no-console
  console.warn(
    '[config] Invalid PORT value (' +
      String(process.env.PORT) +
      '); valid range is 1-65535. ' +
      'Continuing with port=' +
      String(config.port) +
      ', but `app.listen()` may reject this value. ' +
      'Set a valid integer port in the environment and restart.'
  );
}

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
