# Technical Specification

# 0. Agent Action Plan

## 0.1 Intent Clarification

This subsection establishes the precise technical interpretation of the user's enhancement request. Every implicit requirement, hidden dependency, and unstated technical implication is surfaced here so that downstream implementation can proceed without ambiguity.

### 0.1.1 Core Objective

Based on the provided requirements, the Blitzy platform understands that the objective is to **enhance the existing minimal HTTP server with the Express.js framework and prepare it for production deployment under PM2 process management**, while preserving the byte-exact behavioral contract (`HTTP/1.1 200 OK`, `Content-Type: text/plain`, body `Hello, World!\n`) that the existing implementation satisfies on `127.0.0.1:3000` for every inbound HTTP method and path [`app.py`:L26-L49].

The user's verbatim directive — *"Enhance this basic HTTP server with Express.js framework, add routing, middleware, environment config, logging, and prepare for production deployment with PM2"* — decomposes into six explicit deliverables, each restated below with full technical precision:

- **Express.js Framework Adoption** — Install Express.js 5.2.1 (the latest stable release, which requires Node.js 18 or higher) as the application's HTTP framework, replacing the current Python Flask 3.1.3 runtime [`requirements.txt`:L1].
- **Routing** — Introduce a structured routing layer where route handlers are organized in dedicated modules under a `routes/` directory and mounted on the Express application via `express.Router()` instances, in contrast to the current single-file dual-decorator catch-all pattern [`app.py`:L26-L27].
- **Middleware** — Compose request-handling concerns (request logging, error handling, security headers, response compression, body parsing) as Express middleware functions registered via `app.use(...)`, with custom middleware co-located in a dedicated `middleware/` directory.
- **Environment Configuration** — Externalize all runtime parameters (host, port, log level, environment name) into `.env` files loaded via the `dotenv` package, eliminating the hardcoded `HOSTNAME = '127.0.0.1'` and `PORT = 3000` constants that currently exist [`app.py`:L22-L23].
- **Logging** — Replace the single startup `print()` statement [`app.py`:L55] with a structured, level-based logging subsystem built on `winston` (application logs) and `morgan` (HTTP access logs), with morgan output piped into the winston transport for unified formatting and destination control.
- **PM2 Production Deployment Readiness** — Author an `ecosystem.config.js` manifest declaring the application to PM2 7.0.1 with cluster-mode execution in production, environment-specific variable blocks (`env`, `env_production`), memory-restart thresholds, log-file paths, and graceful-shutdown timings.

#### Surfaced Implicit Requirements

The user's request implies the following additional changes that are **not stated** but are **technically necessary** for a coherent Express.js production application:

- **Runtime Platform Replacement** — The current repository runs Python 3.12+ with Flask [`README.md`:L11; `app.py`:L17]. Express.js is a Node.js framework, so the enhancement implicitly requires re-introducing the Node.js runtime stack (which Node.js v22.22.2 and npm 11.1.0 are already provisioned to support) and removing the Python application surface.
- **Package Manifest Files** — `package.json` (declaring the Node.js dependencies and run scripts) and `package-lock.json` (pinning the resolved dependency graph for reproducible installs) must be created. These do not exist in the current filesystem.
- **`.gitignore`** — A `.gitignore` is required to exclude `node_modules/`, `.env`, `logs/`, and `npm-debug.log*` from version control. No `.gitignore` currently exists.
- **`.env.example`** — A non-secret template (`.env.example`) documenting the required environment variables must accompany `.env`, because `.env` itself is excluded from version control and provides no schema discoverability.
- **Logs Directory** — Winston file transports do not create directories automatically. The `logs/` directory must be created (or created on demand by the logger bootstrap) before file-based transports attempt to write.
- **README Rewrite** — The README must be rewritten to document the Node.js/Express/PM2 setup. The current README documents the Python Flask setup and explicitly warns "Do not touch!" [`README.md`:L3] — the user's enhancement directive supersedes that warning because the user has explicitly requested the enhancement.
- **Behavioral Parity Preservation** — The Backprop integration test fixture relies on byte-exact response equality (12/12 runtime HTTP tests verify the response body, status, and content type per the existing tech spec). The Express implementation must replicate `Hello, World!\n` (14 bytes with trailing `0x0A`), HTTP status 200, and `Content-Type: text/plain` for every method and every path to preserve this contract.
- **Python Artifact Removal** — `app.py` and `requirements.txt` become obsolete once Express.js takes over and must be deleted to complete the migration cleanly.

#### Dependencies and Prerequisites

| Prerequisite | Source | Status |
|---|---|---|
| Node.js 18+ (Express 5.2.1 minimum) | npm registry — express package | Node.js v22.22.2 available in environment |
| npm 10+ | npm registry | npm 11.1.0 available in environment |
| Loopback interface available | Existing constraint (Tech Spec §2.6 A-003) | Satisfied |
| Port 3000 unoccupied | Existing constraint (Tech Spec §2.6 A-003) | Satisfied |
| npm registry reachable | New prerequisite (replaces PyPI) | Required at install time |

### 0.1.2 Task Categorization

| Dimension | Classification |
|---|---|
| **Primary task type** | Mixed — Feature enhancement (routing, middleware, logging) + Configuration (environment, ecosystem) + Build/Deploy (PM2 process management) |
| **Secondary aspects** | Runtime platform replacement (Python → Node.js), Documentation update, File cleanup |
| **Scope classification** | Cross-cutting change — touches the entire application surface; replaces the single-module monolith with a multi-module Express application |

### 0.1.3 Special Instructions and Constraints

The user-provided directive contains no explicit methodological constraints (e.g., no "do not modify X" instruction, no TDD requirement, no backward compatibility clause). The following constraints are derived from the project context and **must** be honored:

- **CRITICAL — Behavioral Contract** — The HTTP response must remain byte-exact: status 200, `Content-Type: text/plain`, body `Hello, World!\n` (14 bytes including the trailing `0x0A`), for every HTTP method and every path. This is the defining behavior of feature F-001 in the existing system [Tech Spec §2.1.1] and the basis of the Backprop integration test fixture.
- **CRITICAL — Network Binding** — Default host remains `127.0.0.1` and default port remains `3000` to preserve compatibility with downstream test harnesses, though these values become overridable via environment variables (`HOST`, `PORT`).
- **Documentation Override** — The README's "Do not touch!" notice [`README.md`:L3] is superseded by the explicit user enhancement directive. The README itself must be updated to reflect the new stack.
- **Existing Tech Spec Constraint Overrides** — The existing technical specification documents three constraints that the user's directive intentionally relaxes:
    - C-001 ("No runtime configuration — hardcoded constants") → **superseded** by the environment-config requirement.
    - C-002 ("No production WSGI server") → **superseded** by the PM2 production-deployment requirement.
    - C-005 ("'Do not touch!' stability contract") → **superseded** by the explicit enhancement directive.
- **No Attachments Provided** — The user supplied no files, no Figma frames, and no external URLs. There is no design system to align with.
- **Web Search Requirements** — Best-practice research has been performed for Express 5.x release status, PM2 7.x ecosystem configuration, dotenv 16.x conventions, winston + morgan integration patterns, and helmet/compression production hardening (see §0.2.2).

### 0.1.4 Technical Interpretation

These requirements translate to the following technical implementation strategy, where each user requirement maps to specific create/modify/delete actions and concrete approach:

| User Requirement | Technical Action | Target Components |
|---|---|---|
| Express.js framework | Create Node.js package with `express ^5.2.1` as core dependency; bootstrap an Express application instance in `server.js` | `package.json`, `package-lock.json`, `server.js` |
| Routing | Extract route handlers into dedicated modules using `express.Router()`; mount the router(s) on the application; preserve a catch-all that yields the existing `Hello, World!\n` response | `routes/index.js` (CREATE), `server.js` (uses) |
| Middleware | Compose request lifecycle as a chain: security headers → compression → JSON body parser → URL-encoded body parser → request logger → routes → 404 handler → error handler | `middleware/requestLogger.js`, `middleware/errorHandler.js`, `middleware/notFoundHandler.js`, `server.js` |
| Environment configuration | Load `.env` via `dotenv` at the earliest point in the bootstrap; centralize config access in `config/index.js` with safe defaults | `.env`, `.env.example`, `config/index.js`, `server.js` |
| Logging | Configure a `winston` logger with JSON format, timestamp, and `LOG_LEVEL`-controlled severity; pipe `morgan` HTTP access logs through a stream wrapper into the winston logger | `config/logger.js`, `middleware/requestLogger.js`, `server.js` |
| PM2 production readiness | Author `ecosystem.config.js` declaring the app with cluster mode + `instances: 'max'` in production, `env_production` block, `max_memory_restart`, `error_file`/`out_file` paths, `kill_timeout`, `wait_ready` semantics | `ecosystem.config.js`, `server.js` (graceful shutdown hooks) |

To **achieve a production-ready Express.js HTTP server**, the implementation will **create** a Node.js package manifest, an Express bootstrap, modular routing, custom middleware, an externalized configuration layer, a structured logging subsystem, and a PM2 ecosystem file, by **deleting** the legacy Python Flask artifacts and **updating** the README to reflect the new stack — all while preserving the existing `Hello, World!\n` response contract that the Backprop integration test fixture depends on.

## 0.2 Repository Scope Discovery

This subsection documents the exhaustive enumeration of files that are affected by the Express.js enhancement, the supporting research conducted to validate technical approaches, and an assessment of the existing infrastructure that the enhancement supersedes.

### 0.2.1 Comprehensive File Analysis

A complete inventory of the working directory (`/tmp/blitzy/09-March-existing-projects-qa-test-2/QA-20-may-branch_307473`) was produced via `bash` enumeration. The ground-truth filesystem state contains five tracked files; **no `node_modules/`, no `package.json`, no `package-lock.json`, no `server.js`, no `.env`, no `.gitignore`, and no source-code subdirectories exist on disk**.

#### Current Repository Contents (Ground Truth)

| Path | Size | Role | Status After Enhancement |
|---|---|---|---|
| `README.md` | 25 lines | Python Flask quick-start guide; contains "Do not touch!" notice | **UPDATE** (rewrite for Node.js/Express/PM2) |
| `app.py` | 58 lines | Flask application implementing catch-all route on `127.0.0.1:3000` | **DELETE** |
| `requirements.txt` | 1 line (`Flask==3.1.3`) | pip dependency manifest | **DELETE** |
| `blitzy/documentation/Project Guide.md` | — | Historical migration documentation | **PRESERVE** (untouched) |
| `blitzy/documentation/Technical Specifications.md` | — | Prior tech spec (Python Flask migration) | **PRESERVE** (untouched; this new tech spec supersedes it) |

#### Files Affected by Search Patterns

Per the DEFAULT-flavor search-pattern protocol, the following file patterns were considered for this task type (Mixed — feature enhancement + configuration + build/deploy):

| Pattern Category | Patterns Examined | Findings |
|---|---|---|
| Documentation | `**/*.md`, `README*`, `CONTRIBUTING*`, `**/*.rst` | Only `README.md` (UPDATE) and `blitzy/documentation/*.md` (PRESERVE) |
| Configuration | `**/*.config.*`, `**/*.json`, `**/*.yaml`, `**/*.toml`, `**/*.xml`, `.env*`, `.*rc` | **None present** — all configuration files to be created |
| Source code | `src/**`, `lib/**`, `app/**`, `**/*.py`, `**/*.js`, `**/*.java` | Only `app.py` (DELETE) — no Node.js source exists |
| Build/Deploy | `Dockerfile*`, `docker-compose*`, `.github/workflows/*`, `.gitlab-ci.*`, `Makefile*`, `**/*build.*` | **None present** — `ecosystem.config.js` to be created |
| Scripts | `scripts/**`, `bin/**`, `tools/**` | **None present** — no scripts directory required |
| Tests | `tests/**`, `**/*test*.*`, `**/*spec*.*`, `test/**` | **None present** — automated test suite explicitly out of scope (Tech Spec §1.3) |
| Lockfiles | `package-lock.json`, `poetry.lock`, `Pipfile.lock` | **None present** — `package-lock.json` to be created via `npm install` |

#### Related-File Discovery

There are no existing Node.js sources to inspect for import/dependency ripples. All file relationships in the new Express application will be created from scratch:

- `server.js` will import from `./config`, `./middleware/*`, and `./routes`.
- `routes/index.js` will be imported by `server.js`.
- `middleware/*` modules will be imported by `server.js`.
- `config/index.js` will be imported by `server.js`, `routes/*`, and `middleware/*` as needed.
- `config/logger.js` will be imported wherever logging is required.
- `ecosystem.config.js` is read by PM2 only (not by application code).
- `.env` is read by `dotenv` at startup; values surface via `process.env.*`.

### 0.2.2 Web Search Research Conducted

The following research was performed to validate the technical approach against current ecosystem best practices:

| Research Topic | Key Finding |
|---|---|
| Express.js stable release | <cite index="3-2">Express latest stable version is 5.2.1 on npm</cite>; <cite index="3-14">Node.js 18 or higher is required</cite>; <cite index="5-20,5-21">Express 5.2 shipped December 1, 2025 and is the Technical Committee's endorsed production release; Organizations starting new Node.js backend projects today should use the latest Express 5.2</cite> |
| Express 5 features relevant to this task | <cite index="7-14">Express 5 modernized the codebase by dropping support for legacy Node.js versions, overhauling route matching for improved security, adding native async/await middleware support, and removing deprecated APIs</cite> |
| PM2 latest version | <cite index="38-1">PM2 latest version 7.0.1</cite>; <cite index="38-13">Supports Node.js 18+ and Bun 1+</cite> |
| PM2 ecosystem file conventions | <cite index="11-2">module.exports = { apps : [{ name, script, env_production: { NODE_ENV: "production" }, env_development: { NODE_ENV: "development" } }] }</cite>; <cite index="11-3,11-4">Run pm2 start ecosystem.json starts with default environment; pm2 start ecosystem.json --env production switches to env_production</cite> |
| PM2 production cluster mode | <cite index="12-3">For production, use cluster mode to utilize all CPU cores: { instances: 'max', exec_mode: 'cluster' }</cite>; <cite index="20-1">instances: 'max' (Use all CPU cores), exec_mode: 'cluster' (Enable cluster mode), max_memory_restart: '1G', kill_timeout: 5000, wait_ready: true, listen_timeout: 10000</cite> |
| PM2 + dotenv interaction | <cite index="44-22,44-23,44-24">dotenv relies on loading .env from the current working directory (CWD) when config() is called. PM2, however, may run your app with a different CWD than expected, or bypass the .env file entirely if misconfigured. This mismatch often leads to process.env variables being undefined</cite> — implies `cwd` must be set in the ecosystem file or dotenv must use an absolute path |
| dotenv environment per file | <cite index="37-1,37-2">Use .env for local/development, .env.production for production and so on. This still follows the twelve factor principles as each is attributed individually to its own environment</cite> |
| Winston + Morgan integration | <cite index="27-3,27-4">In Express applications, you typically need two types of logging: HTTP request logs and application logs. Morgan handles the first, Winston handles the second, and together they give you complete visibility into what your application is doing</cite>; <cite index="21-21">When you connect Morgan with a Winston logger, all your logging is formatted the same way and goes to the same place</cite> |
| Winston file transport caveat | <cite index="23-14,23-15">Winston's file transport does not create directories automatically. You need to create the logs/ directory before starting the application</cite> |
| Express production hardening | <cite index="35-3,35-5,35-6">npm install express dotenv cors helmet morgan; In production, devDependencies are not installed automatically. This is critical. if (process.env.NODE_ENV === "production") { app.set("trust proxy", 1); } Set in production: NODE_ENV=production</cite> |
| Helmet security headers | <cite index="33-5">Helmet.js is a Node.js middleware collection for Express apps that automatically sets secure HTTP headers</cite> |
| Winston structured logging | <cite index="27-1">winston.createLogger({ level: process.env.LOG_LEVEL || 'info', format: winston.format.combine( winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json() ), defaultMeta: { service: 'express-api' }, transports: [ new winston.transports.Console() ] })</cite> |

### 0.2.3 Existing Infrastructure Assessment

| Dimension | Current State | Post-Enhancement Target |
|---|---|---|
| **Project structure** | Single-Module Monolith: one `app.py` file [Tech Spec §5.1] | Multi-module Express application with `routes/`, `middleware/`, `config/` directories |
| **Runtime** | Python 3.12+ [`README.md`:L11] | Node.js 18+ (verified Node v22.22.2 in environment) |
| **HTTP framework** | Flask 3.1.3 [`requirements.txt`:L1] | Express 5.2.1 |
| **Dependency manifest** | `requirements.txt` (1 direct + 6 transitive) | `package.json` + `package-lock.json` |
| **Execution** | `python app.py` (direct interpreter execution) | `node server.js` (development) or `pm2 start ecosystem.config.js --env production` (production) |
| **Configuration** | Hardcoded `HOSTNAME = '127.0.0.1'`, `PORT = 3000` [`app.py`:L22-L23] | `.env`-based `HOST`, `PORT`, `NODE_ENV`, `LOG_LEVEL` |
| **Logging** | Single `print()` on startup [`app.py`:L55] | Winston structured JSON logs + Morgan HTTP access logs |
| **Process management** | Foreground interpreter; no daemon, no restart, no clustering | PM2 with cluster mode in production, autorestart, memory-restart, graceful shutdown |
| **Build configuration** | None (no `pyproject.toml`, no `setup.py`) [Tech Spec §3.1.1] | `package.json` with `start`, `dev`, `pm2:start`, `pm2:reload` scripts |
| **VCS hygiene** | No `.gitignore` | `.gitignore` excluding `node_modules/`, `.env`, `logs/`, `npm-debug.log*` |
| **Documentation** | `README.md` (25 lines, Python Flask) [`README.md`:L1-L25] | `README.md` rewritten for Node.js / Express / PM2 |
| **Patterns/conventions** | PEP 8 module-level constants; dual-decorator catch-all pattern | CommonJS modules; `express.Router()`; middleware composition via `app.use(...)` |

## 0.3 Scope Boundaries

This subsection establishes the precise boundary between what the Express.js enhancement effort will and will not touch. Files and behaviors listed under "Exhaustively In Scope" are mandatory deliverables; items under "Explicitly Out of Scope" must not be created, modified, or deleted.

### 0.3.1 Exhaustively In Scope

#### Source Code (CREATE)

- `server.js` — Express application entry point that loads dotenv, instantiates the Express app, registers middleware in correct order, mounts routers, binds the HTTP server, and registers graceful-shutdown signal handlers for PM2 compatibility.
- `routes/index.js` — Express `Router` exporting the catch-all route that responds with `Hello, World!\n` for every method and every path; mounted on the root of the app.
- `middleware/requestLogger.js` — Morgan-based HTTP request logger configured to stream into the winston logger; respects `LOG_LEVEL` and skips noisy paths if needed.
- `middleware/errorHandler.js` — Four-argument Express error-handling middleware that logs errors via winston and returns a JSON `{ error: 'Internal server error' }` body with HTTP 500.
- `middleware/notFoundHandler.js` — Final catch handler that fires only if no route matches; logs the unmatched path at `warn` level and returns 404. *(Defensively present even though the route layer is intentionally catch-all; ensures correct behavior if the route module changes in the future.)*
- `config/index.js` — Centralized configuration loader that surfaces `HOST`, `PORT`, `NODE_ENV`, `LOG_LEVEL`, and `LOG_DIR` from `process.env` with safe defaults and basic validation.
- `config/logger.js` — Winston logger factory exporting a singleton logger with JSON format, timestamp, `errors({ stack: true })`, `defaultMeta: { service: 'hao-backprop-test' }`, console transport always, and file transports gated on `NODE_ENV === 'production'`.

#### Configuration (CREATE)

- `package.json` — npm package manifest declaring `name`, `version`, `description`, `main: server.js`, `scripts` (`start`, `dev`, `pm2:start`, `pm2:reload`, `pm2:stop`), `dependencies`, `devDependencies`, `engines.node` (`>=18.0.0`), and `license`.
- `package-lock.json` — Generated by `npm install` to pin the resolved dependency tree for reproducible builds.
- `.env` — Local development environment file with `HOST=127.0.0.1`, `PORT=3000`, `NODE_ENV=development`, `LOG_LEVEL=debug`, `LOG_DIR=./logs`.
- `.env.example` — Non-secret template documenting the same keys as `.env` for use by other developers and CI.
- `ecosystem.config.js` — PM2 ecosystem manifest declaring the app with `name: 'hao-backprop-test'`, `script: './server.js'`, default `env` block (development), `env_production` block (production), `instances: 'max'`, `exec_mode: 'cluster'`, `max_memory_restart: '512M'`, `error_file: './logs/pm2-error.log'`, `out_file: './logs/pm2-out.log'`, `log_date_format`, `merge_logs: true`, `kill_timeout: 5000`, `wait_ready: true`, `listen_timeout: 10000`, `autorestart: true`, `max_restarts: 10`, `min_uptime: '5s'`.

#### Build/VCS Hygiene (CREATE)

- `.gitignore` — Excludes `node_modules/`, `.env`, `.env.local`, `logs/`, `*.log`, `npm-debug.log*`, `yarn-debug.log*`, `yarn-error.log*`, `.pm2/`, and OS artifacts (`.DS_Store`, `Thumbs.db`).
- `logs/.gitkeep` — Empty placeholder ensuring the `logs/` directory exists in version control while the actual log files are gitignored.

#### Documentation (UPDATE)

- `README.md` — Full rewrite documenting Node.js prerequisite, `npm install`, `node server.js` for development, `pm2 start ecosystem.config.js --env production` for production, environment variable reference, and unchanged endpoint URL `http://127.0.0.1:3000/`.

#### Files to DELETE (Python Stack Removal)

- `app.py` — Flask application, fully obsolete after Express takes over.
- `requirements.txt` — pip dependency manifest, no longer relevant once Flask is removed.

#### Generalized Wildcard Patterns

| Pattern | Coverage | Mode |
|---|---|---|
| `routes/**/*.js` | All routing modules under `routes/` | CREATE |
| `middleware/**/*.js` | All custom middleware modules under `middleware/` | CREATE |
| `config/**/*.js` | All configuration modules under `config/` | CREATE |
| `.env*` (excluding `.env.example`) | Environment files | CREATE |
| `logs/**` | Runtime log artifacts | CREATE (`.gitkeep`); runtime-managed |
| `package*.json` | Package manifest and lockfile | CREATE |
| `*.config.js` (specifically `ecosystem.config.js`) | PM2 ecosystem manifest | CREATE |

### 0.3.2 Explicitly Out of Scope

The following items are **not** part of this enhancement and must not be introduced, modified, or removed by the implementation:

- **TLS / HTTPS termination** — The server remains plain HTTP on the loopback interface. No certificate provisioning, no `https.createServer()`, no Let's Encrypt integration.
- **Database integration** — No database driver, ORM, connection pool, or persistence layer. The application remains stateless and deterministic (consistent with the existing system per Tech Spec §5.1).
- **Authentication / Authorization** — No JWT, no session middleware, no `passport`, no API-key validation. The endpoint remains anonymous.
- **CORS configuration** — Not requested. Even if `cors` middleware were added later, it is excluded from this scope unless explicitly requested.
- **Rate limiting** — `express-rate-limit` is mentioned in best-practice literature but is not part of the user's directive and is excluded.
- **Body parsing for arbitrary payloads beyond defaults** — `express.json()` and `express.urlencoded({ extended: true })` may be included as defensive middleware, but no custom multipart, XML, or streaming parsers.
- **Automated test suite** — No `tests/`, `__tests__/`, no Jest/Mocha/Supertest configuration, no test scripts in `package.json` beyond a placeholder. Tech Spec §1.3 explicitly excludes test infrastructure, and the user's directive does not request it.
- **CI/CD pipelines** — No `.github/workflows/`, no GitLab CI, no Jenkinsfile. The PM2 ecosystem file's `deploy:` block is not configured (no SSH targets are known).
- **Containerization** — No `Dockerfile`, no `docker-compose.yml`, no `.dockerignore`. PM2 is the deployment surface, not Docker.
- **Orchestration** — No Kubernetes manifests, no Helm charts, no systemd unit files. `pm2 startup` is documented as a manual step in the README but the unit file is not pre-generated.
- **Cloud-provider integrations** — No AWS/GCP/Azure SDKs, no cloud-storage transports for winston, no APM agents (New Relic, Datadog).
- **Frontend assets / templating engines** — No EJS, no Handlebars, no static-file serving beyond a minimal `express.static` placeholder *(which itself is excluded unless explicitly required)*. The application has no UI surface.
- **TypeScript** — The project remains plain JavaScript (CommonJS modules). No `tsconfig.json`, no `.ts` files, no transpilation step.
- **Linting / formatting tooling** — No ESLint, no Prettier, no Husky pre-commit hooks unless they already exist (they do not).
- **`blitzy/documentation/*`** — The existing documentation hub is preserved untouched. It documents the prior Python migration and remains as historical context; this new Technical Specifications document (the one being authored) supersedes it.
- **Backprop integration pipeline** — The downstream consumer pipeline itself is out of scope; only the response contract it relies upon (`HTTP 200`, `text/plain`, `Hello, World!\n`) must be preserved.

## 0.4 Dependency Inventory

This subsection lists every package introduced, removed, or updated by the Express.js enhancement. All version selections reflect the highest explicitly documented stable release confirmed via the npm registry and the corresponding project documentation as of the research window.

### 0.4.1 Key Packages

| Registry | Package Name | Version | Purpose |
|---|---|---|---|
| npm | `express` | `^5.2.1` | Web application framework; HTTP routing, middleware chaining, request/response API |
| npm | `dotenv` | `^16.4.5` | Loads environment variables from `.env` files into `process.env` at application startup |
| npm | `winston` | `^3.13.0` | Structured application logger with multiple transports (console, file) and JSON formatting |
| npm | `morgan` | `^1.10.0` | HTTP request logging middleware for Express; streams formatted access logs into winston |
| npm | `helmet` | `^8.0.0` | Sets secure HTTP response headers (`X-Frame-Options`, `Strict-Transport-Security`, `X-Content-Type-Options`, etc.) |
| npm | `compression` | `^1.7.5` | gzip response compression middleware |
| npm | `pm2` | `^7.0.1` | Production process manager with cluster mode, autorestart, and log management |
| npm (dev) | `nodemon` | `^3.1.0` | Development-only file-watcher that auto-restarts the server on source changes |

### 0.4.2 Dependency Updates

#### New Dependencies to Add

- `express` `^5.2.1` — Core HTTP framework; required for routing, middleware, and request/response handling. <cite index="3-2">Latest version: 5.2.1</cite>.
- `dotenv` `^16.4.5` — Required to satisfy the "environment config" requirement; loads `.env` files into `process.env`.
- `winston` `^3.13.0` — Required to satisfy the "logging" requirement; provides structured, level-based application logging.
- `morgan` `^1.10.0` — Required to satisfy the "middleware" + "logging" requirements; provides HTTP request logging as middleware.
- `helmet` `^8.0.0` — Production-hardening middleware satisfying the "prepare for production deployment" requirement.
- `compression` `^1.7.5` — Production-hardening middleware satisfying the "prepare for production deployment" requirement.
- `pm2` `^7.0.1` — Required to satisfy the "prepare for production deployment with PM2" requirement; provides process management. <cite index="38-1">PM2 latest version 7.0.1</cite>. Listed as a project dependency for reproducibility; also intended to be installed globally on production hosts.
- `nodemon` `^3.1.0` — Development-only convenience tool, listed under `devDependencies`.

#### Dependencies to Remove (Python → Node.js Migration)

- `Flask==3.1.3` — Direct dependency removed alongside `app.py` deletion [`requirements.txt`:L1].
- `Werkzeug 3.1.8` (transitive) — Removed when Flask is removed.
- `Jinja2 3.1.6` (transitive) — Removed when Flask is removed.
- `MarkupSafe 3.0.3` (transitive) — Removed when Flask is removed.
- `ItsDangerous 2.2.0` (transitive) — Removed when Flask is removed.
- `Click 8.3.1` (transitive) — Removed when Flask is removed.
- `Blinker 1.9.0` (transitive) — Removed when Flask is removed.

The removal is achieved by deleting `requirements.txt`. Any installed virtualenv is left to the developer's discretion; the repository itself carries no Python footprint after this change.

#### Dependencies to Update

None. The Express stack is being introduced fresh; there are no pre-existing Node.js packages to upgrade.

### 0.4.3 Import / Reference Updates

The migration replaces Python imports with Node.js CommonJS `require(...)` statements. The old import surface exists only in `app.py` (which is being deleted), so there is no in-place import rewrite — the imports in the new Node.js files are entirely new.

#### Import Transformation Rules

| Concern | Old (Python) | New (Node.js / CommonJS) | Applies To |
|---|---|---|---|
| HTTP framework | `from flask import Flask, Response` | `const express = require('express');` | `server.js`, `routes/**/*.js` |
| Application factory | `app = Flask(__name__)` | `const app = express();` | `server.js` |
| Router | `@app.route('/...', methods=[...])` | `const router = express.Router(); router.all('*', handler);` | `routes/index.js` |
| Response | `Response('Hello, World!\n', status=200, content_type='text/plain')` | `res.status(200).type('text/plain').send('Hello, World!\n');` | `routes/index.js` |
| Environment loader | (none — hardcoded constants) | `require('dotenv').config();` (called before any other require that reads `process.env`) | `server.js` (first import); `ecosystem.config.js` may also use `env_file` |
| Logger | `print(f'...')` | `const logger = require('./config/logger'); logger.info('...');` | `server.js`, `middleware/**/*.js`, `routes/**/*.js` |
| Network binding | `app.run(host=HOSTNAME, port=PORT)` | `app.listen(config.port, config.host, () => { ... });` | `server.js` |
| Run command | `python app.py` | `node server.js` (development) <br> `pm2 start ecosystem.config.js --env production` (production) | `README.md`, `package.json scripts.start`, `package.json scripts.pm2:start` |

#### Files Requiring Import / Reference Updates

| File Pattern | Update Type | Reason |
|---|---|---|
| `server.js` (CREATE) | New imports | Entry point requires Express, dotenv, middleware, routes, logger, config |
| `routes/**/*.js` (CREATE) | New imports | Routers require Express and logger |
| `middleware/**/*.js` (CREATE) | New imports | Middleware requires Express types (implicit), winston logger, morgan |
| `config/**/*.js` (CREATE) | New imports | Config requires dotenv (already loaded by server.js, but logger may need direct `process.env` access) and winston |
| `package.json` (CREATE) | Dependency declarations | All dependencies listed under `dependencies` and `devDependencies` |
| `ecosystem.config.js` (CREATE) | No npm imports | PM2 reads this file directly; it exports a plain object via `module.exports = { apps: [...] }` |
| `README.md` (UPDATE) | Command references | All references to `python app.py` and `pip install` replaced with Node.js/PM2 equivalents |

## 0.5 Implementation Design

This subsection describes the technical approach, component impact, design patterns, and critical implementation details that operationalize the Express.js enhancement. The content is organized by logical implementation flow (not by schedule); each part may be executed in parallel or in sequence as the implementation team prefers.

### 0.5.1 Technical Approach

The enhancement is achieved by **constructing a modular Node.js Express application that supersedes the current Python Flask single-module monolith**, while **preserving the byte-exact HTTP response contract** that the Backprop integration test fixture depends on.

#### Primary Objectives and Implementation Approach

- **Achieve Express.js adoption** by **creating** `package.json` declaring `express ^5.2.1` and a `server.js` entry point that instantiates the Express application with `const app = express();` — replacing the Flask application factory `app = Flask(__name__)` from [`app.py`:L18].
- **Achieve modular routing** by **creating** `routes/index.js` that exports an `express.Router()` with a catch-all handler (`router.all('*', handler)`) — replacing the dual-decorator pattern at [`app.py`:L26-L27] with a single Express router method that handles all HTTP verbs.
- **Achieve middleware-based request processing** by **creating** custom middleware modules in `middleware/` and registering them on the Express app in the canonical order: security → compression → body parsing → request logging → routes → 404 handler → error handler. This contrasts with the Flask monolith where every concern lives inside the single `catch_all` handler.
- **Achieve externalized configuration** by **creating** `.env` and `.env.example` files declaring `HOST`, `PORT`, `NODE_ENV`, `LOG_LEVEL`, `LOG_DIR`; **loading** them via `require('dotenv').config()` at the top of `server.js`; and **centralizing** access through `config/index.js` — replacing the hardcoded `HOSTNAME = '127.0.0.1'` and `PORT = 3000` constants at [`app.py`:L22-L23].
- **Achieve structured logging** by **creating** `config/logger.js` that constructs a `winston` logger with JSON format, timestamp, and `defaultMeta: { service: 'hao-backprop-test' }`, and by **creating** `middleware/requestLogger.js` that wraps `morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } })` so that HTTP access logs are formatted identically to application logs — superseding the single `print()` at [`app.py`:L55].
- **Achieve PM2 production readiness** by **creating** `ecosystem.config.js` with `instances: 'max'`, `exec_mode: 'cluster'`, environment-specific blocks, `max_memory_restart: '512M'`, graceful-shutdown settings (`kill_timeout: 5000`, `wait_ready: true`, `listen_timeout: 10000`), and PM2 log file paths.

#### Logical Implementation Flow

The implementation can proceed through the following logical layers. Note that these are sequenced for clarity, not scheduled — they describe dependency order, not time.

- **First, establish the Node.js package foundation** by creating `package.json` with the dependency list, adding `engines.node: '>=18.0.0'`, and running `npm install` to generate `package-lock.json` and populate `node_modules/`.
- **Next, externalize configuration** by creating `.env`, `.env.example`, and `config/index.js` so subsequent modules can read settings via `require('./config')`.
- **Next, build the logging substrate** by creating `config/logger.js` that exports a configured winston instance, ensuring `logs/` exists at startup (via `fs.mkdirSync(logDir, { recursive: true })` <cite index="23-14,23-15">because Winston's file transport does not create directories automatically; you need to create the logs/ directory before starting the application</cite>).
- **Next, compose the middleware layer** by creating `middleware/requestLogger.js`, `middleware/errorHandler.js`, and `middleware/notFoundHandler.js`, each importing the logger and exporting a function suitable for `app.use(...)`.
- **Next, build the routing layer** by creating `routes/index.js` that defines the catch-all handler preserving the `Hello, World!\n` response.
- **Next, integrate everything in `server.js`** by loading dotenv, instantiating Express, registering middleware in canonical order, mounting the router, binding the HTTP server to `config.host:config.port`, and registering `SIGINT`/`SIGTERM` handlers that close the server gracefully and emit `process.send('ready')` for PM2's `wait_ready` semantics.
- **Next, declare the PM2 manifest** by creating `ecosystem.config.js` with the production cluster configuration and environment-specific overrides.
- **Next, harden VCS hygiene** by creating `.gitignore` excluding `node_modules/`, `.env`, `logs/`, and PM2 artifacts.
- **Finally, decommission the Python stack** by deleting `app.py` and `requirements.txt`, and rewriting `README.md` to document the Node.js / Express / PM2 setup.

### 0.5.2 Component Impact Analysis

#### Direct Modifications Required

- **`README.md`** — Replace the Python-centric quick-start with Node.js / Express / PM2 instructions. Remove the "Do not touch!" notice (superseded by the user's explicit enhancement directive). Add environment variable reference and PM2 commands.

#### Components to Delete

- **`app.py`** — The entire Flask application is removed; its behavioral contract is now satisfied by the Express implementation.
- **`requirements.txt`** — Becomes meaningless once `app.py` is removed; deleted to complete the Python decommissioning.

#### New Components Introduced

- **`server.js`** — Application bootstrap and lifecycle manager. Responsibilities: load `.env`, validate config, construct the Express app, register middleware, mount routers, bind HTTP listener, signal PM2 readiness, install graceful-shutdown handlers. *Rationale*: PM2 ecosystem files reference a single `script` entry; centralizing bootstrap here keeps the manifest simple and supports cluster mode without code duplication.
- **`routes/index.js`** — Catch-all router module exporting `express.Router()`. *Rationale*: encapsulates the routing concern in its own module so additional routes can be added without modifying `server.js`.
- **`middleware/requestLogger.js`** — Morgan-based HTTP access logger streaming into winston. *Rationale*: <cite index="27-3,27-4">In Express applications, you typically need two types of logging: HTTP request logs and application logs. Morgan handles the first, Winston handles the second, and together they give you complete visibility into what your application is doing</cite>.
- **`middleware/errorHandler.js`** — Four-argument Express error handler. *Rationale*: Express 5 introduces native async/await middleware error propagation; a dedicated central handler ensures every error path is logged and surfaces a consistent JSON error body to clients.
- **`middleware/notFoundHandler.js`** — 404 handler that runs when no route matches. *Rationale*: Defensive layer to log unmatched paths even though the current router intentionally matches everything; future-proofs the application against route refactors.
- **`config/index.js`** — Centralized config object with safe defaults (`HOST=127.0.0.1`, `PORT=3000`, `NODE_ENV=development`, `LOG_LEVEL=info`, `LOG_DIR=./logs`). *Rationale*: Single source of truth for runtime parameters; downstream modules import `require('./config')` instead of reading `process.env` directly, easing testing and future schema validation.
- **`config/logger.js`** — Winston logger factory. *Rationale*: Centralizes log format, level, transport configuration in one module so the rest of the codebase simply imports a configured logger.
- **`ecosystem.config.js`** — PM2 ecosystem manifest. *Rationale*: <cite index="13-5">Always use ecosystem.config.js in production for reproducibility</cite>. Declarative configuration is preferable to CLI flags scattered across deployment scripts.
- **`.env` and `.env.example`** — Environment files. *Rationale*: Twelve-factor compliance; <cite index="37-1">Use .env for local/development, .env.production for production</cite>.
- **`.gitignore`** — VCS hygiene. *Rationale*: Prevent accidental commit of secrets (`.env`), unbounded artifacts (`node_modules/`, `logs/`), and OS-specific files.

#### Indirect Impacts and Dependencies

- **Existing Tech Spec constraints C-001, C-002, C-005** — The current technical specification is being superseded by this new document; the new Tech Spec must capture the relaxation of these constraints as a deliberate, user-authorized change.
- **Backprop test harness** — No change to the harness itself; the response contract is preserved. The harness must continue to receive HTTP 200 with `Content-Type: text/plain` and body `Hello, World!\n` for every request.
- **Node.js runtime expectation** — Operators must have Node.js 18+ available; the README must call this out as a prerequisite (replacing the current Python 3.12+ prerequisite).

### 0.5.3 Critical Implementation Details

#### Middleware Registration Order

Order matters in Express because middleware executes top-to-bottom in registration order. The required order is:

```javascript
// server.js (abbreviated)
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./config');
const logger = require('./config/logger');
const requestLogger = require('./middleware/requestLogger');
const notFoundHandler = require('./middleware/notFoundHandler');
const errorHandler = require('./middleware/errorHandler');
const routes = require('./routes');

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use('/', routes);
app.use(notFoundHandler);
app.use(errorHandler);
```

#### Catch-All Route Preserving Response Parity

The router must use `router.all('*', handler)` (or in Express 5, `router.all('/{*splat}', handler)` to satisfy the stricter path matcher) and emit a response body that is byte-exact equal to `Hello, World!\n` (14 bytes, terminating with `0x0A`). The `Content-Type` must be `text/plain` (not `text/plain; charset=utf-8` unless the existing system already emits charset — verification against [`app.py`:L49] shows `content_type='text/plain'` with no charset, so the Express implementation must match that exactly, achievable via `res.set('Content-Type', 'text/plain').status(200).send('Hello, World!\n')`).

#### PM2 Cluster Mode and Graceful Shutdown

Cluster mode allows zero-downtime reloads but requires the application to signal readiness and handle `SIGINT`/`SIGTERM` correctly. The `server.js` must:

- Call `process.send('ready')` once `app.listen()` invokes its callback (only when running under PM2 — guarded by `if (process.send)`).
- Register a `SIGINT`/`SIGTERM` handler that calls `server.close(() => process.exit(0))` to drain in-flight requests before exit.
- Set `wait_ready: true` and `listen_timeout: 10000` in `ecosystem.config.js` so PM2 waits for the `ready` signal.

#### Logger and File-Transport Caveat

Winston's `File` transport does not create directories — <cite index="23-14,23-15">Winston's file transport does not create directories automatically; You need to create the logs/ directory before starting the application</cite>. `config/logger.js` must call `fs.mkdirSync(logDir, { recursive: true })` before instantiating the file transports.

#### PM2 + dotenv Interaction

<cite index="44-22,44-23,44-24">dotenv relies on loading .env from the current working directory (CWD) when config() is called. PM2, however, may run your app with a different CWD than expected, or bypass the .env file entirely if misconfigured. This mismatch often leads to process.env variables being undefined</cite>. The `ecosystem.config.js` must set `cwd: __dirname` to ensure dotenv finds `.env` reliably regardless of where `pm2 start` is invoked from.

#### NODE_ENV Production Optimizations

<cite index="35-5,35-6">Set in production: NODE_ENV=production. Enables performance optimizations, helps logging decisions, affects caching, enables secure cookies</cite>. The `env_production` block in `ecosystem.config.js` must explicitly set `NODE_ENV: 'production'` so Express enables its production code paths (view-cache, less verbose error output) and the logger writes to file transports.

### 0.5.4 User-Provided Examples Integration

The user's directive contains no code examples or design samples to map. The only literal artifact the user provided is the requirement statement itself, which is preserved verbatim in §0.7 (Rules).

### 0.5.5 Design System Compliance

**Not applicable.** This is a backend HTTP server with no UI surface. No component library, design system, Figma frame, or visual specification is part of this enhancement. The Design System Alignment Protocol is therefore not invoked.

## 0.6 File Transformation Mapping

This subsection provides the exhaustive file-by-file execution plan for the Express.js enhancement. Every file the implementation must touch is listed below with its transformation mode (CREATE / UPDATE / DELETE / REFERENCE), its source reference, and its purpose. No file is deferred or left for later discovery.

### 0.6.1 File-by-File Execution Plan

| Target File | Transformation | Source File / Reference | Purpose / Changes |
|---|---|---|---|
| `package.json` | CREATE | None (greenfield) | Declare Node.js package: `name: 'hao-backprop-test'`, `version: '1.0.0'`, `description`, `main: 'server.js'`, `engines.node: '>=18.0.0'`, `scripts` (`start`, `dev`, `pm2:start`, `pm2:reload`, `pm2:stop`, `pm2:logs`), `dependencies` (express, dotenv, winston, morgan, helmet, compression), `devDependencies` (nodemon), and `license` |
| `package-lock.json` | CREATE | Generated by `npm install` | Pin the resolved dependency tree (express 5.2.1 + transitive packages) for reproducible installs |
| `server.js` | CREATE | `app.py` (REFERENCE for behavioral parity) | Express application entry point: load dotenv first, instantiate `express()`, register middleware in canonical order (helmet → compression → json/urlencoded → requestLogger → routes → notFoundHandler → errorHandler), bind HTTP listener to `config.host:config.port`, register `SIGINT`/`SIGTERM` graceful-shutdown handlers, emit `process.send('ready')` for PM2 `wait_ready` |
| `routes/index.js` | CREATE | `app.py`:L26-L49 (REFERENCE for catch-all behavior) | Export `express.Router()` with `router.all('/{*splat}', handler)` that responds with HTTP 200, `Content-Type: text/plain`, body `Hello, World!\n` for every method and every path |
| `middleware/requestLogger.js` | CREATE | None (greenfield) | Export Express middleware wrapping `morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } })`; imports `winston` logger from `config/logger.js` |
| `middleware/errorHandler.js` | CREATE | None (greenfield) | Export four-argument `(err, req, res, next) => { logger.error(...); res.status(err.status || 500).json({ error: 'Internal server error' }); }` middleware |
| `middleware/notFoundHandler.js` | CREATE | None (greenfield) | Export Express middleware that logs unmatched paths at `warn` level and returns HTTP 404 with JSON body `{ error: 'Not Found' }`; defensive layer never reached during normal operation because the route module is intentionally catch-all |
| `config/index.js` | CREATE | `app.py`:L22-L23 (REFERENCE for default values) | Export `{ host: process.env.HOST \|\| '127.0.0.1', port: Number(process.env.PORT) \|\| 3000, nodeEnv: process.env.NODE_ENV \|\| 'development', logLevel: process.env.LOG_LEVEL \|\| 'info', logDir: process.env.LOG_DIR \|\| './logs' }` with basic validation of `PORT` |
| `config/logger.js` | CREATE | None (greenfield) | Construct winston logger: `level: config.logLevel`, format combine(timestamp, errors({stack: true}), json), `defaultMeta: { service: 'hao-backprop-test' }`; ensure `logs/` directory exists via `fs.mkdirSync(logDir, { recursive: true })`; always include Console transport; conditionally add File transports when `NODE_ENV === 'production'` |
| `.env` | CREATE | None (greenfield) | Local development environment: `HOST=127.0.0.1`, `PORT=3000`, `NODE_ENV=development`, `LOG_LEVEL=debug`, `LOG_DIR=./logs` |
| `.env.example` | CREATE | `.env` (REFERENCE for schema) | Non-secret template documenting required environment variables; safe to commit to VCS |
| `ecosystem.config.js` | CREATE | None (greenfield) | PM2 manifest with `apps: [{ name: 'hao-backprop-test', script: './server.js', cwd: __dirname, instances: 'max', exec_mode: 'cluster', autorestart: true, watch: false, max_memory_restart: '512M', max_restarts: 10, min_uptime: '5s', kill_timeout: 5000, wait_ready: true, listen_timeout: 10000, error_file: './logs/pm2-error.log', out_file: './logs/pm2-out.log', log_date_format: 'YYYY-MM-DD HH:mm:ss Z', merge_logs: true, env: { NODE_ENV: 'development', PORT: 3000, HOST: '127.0.0.1', LOG_LEVEL: 'debug' }, env_production: { NODE_ENV: 'production', PORT: 3000, HOST: '127.0.0.1', LOG_LEVEL: 'info' } }]` |
| `.gitignore` | CREATE | None (greenfield) | Exclude `node_modules/`, `.env`, `.env.local`, `logs/`, `*.log`, `npm-debug.log*`, `yarn-debug.log*`, `yarn-error.log*`, `.pm2/`, `.DS_Store`, `Thumbs.db` |
| `logs/.gitkeep` | CREATE | None (greenfield) | Empty placeholder file ensuring `logs/` directory is tracked in VCS while log file contents are gitignored |
| `README.md` | UPDATE | `README.md` (current 25 lines) | Rewrite for Node.js / Express / PM2: replace Python prerequisite with `Node.js 18+`, replace `pip install` with `npm install`, replace `python app.py` with `node server.js` (dev) and `pm2 start ecosystem.config.js --env production` (prod), document environment variables, document PM2 lifecycle commands (`pm2 reload`, `pm2 logs`, `pm2 stop`), retain endpoint URL `http://127.0.0.1:3000/` and the behavioral contract description |
| `app.py` | DELETE | `app.py` (58 lines) | Remove Python Flask application; superseded entirely by `server.js` and `routes/index.js` |
| `requirements.txt` | DELETE | `requirements.txt` (1 line: `Flask==3.1.3`) | Remove pip dependency manifest; Node.js stack is now declared in `package.json` |
| `blitzy/documentation/Project Guide.md` | PRESERVE | — | Historical migration documentation; left untouched as institutional record |
| `blitzy/documentation/Technical Specifications.md` | PRESERVE | — | Prior technical specification (Python Flask migration); left untouched. This new Technical Specifications document supersedes it functionally; the prior document remains as historical reference |

### 0.6.2 New Files Detail

## `package.json`

- **Content type**: Configuration (npm manifest)
- **Based on**: Standard `npm init` template, customized with the exact dependency versions confirmed in §0.4
- **Key sections**:
    - `name`, `version`, `description`, `main`, `license`
    - `engines.node: '>=18.0.0'` (Express 5 minimum, per <cite index="3-14">Node.js 18 or higher is required</cite>)
    - `scripts.start: 'node server.js'` — direct execution for development
    - `scripts.dev: 'nodemon server.js'` — auto-reloading development
    - `scripts['pm2:start']: 'pm2 start ecosystem.config.js --env production'` — production launch
    - `scripts['pm2:reload']: 'pm2 reload ecosystem.config.js --env production'` — zero-downtime reload
    - `scripts['pm2:stop']: 'pm2 stop ecosystem.config.js'` — graceful stop
    - `scripts['pm2:logs']: 'pm2 logs hao-backprop-test'` — log streaming
    - `dependencies`: express, dotenv, winston, morgan, helmet, compression
    - `devDependencies`: nodemon

## `server.js`

- **Content type**: Source code (CommonJS module)
- **Based on**: Behavioral contract from `app.py`:L18-L58; structural pattern from Express 5 + PM2 best practices
- **Key responsibilities**:
    - Load environment via `require('dotenv').config()` as the first statement
    - Import config, logger, middleware, routes
    - Construct Express app
    - Disable `x-powered-by` header for security hygiene
    - Register middleware in canonical order
    - Mount router at `/`
    - Bind HTTP listener; in the `listen` callback, log startup line equivalent to `app.py`:L55 and call `process.send && process.send('ready')`
    - Install `SIGINT`/`SIGTERM` handlers that close the server and exit cleanly

## `routes/index.js`

- **Content type**: Source code
- **Based on**: `app.py`:L26-L49 — preserves exact response semantics
- **Key sections**: A single `router.all(...)` handler that calls `res.status(200).set('Content-Type', 'text/plain').send('Hello, World!\n')`. Module exports the router via `module.exports = router;`

## `middleware/requestLogger.js`

- **Content type**: Source code
- **Based on**: <cite index="27-16">Morgan stream pattern: app.use(morgan('combined', { stream: morganStream, skip: skipHealthChecks }))</cite>
- **Key sections**: Import morgan and the winston logger; export `morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } })`

## `middleware/errorHandler.js`

- **Content type**: Source code
- **Based on**: <cite index="26-1">Express error handler pattern: app.use((err, req, res, next) => { logger.error('Unhandled error', { error: { message: err.message, stack: err.stack }, request: { method: req.method, url: req.url, body: req.body } }); res.status(500).json({ error: 'Internal server error' }); })</cite>
- **Key sections**: Four-argument signature; structured error logging with request context; JSON error response; production builds must not leak stack traces in the response body

## `middleware/notFoundHandler.js`

- **Content type**: Source code
- **Based on**: Express defensive 404 pattern
- **Key sections**: Three-argument middleware that logs `req.method req.originalUrl` at `warn` level and returns HTTP 404 JSON `{ error: 'Not Found' }`

## `config/index.js`

- **Content type**: Source code
- **Based on**: `app.py`:L22-L23 (default values for HOST/PORT)
- **Key sections**: Object literal with `host`, `port`, `nodeEnv`, `logLevel`, `logDir`; minimal validation that `port` is a finite positive integer

## `config/logger.js`

- **Content type**: Source code
- **Based on**: <cite index="27-1">winston.createLogger({ level: process.env.LOG_LEVEL || 'info', format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()), defaultMeta: { service: 'express-api' }, transports: [ new winston.transports.Console() ] })</cite>
- **Key sections**: Ensure `logDir` exists via `fs.mkdirSync(logDir, { recursive: true })`; create logger with JSON format and timestamps; Console transport always; File transports for `combined.log` and `error.log` only when `NODE_ENV === 'production'`

## `.env`

- **Content type**: Configuration (key=value, no quotes per <cite index="44-12">.env uses correct syntax (no quotes, no spaces around =)</cite>)
- **Based on**: New schema derived from `config/index.js`
- **Contents** (literal):

```
HOST=127.0.0.1
PORT=3000
NODE_ENV=development
LOG_LEVEL=debug
LOG_DIR=./logs
```

### `.env.example`

- **Content type**: Configuration template
- **Based on**: `.env` schema
- **Contents** (literal): Same keys as `.env`, safe to commit, may include explanatory comments

### `ecosystem.config.js`

- **Content type**: Configuration (CommonJS module exporting an object)
- **Based on**: <cite index="20-1">PM2 ecosystem reference configuration with instances: 'max', exec_mode: 'cluster', max_memory_restart, env, env_production, log paths, kill_timeout, wait_ready, listen_timeout</cite>
- **Key sections**: Single `apps[0]` entry; `cwd: __dirname` to fix the PM2/dotenv CWD problem; `env` block for development defaults; `env_production` overriding `NODE_ENV` and `LOG_LEVEL`; PM2-managed log paths under `./logs/`

## `.gitignore`

- **Content type**: Configuration
- **Based on**: Standard Node.js + PM2 ignore template
- **Contents**: `node_modules/`, `.env`, `.env.local`, `logs/`, `*.log`, `npm-debug.log*`, `yarn-debug.log*`, `yarn-error.log*`, `.pm2/`, OS files

## `logs/.gitkeep`

- **Content type**: Empty placeholder
- **Purpose**: Ensures `logs/` directory exists in fresh clones so winston file transports can write without manual `mkdir` (though `config/logger.js` also defensively creates the directory)

### 0.6.3 Files to Modify Detail

## `README.md`

- **Sections to update**: Entire file rewrite
- **New content to add**:
    - Prerequisite: `Node.js 18+` and `npm 10+` (replaces `Python 3.12+`)
    - Setup section with `npm install` (replaces `pip install -r requirements.txt`)
    - Run section with two flows: `npm run dev` (development with nodemon) and `npm run pm2:start` (production with PM2)
    - Environment variables section documenting `HOST`, `PORT`, `NODE_ENV`, `LOG_LEVEL`, `LOG_DIR`
    - PM2 lifecycle reference: `pm2 logs`, `pm2 status`, `pm2 reload`, `pm2 stop`
    - Endpoint reference: `http://127.0.0.1:3000/` returns `Hello, World!` (unchanged)
- **Content to remove**:
    - "Do not touch!" notice [`README.md`:L3] — superseded by user enhancement directive
    - Python prerequisite line [`README.md`:L11]
    - `pip install -r requirements.txt` block
    - `python app.py` block
- **Refactoring needed**: Reorganize structure into: Title → Description → Prerequisites → Setup → Run (Development) → Run (Production with PM2) → Environment Variables → Endpoint

### 0.6.4 Configuration and Documentation Updates

#### Configuration Changes

- **`package.json` (CREATE)** — Establishes the npm package; downstream effect: all subsequent commands (`npm install`, `npm run start`, `npm run pm2:start`) become operational.
- **`ecosystem.config.js` (CREATE)** — Activates PM2 management; downstream effect: cluster-mode launches with `pm2 start ecosystem.config.js --env production`; PM2 reads cwd, env, log paths from this single file.
- **`.env` / `.env.example` (CREATE)** — Externalizes runtime parameters; downstream effect: `HOST`, `PORT`, `NODE_ENV`, `LOG_LEVEL`, `LOG_DIR` are now operator-tunable without code changes.
- **`.gitignore` (CREATE)** — Activates VCS hygiene; downstream effect: secrets in `.env`, generated `node_modules/`, and runtime `logs/` no longer pollute commits.

#### Documentation Updates

- **`README.md` (UPDATE)** — Re-aligns onboarding documentation with the new stack.
- **Cross-references**: All historical references to Flask, Python, `pip`, `app.py`, `requirements.txt`, and `python app.py` are removed from `README.md` (these references remain in `blitzy/documentation/*` as historical record and are intentionally not modified).

### 0.6.5 Cross-File Dependencies

| Source Module | Imports / Depends On | Update Required |
|---|---|---|
| `server.js` | `dotenv`, `express`, `helmet`, `compression`, `./config`, `./config/logger`, `./middleware/requestLogger`, `./middleware/notFoundHandler`, `./middleware/errorHandler`, `./routes` | All new — created together |
| `routes/index.js` | `express`, `../config/logger` (optional, for route-level logging) | All new |
| `middleware/requestLogger.js` | `morgan`, `../config/logger` | All new |
| `middleware/errorHandler.js` | `../config/logger` | All new |
| `middleware/notFoundHandler.js` | `../config/logger` | All new |
| `config/logger.js` | `winston`, `fs`, `path`, `./index` (for `logDir`) | All new |
| `config/index.js` | (process.env only) | All new |
| `ecosystem.config.js` | (none — read by PM2 directly) | All new; references `./server.js` script path |
| `package.json` | (declares npm dependency graph) | All new |
| `README.md` | (references `package.json` scripts, `.env.example` schema, `ecosystem.config.js` env names) | UPDATED — must stay consistent with `package.json` scripts |

#### Import / Reference Consistency Requirements

- The `script` field in `ecosystem.config.js` must point to `./server.js` exactly as the file is created.
- The `cwd` field in `ecosystem.config.js` must be `__dirname` (resolved to the project root) to ensure dotenv finds `.env`.
- The `LOG_DIR` value in `.env` and the `error_file`/`out_file` paths in `ecosystem.config.js` must agree (both default to `./logs/`).
- The `PORT` value in `.env`, `env_production` (in `ecosystem.config.js`), and the README must agree (3000).
- `config/index.js` defaults must match `app.py`:L22-L23 (`127.0.0.1`, `3000`) to preserve behavior when `.env` is absent.

## 0.7 Rules

This subsection captures every rule the user specified for the project. The user supplied a single rule entry titled `QA-20-may-custom-rules`, reproduced verbatim below, followed by the derived implementation constraints.

### 0.7.1 User-Specified Rules (Verbatim)

The user provided the following implementation rule under the name `QA-20-may-custom-rules`:

> "Enhance this basic HTTP server with Express.js framework, add routing, middleware, environment config, logging, and prepare for production deployment with PM2."

This rule is identical to the user's high-level enhancement directive and is treated as the binding authority for scope decisions.

### 0.7.2 Derived Implementation Rules

The following rules are derived from the user's directive and the project's existing context. They are binding for the implementation phase:

- **R-001 — Preserve byte-exact HTTP response contract**. Every HTTP request, regardless of method or path, must receive a response with status `200`, header `Content-Type: text/plain`, and body `Hello, World!\n` (14 bytes, terminating in `0x0A`). This contract derives from `app.py`:L49 and the Backprop integration test fixture's reliance on byte-exact response equality.
- **R-002 — Use Express 5.x specifically**. The latest stable major (5.2.1) must be selected. <cite index="5-21">Organizations starting new Node.js backend projects today should use the latest Express 5.2</cite>. Express 4.x is not acceptable for a new project initiated in 2026.
- **R-003 — Externalize all runtime parameters via `.env`**. Hardcoded host/port constants of the form `HOSTNAME = '127.0.0.1'` and `PORT = 3000` from `app.py`:L22-L23 must not appear in the new code. `config/index.js` is the sole place that reads `process.env` and provides defaults.
- **R-004 — Use winston for application logs and morgan for HTTP access logs**. The two-logger pattern is the established Express convention; morgan output must stream through winston so logs share a single format and destination.
- **R-005 — PM2 cluster mode in production**. The `env_production` block must select `exec_mode: 'cluster'` and `instances: 'max'` to leverage all CPU cores. Development can use fork mode for simpler debugging.
- **R-006 — Set `NODE_ENV=production` in the production environment**. <cite index="35-5,35-6">Enables performance optimizations, helps logging decisions, affects caching, enables secure cookies</cite>.
- **R-007 — Do not commit `.env`**. The `.gitignore` must exclude `.env`. The `.env.example` is the only environment file that may be committed.
- **R-008 — Create the `logs/` directory at startup**. <cite index="23-14,23-15">Winston's file transport does not create directories automatically; You need to create the logs/ directory before starting the application</cite>. `config/logger.js` must call `fs.mkdirSync(logDir, { recursive: true })` before instantiating file transports.
- **R-009 — Set `cwd: __dirname` in `ecosystem.config.js`**. <cite index="44-22,44-23,44-24">dotenv relies on loading .env from the current working directory (CWD) when config() is called. PM2, however, may run your app with a different CWD than expected</cite>. Setting `cwd` explicitly is required to prevent dotenv from silently failing.
- **R-010 — Implement graceful shutdown**. `server.js` must register `SIGINT` and `SIGTERM` handlers that call `server.close()` and exit cleanly, and must emit `process.send('ready')` when listening to support PM2's `wait_ready: true` setting.
- **R-011 — Decommission the Python stack**. `app.py` and `requirements.txt` must be deleted as part of this change. Leaving them in place creates a confusing dual-runtime repository.
- **R-012 — Preserve `blitzy/documentation/*`**. The historical documentation under `blitzy/documentation/` must not be modified or deleted; it remains as the institutional record of the prior Python migration.

## 0.8 Special Instructions

This subsection captures execution-specific guidance, methodological constraints, and boundary conditions that shape how the implementation must be carried out.

### 0.8.1 Special Execution Instructions

- **Mixed-language transition** — The repository transitions from a Python-only state to a Node.js-only state. The implementation must complete the transition atomically: do not leave a partially-migrated repository where both `app.py` and `server.js` coexist. The `app.py` and `requirements.txt` deletions happen in the same change as the Node.js scaffolding creation.
- **`npm install` is part of the change set** — Running `npm install` is required to generate `package-lock.json`. The implementation must execute `npm install` after writing `package.json` and before declaring completion, so that the lockfile reflects the resolved dependency graph.
- **PM2 global install is the operator's responsibility** — PM2 is listed in `dependencies` for reproducibility (so `npm install` makes the `pm2` binary available under `node_modules/.bin/`), but operators will typically install it globally via `npm install -g pm2@7` on production hosts. The README must document this.
- **Logs directory creation is dual-defensive** — Both `logs/.gitkeep` (committed) and `config/logger.js`'s `fs.mkdirSync` (runtime) ensure the directory exists. Both are required.
- **No code review or approval gating** — The user has not specified additional review steps. The change is treated as a standard implementation deliverable.
- **No deployment is performed** — This enhancement *prepares* the codebase for PM2 deployment; the actual deployment to a host (e.g., `pm2 deploy production setup`) is not part of this work. The `deploy:` block in `ecosystem.config.js` is intentionally omitted because no SSH targets are known.
- **No automated tests are required** — The user did not request tests, and the existing tech spec excludes test infrastructure. The implementation may verify the response contract manually via `curl -s http://127.0.0.1:3000/ | xxd` to confirm byte-exact equality with `Hello, World!\n`.

### 0.8.2 Constraints and Boundaries

#### Technical Constraints (user-derived and platform-derived)

- **Node.js 18+ minimum** — Express 5.2.1 requires <cite index="3-14">Node.js 18 or higher</cite>; the `engines.node` field in `package.json` must enforce `>=18.0.0`.
- **Loopback-only default binding** — Default `HOST=127.0.0.1` matches the existing behavior at `app.py`:L22. Operators may override via `.env`, but the default must not be `0.0.0.0` because it would change the security posture relative to the current system.
- **Port 3000 default** — Must match `app.py`:L23 and `README.md` end-of-file (`http://127.0.0.1:3000/`).
- **No charset suffix on `Content-Type`** — `app.py`:L49 sets `content_type='text/plain'` with no charset; the Express implementation must do the same (use `res.set('Content-Type', 'text/plain')` rather than `res.type('text/plain')`, because `res.type` may add the default charset).
- **Trailing newline in response body** — The body is `Hello, World!\n` (14 bytes), not `Hello, World!`. Verified against `app.py`:L49.

#### Process Constraints

- **No modification to `blitzy/documentation/*`** — Historical documentation must remain intact as the prior tech spec record.
- **No automated test suite** — Out of scope per §0.3.2 and the user's directive.
- **No CI/CD workflow files** — Out of scope per §0.3.2.
- **No Dockerfile / docker-compose** — Out of scope per §0.3.2; the user specified PM2 as the deployment surface.

#### Output Constraints

- **Plain JavaScript (CommonJS)** — All new source files use CommonJS (`require`/`module.exports`). No ES modules, no TypeScript, no transpilation step. Rationale: simplest possible Node.js project layout, aligned with the project's minimalist philosophy.
- **No exposed stack traces in production** — <cite index="35-16">Never expose stack traces in production</cite>. The error handler must emit only `{ error: 'Internal server error' }` as the response body; stack traces go to logs only.
- **Logs as JSON in production** — `config/logger.js` uses `winston.format.json()` so production logs are machine-parseable. Development may include `winston.format.simple()` for readability if desired, but JSON is the production format.

#### Compatibility Requirements

- **Backward HTTP contract compatibility** — The Backprop integration consumers must continue to receive identical responses (status, headers, body bytes). No content negotiation, no compression on responses to the catch-all (the `compression` middleware may engage, but the response body of `Hello, World!\n` is below the default 1024-byte threshold so compression does not apply in practice — verifiable by the consumer).
- **Port number preservation** — Port 3000 default preserves compatibility with documented test harness expectations.

## 0.9 References

This subsection consolidates the source citations, external references, and the comprehensive search log used to derive this Agent Action Plan.

### 0.9.1 Repository File Citations

Each claim in this Agent Action Plan about the existing system is grounded in one or more of the following file locations. Locators use line-range notation (`Lx-Ly`) where applicable.

| Citation | File | Locator | Claim |
|---|---|---|---|
| [`app.py`:L17] | `app.py` | Line 17 | Flask import: `from flask import Flask, Response` |
| [`app.py`:L18] | `app.py` | Line 18 | Application factory: `app = Flask(__name__)` |
| [`app.py`:L22-L23] | `app.py` | Lines 22-23 | Hardcoded network constants `HOSTNAME = '127.0.0.1'` and `PORT = 3000` |
| [`app.py`:L26-L27] | `app.py` | Lines 26-27 | Dual-decorator catch-all route pattern with all seven HTTP methods enumerated |
| [`app.py`:L26-L49] | `app.py` | Lines 26-49 | Catch-all route handler implementation |
| [`app.py`:L49] | `app.py` | Line 49 | Response construction: `Response('Hello, World!\n', status=200, content_type='text/plain')` |
| [`app.py`:L52-L58] | `app.py` | Lines 52-58 | Entry guard, startup print, `app.run(host=HOSTNAME, port=PORT)` |
| [`app.py`:L55] | `app.py` | Line 55 | Startup `print(f'Server running at http://{HOSTNAME}:{PORT}/')` |
| [`README.md`:L1] | `README.md` | Line 1 | Project title `hao-backprop-test` |
| [`README.md`:L3] | `README.md` | Line 3 | "test project for backprop integration. Do not touch!" notice |
| [`README.md`:L11] | `README.md` | Line 11 | "Python 3.12+" prerequisite |
| [`README.md`:L1-L25] | `README.md` | Lines 1-25 | Entire current README (Python Flask quick-start) |
| [`requirements.txt`:L1] | `requirements.txt` | Line 1 | `Flask==3.1.3` |
| [Tech Spec §1.1] | `blitzy/documentation/Technical Specifications.md` | §1.1 Executive Summary | Project description, Backprop integration purpose, prior Node.js→Python migration |
| [Tech Spec §2.1.1] | `blitzy/documentation/Technical Specifications.md` | §2.1.1 | Feature F-001: HTTP Response Service contract |
| [Tech Spec §2.6] | `blitzy/documentation/Technical Specifications.md` | §2.6 | Assumptions A-001 through A-005 and Constraints C-001 through C-005 |
| [Tech Spec §3.1] | `blitzy/documentation/Technical Specifications.md` | §3.1 Programming Languages | Python 3.12+ as active language; JavaScript (Node.js) as replaced language |
| [Tech Spec §3.2] | `blitzy/documentation/Technical Specifications.md` | §3.2 Frameworks and Libraries | Flask 3.1.3 + 6 transitive deps |
| [Tech Spec §5.1] | `blitzy/documentation/Technical Specifications.md` | §5.1 High-Level Architecture | Single-Module Monolith pattern; four architectural patterns documented |

### 0.9.2 External Reference Sources

| Reference | Topic | Used For |
|---|---|---|
| npmjs.com — `express` package | Express.js version and Node.js minimum | <cite index="3-2,3-14">Latest version: 5.2.1; Node.js 18 or higher is required</cite> |
| HeroDevs blog — Express 4 vs 5 (April 2026) | Express 5 production recommendation | <cite index="5-20,5-21">Express 5.2 shipped December 1, 2025 and is the Technical Committee's endorsed production release; Organizations starting new Node.js backend projects today should use the latest Express 5.2</cite> |
| Trevor Lasn blog — Express 5 release | Express 5 features (async/await, route matching, error handling) | <cite index="7-14">Express 5 modernized the codebase by dropping support for legacy Node.js versions, overhauling route matching for improved security, adding native async/await middleware support, and removing deprecated APIs</cite> |
| npmjs.com — `pm2` package | PM2 version and runtime support | <cite index="38-1,38-13">Latest version: 7.0.1, last published: 16 days ago; Supports Node.js 18+ and Bun 1+</cite> |
| pm2.keymetrics.io — Application Declaration | PM2 ecosystem file shape | <cite index="11-2,11-3,11-4">ecosystem.config.js module.exports shape with env_production blocks; --env <env_name> selection at start time</cite> |
| oneuptime.com — PM2 process management (Jan 2026) | Production cluster configuration | <cite index="20-1">instances: 'max', exec_mode: 'cluster', max_memory_restart, env, env_production, log paths, kill_timeout: 5000, wait_ready: true, listen_timeout: 10000</cite> |
| w3tutorials.net — dotenv + PM2 CWD issue | `cwd: __dirname` requirement | <cite index="44-22,44-23,44-24">dotenv relies on loading .env from the current working directory (CWD) when config() is called. PM2, however, may run your app with a different CWD than expected, or bypass the .env file entirely if misconfigured</cite> |
| npmjs.com — `dotenv` package | Per-environment .env file convention | <cite index="37-1,37-2">Use .env for local/development, .env.production for production and so on. This still follows the twelve factor principles as each is attributed individually to its own environment</cite> |
| oneuptime.com — Express + Morgan + Winston (Feb 2026) | Two-logger pattern | <cite index="27-3,27-4">In Express applications, you typically need two types of logging: HTTP request logs and application logs. Morgan handles the first, Winston handles the second, and together they give you complete visibility into what your application is doing</cite> |
| Grizzly Peak Software — Winston best practices | Winston file-transport directory caveat | <cite index="23-14,23-15">Winston's file transport does not create directories automatically; You need to create the logs/ directory before starting the application</cite> |
| Krishnakumar — Node.js 2026 deployment guide | Production NODE_ENV semantics | <cite index="35-3,35-5,35-6">npm install express dotenv cors helmet morgan; if (process.env.NODE_ENV === "production") { app.set("trust proxy", 1); } Set in production: NODE_ENV=production; Enables performance optimizations, helps logging decisions, affects caching, enables secure cookies</cite> |
| Medium — Helmet.js security (Oct 2025) | helmet middleware purpose | <cite index="33-5">Helmet.js is a Node.js middleware collection for Express apps that automatically sets secure HTTP headers</cite> |
| oneuptime.com — Winston logging (Jan 2026) | Winston logger configuration | <cite index="27-1">winston.createLogger config: level: process.env.LOG_LEVEL || 'info', format: timestamp + errors({stack: true}) + json, defaultMeta: { service }, transports: [Console]</cite> |

### 0.9.3 User-Provided Attachments

- **No file attachments** were provided by the user.
- **No Figma frames or URLs** were provided by the user.
- **No setup instruction documents** were provided beyond the rule file `QA-20-may-custom-rules`, whose full content is reproduced verbatim in §0.7.1.

### 0.9.4 Setup Instructions

The user-supplied environment configuration is `None provided`. The implementation derives its setup procedure directly from the project's discovered state and the user's enhancement rule:

- **Runtime**: Node.js 18+ (verified `v22.22.2` available in the working environment)
- **Package manager**: npm (verified `11.1.0` available in the working environment)
- **Process manager**: PM2 7.0.1 (installable via `npm install -g pm2@7` on production hosts)

### 0.9.5 Search Log Appendix

The following enumeration documents every file and folder examined during the discovery phase. This appendix supports downstream auditability of the Agent Action Plan's grounding.

| Step | Tool | Target | Outcome |
|---|---|---|---|
| 1 | `bash` (`find / -name ".blitzyignore"`) | Repository-wide `.blitzyignore` search | No files found |
| 2 | `bash` (`node --version; npm --version`) | Runtime probe | Node v22.22.2, npm 11.1.0 confirmed |
| 3 | `bash` (`find . -type f -not -path './.git/*'`) | Repository contents enumeration | Found: `README.md`, `app.py`, `requirements.txt`, `blitzy/documentation/Project Guide.md`, `blitzy/documentation/Technical Specifications.md` |
| 4 | `read_file` | `README.md` | 25-line Python Flask quick-start with "Do not touch!" notice |
| 5 | `read_file` | `app.py` | 58-line Flask application; HOSTNAME, PORT, catch-all route, app.run |
| 6 | `read_file` | `requirements.txt` | Single line: `Flask==3.1.3` |
| 7 | `get_source_folder_contents` | `blitzy/` | Only `documentation/` subfolder |
| 8 | `get_source_folder_contents` | `blitzy/documentation/` | `Project Guide.md` + `Technical Specifications.md` |
| 9 | `get_tech_spec_section` | §1.1 Executive Summary | Project context, prior migration history |
| 10 | `get_tech_spec_section` | §2.1 Feature Catalog | F-001 through F-005 |
| 11 | `get_tech_spec_section` | §2.6 Assumptions and Constraints | A-001 through A-005, C-001 through C-005 |
| 12 | `get_tech_spec_section` | §3.1 Programming Languages | Python active, Node.js replaced |
| 13 | `get_tech_spec_section` | §3.2 Frameworks and Libraries | Flask 3.1.3 + 6 transitive packages |
| 14 | `get_tech_spec_section` | §5.1 High-Level Architecture | Single-Module Monolith pattern |
| 15 | `web_search` | Express.js latest stable version 2026 | Express 5.2.1 (latest); Node.js 18+ required |
| 16 | `web_search` | PM2 ecosystem.config.js production best practices | Cluster mode, env_production blocks, graceful shutdown, log paths |
| 17 | `web_search` | winston express middleware logging best practices 2026 | Two-logger pattern (winston + morgan); JSON format; logs/ directory creation |
| 18 | `web_search` | dotenv config Express production deployment helmet | Per-env .env files; helmet for security headers; compression for response gzip |
| 19 | `web_search` | PM2 latest version npm 2026 winston version dotenv | PM2 7.0.1; PM2 + dotenv CWD interaction problem |

