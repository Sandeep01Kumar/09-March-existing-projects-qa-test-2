# hao-backprop-test

## Description

Hello World HTTP server built with Express.js 5.2.1, configured for production deployment with PM2 process manager. Responds to all HTTP requests on port 3000 with the exact response body `Hello, World!\n` and `Content-Type: text/plain`. Preserves byte-exact response parity with the prior implementations for compatibility with the Backprop integration test fixture.

## Prerequisites

- Node.js 18 or higher (LTS recommended; verified compatible with Node.js v22.x)
- npm 10 or higher
- PM2 7.0.1 (only required for production deployment; install globally via `npm install -g pm2@7`)

## Setup

Install Node.js dependencies (express, dotenv, winston, morgan, helmet, compression, nodemon, pm2):

```bash
npm install
```

Copy the environment variable template and adjust values if needed:

```bash
cp .env.example .env
```

### Environment Variables

The application reads runtime configuration from `process.env`, populated either by `.env` (loaded via `dotenv` at startup) or by the PM2 `env` / `env_production` blocks declared in `ecosystem.config.js`. All variables have safe defaults; the application runs out of the box without any overrides.

| Variable    | Default       | Purpose                                                                            |
| ----------- | ------------- | ---------------------------------------------------------------------------------- |
| `HOST`      | `127.0.0.1`   | Network interface to bind to (loopback by default)                                 |
| `PORT`      | `3000`        | TCP port to listen on                                                              |
| `NODE_ENV`  | `development` | Runtime environment (`development` or `production`)                                |
| `LOG_LEVEL` | `info`        | Winston log level (`error`, `warn`, `info`, `http`, `debug`)                       |
| `LOG_DIR`   | `./logs`      | Directory for log files                                                            |

## Running the Server

### Development

Two equivalent options are supported for local development:

- **Option A — direct execution:**

  ```bash
  npm start
  ```

  Equivalent to `node server.js`. Starts the Express application bound to `HOST:PORT` (defaults `127.0.0.1:3000`) using the configuration loaded from `.env`.

- **Option B — auto-reload via nodemon:**

  ```bash
  npm run dev
  ```

  Equivalent to `nodemon server.js`. Restarts the server automatically when source files change. Recommended during active development.

### Production (with PM2)

PM2 is the supported production process manager. It launches the Express application in cluster mode (one worker per CPU core), monitors memory and uptime, handles graceful shutdown, and ships log files to `./logs/`.

**Step 1 (one-time per host)** — install PM2 globally on the production host:

```bash
npm install -g pm2@7
```

**Step 2** — start the application under PM2 using the project's ecosystem manifest:

```bash
npm run pm2:start
```

Equivalent to `pm2 start ecosystem.config.js --env production`. PM2 reads `ecosystem.config.js`, applies the `env_production` block (which sets `NODE_ENV=production`, `LOG_LEVEL=info`, `HOST=127.0.0.1`, `PORT=3000`), and spawns `instances: 'max'` workers in `exec_mode: 'cluster'`.

**Lifecycle commands:**

| Command                | Description                                                          |
| ---------------------- | -------------------------------------------------------------------- |
| `npm run pm2:reload`   | Zero-downtime reload of all workers (cluster mode)                   |
| `npm run pm2:stop`     | Graceful stop (uses `kill_timeout: 5000` for in-flight requests)     |
| `npm run pm2:logs`     | Tail the combined stdout/stderr log stream                           |
| `pm2 status`           | View cluster status (worker count, uptime, memory, restarts)         |
| `pm2 monit`            | Interactive terminal monitor (CPU/memory per worker; optional)       |

**Auto-start on system boot (optional):**

```bash
pm2 startup        # generates a platform-specific init script (systemd/launchd/etc.)
pm2 save           # persists the current process list to be restored at boot
```

PM2 runs the app in **cluster mode** using all CPU cores when `--env production` is selected, providing horizontal scaling on a single host and zero-downtime reloads. See `ecosystem.config.js` for the full process declaration including `max_memory_restart: '512M'`, `wait_ready: true`, `listen_timeout: 10000`, and the per-environment variable blocks.

## Endpoint

- **URL:** `http://127.0.0.1:3000/`
- **Behavior:** Returns HTTP 200 with `Content-Type: text/plain` and body `Hello, World!\n` for every HTTP method (GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD) and every path. The catch-all router preserves the behavioral contract that the Backprop integration test fixture depends on.

**Quick verification:**

```bash
curl -s http://127.0.0.1:3000/
```

Expected output: `Hello, World!` (followed by a trailing newline that your shell may or may not render visibly).

**Byte-exact verification:**

```bash
curl -s http://127.0.0.1:3000/ | xxd
```

Expected output: a 14-byte body terminating with `0x0A` (the trailing newline). The first 13 bytes spell `Hello, World!` in ASCII; the 14th byte is `0x0A`.

## Project Structure

```
.
├── server.js                 # Application entry point (Express bootstrap + graceful shutdown)
├── package.json              # Node.js package manifest (dependencies, scripts, engines)
├── package-lock.json         # Pinned dependency tree for reproducible installs
├── ecosystem.config.js       # PM2 process manager configuration (cluster mode, env blocks)
├── .env.example              # Environment variable template (committed)
├── .env                      # Local environment values (gitignored)
├── .gitignore                # Git ignore rules (node_modules, .env, logs, etc.)
├── config/
│   ├── index.js              # Centralized configuration loader (reads process.env)
│   └── logger.js             # Winston logger factory (JSON format, file transports)
├── middleware/
│   ├── requestLogger.js      # Morgan HTTP request logger streamed into Winston
│   ├── errorHandler.js       # Four-argument Express error handler
│   └── notFoundHandler.js    # 404 handler for unmatched paths
├── routes/
│   └── index.js              # Express router (catch-all returning `Hello, World!\n`)
├── logs/                     # Runtime log files (gitignored; .gitkeep tracked)
└── README.md                 # This file
```

## License

MIT — see `package.json` for the formal declaration.
