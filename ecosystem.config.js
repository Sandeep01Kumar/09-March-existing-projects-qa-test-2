/**
 * ecosystem.config.js — PM2 Production Process Manager Manifest
 *
 * =============================================================================
 * PURPOSE
 * =============================================================================
 * This file is the declarative manifest that PM2 (Process Manager 2, v7.0.1)
 * reads when starting the Express HTTP server (`server.js`) under its cluster
 * supervisor. It is the single source of truth for:
 *
 *   - Application identity (name) and entry-point script path
 *   - Working directory (CRITICAL for dotenv resolution under PM2)
 *   - Cluster topology (instance count, execution mode)
 *   - Process restart policies (autorestart, memory threshold, max restarts)
 *   - Graceful shutdown timings and PM2 readiness signaling
 *   - PM2-managed log file paths and formatting
 *   - Environment variable blocks: default (`env`) and production (`env_production`)
 *
 * This file is READ BY PM2 ONLY. It does NOT import any application code via
 * `require()`. PM2 spawns `server.js` as a child Node.js process and merges
 * the appropriate `env*` block into that child's `process.env`.
 *
 * =============================================================================
 * INVOCATION
 * =============================================================================
 *
 *   Development (default env block applies):
 *     pm2 start ecosystem.config.js
 *
 *   Production (env_production block overrides env):
 *     pm2 start ecosystem.config.js --env production
 *
 *   Zero-downtime reload (production):
 *     pm2 reload ecosystem.config.js --env production
 *
 *   Graceful stop (sends SIGINT, waits `kill_timeout` ms, then SIGKILL):
 *     pm2 stop ecosystem.config.js
 *
 *   Tail aggregated cluster logs (uses `name` field to identify the app):
 *     pm2 logs hao-backprop-test
 *
 * The npm script aliases in `package.json` (`pm2:start`, `pm2:reload`,
 * `pm2:stop`, `pm2:logs`) wrap these commands for convenience.
 *
 * =============================================================================
 * PM2 + DOTENV INTERACTION (Critical Mitigation)
 * =============================================================================
 * Per AAP §0.5.3 and Rule R-009:
 *
 *   "dotenv relies on loading .env from the current working directory (CWD)
 *    when config() is called. PM2, however, may run your app with a
 *    different CWD than expected, or bypass the .env file entirely if
 *    misconfigured. This mismatch often leads to process.env variables
 *    being undefined."
 *
 * The mitigation is the `cwd: __dirname` field below, which forces PM2 to
 * change to the project root directory BEFORE forking the worker processes.
 * `__dirname` is a Node.js global that, at the time this manifest is
 * `require()`d by PM2, resolves to the absolute path of the directory
 * containing this file (the project root). Without `cwd: __dirname`,
 * `dotenv.config()` in `server.js` may silently fail to find `.env`
 * (because PM2 was invoked from a different directory), leaving
 * `process.env.PORT`, `process.env.HOST`, etc. as `undefined` and forcing
 * `config/index.js` to fall back to its hardcoded defaults.
 *
 * =============================================================================
 * ENV BLOCK SEMANTICS (PM2 behavior)
 * =============================================================================
 * PM2 merges environment variables into the spawned worker process as follows:
 *
 *   - `env`               — Default block; applied when `--env` is NOT passed
 *                           on the command line (i.e., `pm2 start ecosystem.config.js`)
 *   - `env_<name>`        — Named override block; activated by `--env <name>`
 *                           (e.g., `--env production` activates `env_production`)
 *
 * When `--env production` is supplied, PM2 takes the `env` block as the base
 * and overlays `env_production` on top of it (key-by-key shallow merge). In
 * this manifest, both blocks declare the SAME keys (NODE_ENV, PORT, HOST,
 * LOG_LEVEL); the production overrides change NODE_ENV and LOG_LEVEL while
 * keeping HOST and PORT bound to loopback:3000 to preserve compatibility
 * with the Backprop integration test fixture.
 *
 * Note: PM2's `--env` selection happens at app-start time only. To switch
 * envs on a running app, you must `pm2 delete <name>` then `pm2 start
 * ecosystem.config.js --env <new-env>`. `pm2 reload --env production` on an
 * app that was started with the default env will NOT switch it; it will
 * reload with the env block the app was originally started under, unless
 * the documentation has been superseded.
 *
 * =============================================================================
 * CLUSTER MODE NOTES
 * =============================================================================
 * `instances: 'max'` + `exec_mode: 'cluster'` instruct PM2 to fork one worker
 * per CPU core (using Node.js's built-in `cluster` module). All workers bind
 * to the same listening port (the kernel load-balances incoming connections
 * across the workers via SO_REUSEPORT or PM2's accept logic, depending on
 * platform).
 *
 * Cluster mode pairs with `wait_ready: true` below: PM2 forks workers one
 * at a time during a `pm2 reload` and waits for each worker to call
 * `process.send('ready')` before spawning the next. This achieves a true
 * zero-downtime reload because there is always at least one ready worker
 * accepting connections.
 *
 * `server.js` MUST emit `process.send('ready')` after `app.listen()` invokes
 * its callback. The current `server.js` implementation does this correctly
 * (guarded by `if (process.send)` so direct `node server.js` invocations,
 * where `process.send` is undefined, do not throw).
 *
 * =============================================================================
 * DELIBERATE OMISSIONS
 * =============================================================================
 * Per AAP §0.8.1, the `deploy:` block (which would declare SSH targets for
 * `pm2 deploy production setup`) is intentionally omitted. No SSH targets
 * are known; configuring a placeholder would be misleading.
 *
 * Per AAP §0.6.2 Rule 9, only `env` and `env_production` blocks are
 * declared. `env_development` is NOT added; PM2's default (no `--env` flag)
 * uses the `env` block, which already carries the development values.
 *
 * Per AAP §0.7.2 Rule R-008, no in-process log directory creation is
 * performed in this file. `config/logger.js` is responsible for ensuring
 * `./logs/` exists via `fs.mkdirSync(logDir, { recursive: true })` at
 * application startup. The `logs/.gitkeep` placeholder in version control
 * additionally guarantees the directory exists in fresh clones.
 *
 * =============================================================================
 * SCHEMA: Default export — `module.exports = { apps: [...] }`
 * =============================================================================
 */

'use strict';

module.exports = {
  // ===========================================================================
  // `apps` — Array of one application descriptor.
  //
  // PM2 supports multiple apps in a single ecosystem manifest, but this
  // repository contains exactly ONE application (the Express HTTP server).
  // Adding additional entries here would launch them under the same PM2
  // daemon — they would share the daemon's resource accounting and log
  // aggregation but each remain independently restartable.
  // ===========================================================================
  apps: [
    {
      // -----------------------------------------------------------------------
      // IDENTITY AND SCRIPT
      // -----------------------------------------------------------------------

      // `name` — Application identifier visible in `pm2 list`, `pm2 logs`,
      // `pm2 monit`, and used by `pm2 stop <name>` / `pm2 restart <name>`.
      // MUST match the `name` field in `package.json` and the argument to
      // `pm2 logs <name>` in the `pm2:logs` npm script (per AAP §0.6.5
      // "Import / Reference Consistency Requirements").
      name: 'hao-backprop-test',

      // `script` — Path to the Node.js entry-point file. PM2 resolves this
      // path RELATIVE TO `cwd` below. Using a leading `./` makes the
      // relative-path semantics explicit and matches the AAP §0.6.2
      // specification. MUST point to the file actually created by the
      // implementation agent at the project root.
      script: './server.js',

      // `cwd` — Working directory PM2 chdirs into before forking the
      // worker(s). CRITICAL per Rule R-009 to prevent the dotenv silent-
      // failure bug described in the PM2 + DOTENV INTERACTION section above.
      // `__dirname` resolves at the time PM2 `require()`s this manifest to
      // the absolute path of the directory containing `ecosystem.config.js`
      // (i.e., the project root), regardless of where `pm2 start` was
      // invoked from. This means `./server.js`, `./logs/...`, and `dotenv`'s
      // implicit `./.env` lookup all resolve correctly.
      cwd: __dirname,

      // -----------------------------------------------------------------------
      // CLUSTER AND PROCESS MANAGEMENT
      // -----------------------------------------------------------------------

      // `instances` — Number of worker processes to fork. The string literal
      // `'max'` is a PM2 keyword instructing PM2 to fork one worker per CPU
      // core available to the host (equivalent to `os.cpus().length`).
      // Combined with `exec_mode: 'cluster'`, this enables horizontal
      // scaling across cores via Node's `cluster` module. Per AAP §0.5.1
      // and Rule R-005, this is the desired production topology.
      instances: 'max',

      // `exec_mode` — Process execution model. `'cluster'` uses Node's
      // built-in `cluster` module to fork workers that share the listening
      // socket; the kernel load-balances incoming connections. `'fork'`
      // (the alternative) launches a single child process and provides
      // simpler stdio handling at the cost of single-core utilization.
      // Cluster mode is required for `instances: 'max'` to have effect and
      // is the canonical PM2 production configuration per Rule R-005.
      exec_mode: 'cluster',

      // `autorestart` — When `true`, PM2 automatically restarts the worker
      // if it exits with any non-zero code (including SIGKILL,
      // uncaught exception, OOM kill, etc.). When `false`, exit is
      // terminal and the operator must manually re-`pm2 start`. Production
      // workloads always set this to `true` so transient failures self-heal.
      autorestart: true,

      // `watch` — When `true`, PM2 monitors source files and restarts on
      // change. This is `nodemon`-like behavior intended for development
      // only. Production MUST set this to `false` because:
      //   (1) Code changes in production should be applied via `pm2 reload`
      //       to preserve zero-downtime semantics, not by uncoordinated
      //       restart on every file modification.
      //   (2) Watching disk in production wastes file-descriptor budget
      //       and inotify watches at scale.
      //   (3) The repository's `nodemon` devDependency already provides
      //       file-watching for development (via `npm run dev`).
      watch: false,

      // `max_memory_restart` — Resident set size threshold above which PM2
      // restarts the worker. PM2 polls each worker's memory every few seconds
      // and triggers a graceful restart (same path as `pm2 reload`) when the
      // RSS exceeds this value. Set to '512M' per AAP §0.6.2 — well above
      // the steady-state memory of a minimal Express app (tens of MB) but
      // low enough that a runaway leak triggers recovery before the kernel's
      // OOM killer reaps the process abruptly.
      // Accepted suffixes: K (kilobytes), M (megabytes), G (gigabytes).
      max_memory_restart: '512M',

      // `max_restarts` — Maximum number of restart attempts within the
      // `min_uptime` window before PM2 marks the app as "errored" and stops
      // attempting to restart it. This prevents an indefinite crash-loop
      // from saturating CPU/disk. After hitting this limit, the operator
      // must intervene (`pm2 restart <name>` or fix the underlying bug).
      // Per AAP §0.6.2, set to 10.
      max_restarts: 10,

      // `min_uptime` — Minimum time a worker must remain running before
      // its start is counted as "successful". A worker that crashes
      // within this window contributes to the `max_restarts` counter.
      // Per AAP §0.6.2, set to '5s' (5 seconds). This catches workers
      // that crash during early bootstrap (e.g., a require() error, an
      // immediate `listen` failure, or a synchronous startup throw).
      // Accepted suffixes: ms, s, m, h, d.
      min_uptime: '5s',

      // -----------------------------------------------------------------------
      // GRACEFUL SHUTDOWN AND PM2 READINESS SIGNALING
      // -----------------------------------------------------------------------

      // `kill_timeout` — Milliseconds PM2 waits after sending SIGINT (the
      // default shutdown signal on `pm2 stop` / `pm2 reload`) before
      // escalating to SIGKILL. `server.js`'s SIGINT/SIGTERM handlers call
      // `server.close(cb)`, which drains in-flight HTTP connections before
      // exiting. 5000 ms (5 seconds) per AAP §0.6.2 and Rule R-010 is
      // sufficient for the Hello-World endpoint (where the longest possible
      // in-flight response is a few milliseconds) while still capping the
      // worst-case shutdown time.
      kill_timeout: 5000,

      // `wait_ready` — When `true`, PM2 considers the worker "starting"
      // (not yet "online") until the worker explicitly emits
      // `process.send('ready')`. This is the cornerstone of zero-downtime
      // reloads in cluster mode: PM2 brings up the new worker, waits for
      // its `ready` signal (meaning `app.listen()` succeeded and the
      // worker is accepting connections), THEN gracefully shuts down the
      // old worker. Per Rule R-010, set to `true`.
      //
      // CONTRACT: `server.js` MUST call `process.send('ready')` inside the
      // `app.listen()` callback. The current `server.js` implementation
      // satisfies this contract (verified at lines around the listen
      // callback, with `if (process.send) { process.send('ready'); }`).
      wait_ready: true,

      // `listen_timeout` — Milliseconds PM2 waits for the `ready` signal
      // before giving up and proceeding (or failing the start, depending
      // on context). If the worker fails to emit `ready` within this
      // window, PM2 logs an error and falls back to its standard listen-
      // detection heuristic (waiting for a successful `listen` event on
      // the cluster socket).
      // Per AAP §0.6.2, set to 10000 ms (10 seconds). Generous given that
      // the Express app's bootstrap is sub-second; the margin accommodates
      // slow file-system access (cold-start log directory creation, etc.)
      // without prematurely declaring the worker hung.
      listen_timeout: 10000,

      // -----------------------------------------------------------------------
      // LOGGING (PM2-managed log files; separate from winston file transports)
      // -----------------------------------------------------------------------
      //
      // PM2 captures the worker process's stdout and stderr streams and
      // writes them to the file paths below. These are SEPARATE from the
      // winston file transports configured in `config/logger.js`:
      //
      //   - Winston transports write `winston.format.json()` records to
      //     `./logs/combined.log` and `./logs/error.log` (production only).
      //   - PM2 transports write raw stdout/stderr (which, in this app,
      //     is also winston JSON because the Console transport writes to
      //     stdout/stderr).
      //
      // The two layers are redundant by design: winston files give a
      // long-term application audit trail with structured fields; PM2 files
      // give an operator-facing "everything the process said" log that
      // includes pre-winston-init output (e.g., startup banners, dotenv
      // diagnostics) and PM2's own banners.
      //
      // The `./logs/` prefix aligns with `LOG_DIR=./logs` in `.env` and the
      // `logDir` field in `config/index.js` (per AAP §0.6.5).

      // `error_file` — File where PM2 writes the worker's stderr stream.
      // Per AAP §0.6.2.
      error_file: './logs/pm2-error.log',

      // `out_file` — File where PM2 writes the worker's stdout stream.
      // Per AAP §0.6.2.
      out_file: './logs/pm2-out.log',

      // `log_date_format` — strftime-like format string prepended to every
      // PM2-captured log line. Provides a human-readable timestamp on each
      // line even when the application itself does not include one. Used
      // alongside winston's own ISO-8601 timestamp inside each JSON
      // record — the PM2 prefix sits OUTSIDE the JSON record, so log-parsing
      // pipelines (e.g., `grep` and `jq`) can either skip past it or treat
      // it as line metadata.
      // Format: 'YYYY-MM-DD HH:mm:ss Z' per AAP §0.6.2.
      //   YYYY-MM-DD       — ISO calendar date
      //   HH:mm:ss         — 24-hour wall clock
      //   Z                — Numeric timezone offset (e.g., +0000 for UTC)
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // `merge_logs` — When `true`, all cluster workers write to the SAME
      // `out_file` and `error_file` (PM2 internally serializes the writes
      // to avoid interleaved partial lines). When `false`, PM2 appends
      // per-instance suffixes (e.g., `pm2-out-0.log`, `pm2-out-1.log`,
      // `pm2-out-2.log`, ...), which is harder to aggregate and harder
      // to ship to centralized log infrastructure.
      // Per AAP §0.6.2, set to `true` — gives a single aggregated log
      // stream per stdout/stderr regardless of worker count.
      merge_logs: true,

      // -----------------------------------------------------------------------
      // ENVIRONMENT BLOCK: DEFAULT (Development)
      // -----------------------------------------------------------------------
      //
      // The `env` block is applied to the worker's `process.env` when PM2
      // starts the app WITHOUT an `--env` flag. These values represent
      // sensible development defaults. They are intentionally identical to
      // the values declared in `.env` so that operators see consistent
      // behavior whether they:
      //   (a) Run `node server.js` directly (dotenv loads .env), or
      //   (b) Run `pm2 start ecosystem.config.js` (PM2 injects `env`).
      //
      // CONTRACT: These values must match the development defaults in
      // `config/index.js` and `.env` per AAP §0.6.5.

      env: {
        // Runtime mode. `'development'` enables Express verbose error
        // pages and the `config/logger.js` Console-only transport set
        // (no file transports written). The string is matched literally
        // by `process.env.NODE_ENV === 'production'` checks elsewhere in
        // the codebase.
        NODE_ENV: 'development',

        // TCP port to listen on. Matches `app.py`:L23 (legacy Flask) and
        // the Backprop integration test fixture's expected port.
        PORT: 3000,

        // Bind address. Loopback only — matches `app.py`:L22 and preserves
        // the security posture of the original Flask implementation.
        HOST: '127.0.0.1',

        // Winston severity threshold. `'debug'` (npm severity 7 of 7)
        // surfaces verbose logs useful when iterating on the app locally.
        LOG_LEVEL: 'debug'
      },

      // -----------------------------------------------------------------------
      // ENVIRONMENT BLOCK: PRODUCTION
      // -----------------------------------------------------------------------
      //
      // The `env_production` block is activated when PM2 is invoked with
      // `--env production`. It is layered ON TOP OF the `env` block: any
      // key present here overrides the same key in `env`; any key absent
      // here inherits from `env`. Because this block declares ALL FOUR
      // keys explicitly, this layering is deterministic and easy to audit
      // without consulting PM2 merge semantics.
      //
      // Per AAP §0.6.2 and Rule R-006, the production overrides are:
      //   - NODE_ENV: 'production' — enables Express's production
      //     optimizations (view caching, terse error pages, etc.) AND
      //     enables `config/logger.js`'s file transports
      //     (combined.log + error.log).
      //   - LOG_LEVEL: 'info'      — suppresses verbose `debug` logs
      //     that would otherwise flood production log volume.
      //
      // HOST and PORT are explicitly RE-DECLARED here (not inherited) to
      // make the production behavior fully self-documenting. An operator
      // reading just this block knows exactly what host:port the production
      // worker binds to, without having to cross-reference the `env`
      // block above.

      env_production: {
        // Switches Express and the logger into their production code paths.
        // See Rule R-006 and AAP §0.5.3 "NODE_ENV Production Optimizations".
        NODE_ENV: 'production',

        // Same port as development — the Backprop integration test fixture
        // expects port 3000 regardless of environment, and the AAP §0.8.2
        // "Port number preservation" compatibility requirement mandates this.
        PORT: 3000,

        // Loopback bind preserved in production (per AAP §0.8.2
        // "Loopback-only default binding"). Operators wishing to expose
        // the server publicly must override HOST via a process-manager-
        // injected env var or via `.env.production` and accept the changed
        // security posture deliberately.
        HOST: '127.0.0.1',

        // Production log level. `'info'` (npm severity 4 of 7) is the
        // canonical production threshold — captures warnings, errors,
        // and informational events while excluding `http`/`verbose`/
        // `debug`/`silly` chatter. Matches the `DEFAULT_LOG_LEVEL` fallback
        // in `config/index.js`.
        LOG_LEVEL: 'info'
      }
    }
  ]
};
