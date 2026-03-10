# Technical Specification

# 0. Agent Action Plan

## 0.1 Executive Summary

Based on the bug description, the Blitzy platform understands that the bug is a **set of missing robustness defenses in `server.js`** — specifically the complete absence of error handling, graceful shutdown logic, input validation safeguards, resource cleanup, and defensive HTTP request processing in a minimal Node.js HTTP server.

The user has requested a review of `server.js` for five distinct categories of potential issues:

- **Missing Error Handling**: The server object returned by `http.createServer()` has no `.on('error')` listener registered. When an operational error occurs — such as `EADDRINUSE` when port 3000 is already occupied — the error event propagates as an uncaught exception, causing an immediate unhandled crash with a raw stack trace and non-zero exit code. There are also no `process.on('uncaughtException')` or `process.on('unhandledRejection')` safety-net handlers.

- **Missing Graceful Shutdown**: No `SIGTERM` or `SIGINT` signal handlers exist. When the process receives a termination signal (e.g., `kill` command, Ctrl+C, container orchestrator stop), Node.js default behavior immediately terminates the process without draining in-flight requests, logging the shutdown, or performing any cleanup. No `server.close()` is ever called.

- **Missing Input Validation**: The `req` object is declared in the request handler callback but never read or inspected. While this is an intentional design decision for a static "Hello, World!" server (per ADR-006), there is no defensive guard against unexpected request properties and no `clientError` event handler for malformed HTTP requests from clients.

- **Missing Resource Cleanup**: The server holds no external resources (no database, no file handles, no caches), but the HTTP server object itself is a resource that should be properly closed on shutdown. Currently, the `server` reference is never used after `server.listen()`, and there is no cleanup path.

- **Robust HTTP Request Processing**: The request handler wraps no `try/catch` protection around response operations. While the current synchronous operations (`res.statusCode`, `res.setHeader`, `res.end`) are unlikely to throw, there is no defensive structure to prevent a future regression from crashing the entire process. No request timeout is configured to guard against slow or stalled client connections.

**Reproduction Steps**:
- Start the server: `node server.js`
- Attempt to start a second instance: `node server.js` → unhandled crash with `EADDRINUSE`
- Send `SIGTERM` to the running process: `kill -TERM <pid>` → immediate death with no log, no drain
- Send `SIGINT` (Ctrl+C): → immediate death with no log, no drain

**Error Classification**: Operational deficiency — multiple missing defensive programming patterns in a production-adjacent server artifact.

## 0.2 Root Cause Identification

Based on research, the root causes are **five distinct omissions in `server.js`**, each representing a missing defensive programming pattern. All five root causes are located in a single file: **`server.js`** (14 lines total).

### 0.2.1 Root Cause 1: No Server Error Event Listener

- **Located in**: `server.js`, between lines 10 and 12 (after `http.createServer()` and before `server.listen()`)
- **Triggered by**: Any operational error emitted by the `http.Server` instance, most commonly `EADDRINUSE` when port 3000 is already bound by another process
- **Evidence**: Running `node server.js` twice in sequence produces an unhandled `'error'` event crash:
  ```
  node:events:502
        throw er; // Unhandled 'error' event
  Error: listen EADDRINUSE: address already in use 127.0.0.1:3000
  ```
- **This conclusion is definitive because**: Node.js `EventEmitter` documentation states that if an `'error'` event is emitted and no listener is registered, the error is thrown as an uncaught exception. The `http.Server` class extends `net.Server` which extends `EventEmitter`, and `server.listen()` emits `'error'` on bind failure. The current code has zero `.on('error', ...)` calls.

### 0.2.2 Root Cause 2: No Graceful Shutdown Signal Handlers

- **Located in**: `server.js` — entirely absent; no `process.on('SIGTERM')` or `process.on('SIGINT')` anywhere in the file
- **Triggered by**: Any process termination signal (`SIGTERM` from `kill`, `SIGINT` from Ctrl+C, container stop commands)
- **Evidence**: Sending `kill -TERM <pid>` to the running server causes immediate process death with no console output, no `server.close()` invocation, and no draining of in-flight requests
- **This conclusion is definitive because**: Without registered signal handlers, Node.js uses its default behavior: `SIGTERM` and `SIGINT` cause immediate process termination. The `server.close()` method, which stops accepting new connections and waits for existing connections to finish, is never called.

### 0.2.3 Root Cause 3: No Client Error Handler

- **Located in**: `server.js`, line 6 (the `http.createServer()` call) — no `server.on('clientError')` handler exists
- **Triggered by**: Malformed HTTP requests from clients (e.g., invalid HTTP protocol, oversized headers, connection reset during request parsing)
- **Evidence**: Grep of `server.js` confirms zero occurrences of `clientError`. Without a `clientError` handler, Node.js default behavior is to destroy the socket silently, which provides no diagnostic logging and no proper HTTP error response (such as `400 Bad Request`) to the client.
- **This conclusion is definitive because**: The Node.js `http.Server` documentation specifies that `clientError` events are emitted when a client connection emits an `'error'` event, and the default behavior when no handler is attached is to immediately destroy the socket.

### 0.2.4 Root Cause 4: No Process-Level Exception Safety Nets

- **Located in**: `server.js` — entirely absent; no `process.on('uncaughtException')` or `process.on('unhandledRejection')` anywhere
- **Triggered by**: Any uncaught exception or unhandled promise rejection that escapes all other handlers
- **Evidence**: The only process-level code in `server.js` is `http.createServer()` and `server.listen()`. No safety-net handlers exist. In Node.js v20.x (the project's runtime), unhandled rejections crash the process by default.
- **This conclusion is definitive because**: The Node.js v20 documentation confirms that `uncaughtException` events, if unhandled, cause the process to print a stack trace to stderr and exit with code 1. These safety-net handlers serve as a last-resort cleanup mechanism before crash.

### 0.2.5 Root Cause 5: No Request Handler Error Protection

- **Located in**: `server.js`, lines 6–9 (the request handler callback)
- **Triggered by**: Any future modification to the request handler that introduces a throwing operation, or any edge case in `res.setHeader()` / `res.end()` with unexpected arguments
- **Evidence**: The request handler performs three synchronous operations with no `try/catch` wrapper: `res.statusCode = 200`, `res.setHeader('Content-Type', 'text/plain')`, and `res.end('Hello, World!\n')`. While these specific operations are currently safe, there is zero defensive structure.
- **This conclusion is definitive because**: Any thrown exception inside the `createServer` callback that is not caught within the callback itself will propagate to the event loop as an uncaught exception, crashing the process. A `try/catch` wrapper is standard defensive practice for request handlers.

## 0.3 Diagnostic Execution

### 0.3.1 Code Examination Results

- **File analyzed**: `server.js` (relative to repository root)
- **Problematic code block**: Lines 1–14 (entire file)
- **Specific failure points**:
  - **Line 6**: `http.createServer((req, res) => {` — Request handler has no `try/catch` wrapper; the `req` parameter is declared but never read
  - **Lines 6–9**: The callback body performs unprotected synchronous I/O operations on the response object
  - **Line 12**: `server.listen(port, hostname, () => {` — No `.on('error')` listener is chained before or after the `listen()` call
  - **Absent after line 14**: No signal handlers, no `clientError` handler, no process-level exception handlers

- **Execution flow leading to bugs**:
  - Normal flow: `require('http')` → `createServer()` → `listen()` → callback logs startup → event loop waits for requests → requests arrive → handler sends 200 "Hello, World!" → done
  - **EADDRINUSE crash flow**: `listen()` → port already bound → `net.Server` emits `'error'` event → no `.on('error')` listener → `EventEmitter` throws → uncaught exception → crash with stack trace → non-zero exit
  - **SIGTERM termination flow**: OS sends `SIGTERM` → no `process.on('SIGTERM')` handler → Node.js default handler → immediate process termination → in-flight requests abandoned → no log → no cleanup
  - **Client error flow**: Malformed request arrives → `http.Server` emits `'clientError'` → no handler → socket destroyed silently → no error response to client → no logging

### 0.3.2 Repository Analysis Findings

| Tool Used | Command Executed | Finding | File:Line |
|-----------|-----------------|---------|-----------|
| bash (cat) | `cat server.js` | Complete 14-line server with zero error handling, zero signal handlers, zero input validation | `server.js:1-14` |
| bash (cat) | `cat package.json` | Zero dependencies; `main` field points to `index.js` (inconsistent with actual entrypoint `server.js`) | `package.json:5` |
| bash (cat) | `cat package-lock.json` | lockfileVersion 3 with empty dependency graph confirming zero external packages | `package-lock.json:1-7` |
| bash (cat) | `cat README.md` | "test project for backprop integration. Do not touch!" — controlled test artifact | `README.md:1-3` |
| bash (grep) | `grep -c 'on(' server.js` | Zero `.on()` event listeners in entire file | `server.js` |
| bash (grep) | `grep -c 'SIGTERM\|SIGINT\|error\|close' server.js` | Zero matches for any error/signal/shutdown keywords | `server.js` |
| bash (grep) | `grep -c 'try\|catch' server.js` | Zero `try/catch` blocks in entire file | `server.js` |
| bash (node) | `node server.js & node server.js` | Second instance crashes with `EADDRINUSE` — unhandled error event on Server instance at `node:net:1944` | `server.js:12` |
| bash (kill) | `kill -TERM <pid>` | Process dies immediately with no output — no graceful shutdown | `server.js` |
| bash (kill) | `kill -INT <pid>` | Process dies immediately with no output — no SIGINT handling | `server.js` |
| bash (git log) | `git log --oneline --all` | Single commit `d9eb3e1 Add files via upload` — no history of error handling ever existing | `.git` |

### 0.3.3 Web Search Findings

- **Search queries executed**:
  - `"Node.js http.createServer error handling best practices"`
  - `"Node.js graceful shutdown SIGTERM SIGINT server.close"`
  - `"Node.js server.on clientError uncaughtException process handler"`

- **Web sources referenced**:
  - Node.js v25.8.0 official documentation (`nodejs.org/api/process.html`) — Confirms `uncaughtException` is a last-resort mechanism and `SIGTERM`/`SIGINT` require explicit handlers
  - DigitalOcean tutorial on Node.js HTTP module — Demonstrates `server.on('error')` pattern for startup error handling
  - UsefulAngle.com Node.js server guide — Documents both `server.on('error')` and `server.on('clientError')` as the two required error event handlers
  - DEV Community graceful shutdown guide — Demonstrates the `server.close()` + `process.exit(0)` pattern with forced timeout fallback
  - Lagoon Documentation — Confirms Node.js does not handle shutdown gracefully out of the box and `server.close()` is required to drain in-flight requests
  - Honeybadger comprehensive guide — Documents the `process.on('uncaughtException')` → `server.close()` → `process.exit(1)` pattern as the correct cleanup approach
  - Toptal Node.js error handling — Recommends subscribing to both `process.on('unhandledRejection')` and `process.on('uncaughtException')` as essential safety nets

- **Key findings incorporated**:
  - `server.on('error')` must be registered before `server.listen()` to catch bind-time errors
  - `server.on('clientError')` should respond with `HTTP/1.1 400 Bad Request` and destroy the socket
  - Graceful shutdown requires `server.close()` which stops accepting new connections and waits for existing ones to finish
  - A forced-exit timeout (typically 5–10 seconds) is recommended as a fallback if `server.close()` does not complete
  - `process.on('uncaughtException')` should perform synchronous cleanup and then exit — never attempt to resume normal execution
  - In Node.js v15+ (including v20.x), unhandled rejections crash the process by default

### 0.3.4 Fix Verification Analysis

- **Steps followed to reproduce bug**:
  - Started server: `node server.js` — Confirmed successful startup with log output
  - Started second instance: `node server.js` — Confirmed crash with `EADDRINUSE` unhandled error
  - Sent `SIGTERM`: `kill -TERM <pid>` — Confirmed immediate death with no log
  - Sent `SIGINT`: `kill -INT <pid>` — Confirmed immediate death with no log
  - Sent normal HTTP request: `curl http://127.0.0.1:3000/` — Confirmed "Hello, World!" response (baseline functionality works)
  - Sent POST to non-existent path: `curl -X POST http://127.0.0.1:3000/nonexistent` — Confirmed same "Hello, World!" response (no routing, no validation)

- **Confirmation tests to ensure bug was fixed** (planned post-fix):
  - Start server → start second instance → verify error is caught and logged gracefully instead of crashing
  - Start server → `kill -TERM <pid>` → verify "Shutting down gracefully..." log appears and process exits with code 0
  - Start server → `kill -INT <pid>` → verify graceful shutdown log and clean exit
  - Start server → `curl http://127.0.0.1:3000/` → verify "Hello, World!" still works (no regression)
  - Start server → verify `process.on('uncaughtException')` logs errors instead of silent crash

- **Boundary conditions and edge cases covered**:
  - Multiple rapid `SIGTERM` signals in sequence
  - Forced exit timeout when `server.close()` takes too long
  - `EADDRINUSE` with descriptive error message instead of raw stack trace
  - `clientError` events returning proper HTTP 400 responses

- **Verification confidence level**: **85%** — High confidence because all five root causes are reproducible and have well-documented Node.js solutions. The 15% uncertainty accounts for the fact that full verification requires running the fixed code, which has not yet been done.

## 0.4 Bug Fix Specification

### 0.4.1 The Definitive Fix

All changes are confined to a single file: **`server.js`**

The fix adds five defensive patterns to the existing 14-line server while preserving the original functionality, zero-dependency constraint (C-003), hardcoded configuration (C-004), and static response behavior (F-002):

- **File to modify**: `server.js`
- **Current implementation at lines 1–14**: Bare `http.createServer()` + `server.listen()` with no error handling, no shutdown handlers, no safety nets
- **Required changes**: Add `server.on('error')`, `server.on('clientError')`, `process.on('SIGTERM')`, `process.on('SIGINT')`, `process.on('uncaughtException')`, `process.on('unhandledRejection')`, and wrap the request handler in a `try/catch` block

**This fixes the root causes by**:
- **Root Cause 1** (No server error listener): `server.on('error')` catches `EADDRINUSE` and other bind errors, logs them with `console.error()`, and exits cleanly with code 1
- **Root Cause 2** (No graceful shutdown): `process.on('SIGTERM')` and `process.on('SIGINT')` call `server.close()` to drain in-flight requests, log the shutdown, and exit with code 0. A forced-exit timeout (5 seconds) prevents the process from hanging if connections cannot be drained.
- **Root Cause 3** (No client error handler): `server.on('clientError')` sends an `HTTP/1.1 400 Bad Request` response to the client socket and destroys it, providing proper feedback instead of silent socket destruction
- **Root Cause 4** (No process-level exception handlers): `process.on('uncaughtException')` and `process.on('unhandledRejection')` log the error and trigger a graceful shutdown sequence, serving as last-resort safety nets
- **Root Cause 5** (No request handler protection): The request handler callback is wrapped in a `try/catch` that catches any thrown error, logs it, and sends a `500 Internal Server Error` response instead of crashing the process

### 0.4.2 Change Instructions

**MODIFY `server.js`** — Replace the entire file content (lines 1–14) with the following enhanced version:

- **DELETE** lines 1–14 containing the current unprotected server implementation
- **INSERT** the complete replacement starting at line 1:

```javascript
const http = require('http');

const hostname = '127.0.0.1';
const port = 3000;

// Flag to track shutdown state
let isShuttingDown = false;

const server = http.createServer((req, res) => {
  // Reject new requests during shutdown
  if (isShuttingDown) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Service Unavailable\n');
    return;
  }
  try {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Hello, World!\n');
  } catch (err) {
    // Catch unexpected errors in request handling
    console.error('Request handler error:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Internal Server Error\n');
  }
});

// Handle server-level errors (e.g., EADDRINUSE)
server.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exit(1);
});

// Handle malformed client requests
server.on('clientError', (err, socket) => {
  console.error('Client error:', err.message);
  if (!socket.destroyed) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  }
});

// Graceful shutdown function
function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
  // Force exit if graceful close takes too long
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 5000).unref();
}

// Register shutdown signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Process-level safety nets
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  gracefulShutdown('unhandledRejection');
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});
```

**Key design decisions and comments**:
- The `isShuttingDown` flag prevents new requests from being processed during shutdown, returning `503 Service Unavailable` instead — this prevents in-flight request accumulation during drain
- The `try/catch` in the request handler catches any unexpected error and returns a `500` response instead of crashing the process — this is a defensive guard for future code changes
- `server.on('error')` catches startup errors like `EADDRINUSE` and exits with code 1 (failure) instead of an unhandled crash — this provides clean error reporting
- `server.on('clientError')` checks `socket.destroyed` before writing to avoid writing to an already-closed socket — this prevents a secondary error
- The `gracefulShutdown()` function is idempotent (guarded by `isShuttingDown`) to handle multiple rapid signals safely
- The forced-exit `setTimeout` uses `.unref()` so it does not keep the event loop alive if `server.close()` completes first — this prevents the process from hanging
- The `console.log` for startup message is preserved exactly as `Server running at http://${hostname}:${port}/` to maintain compatibility with requirement F-004
- Zero external dependencies are added — all changes use only Node.js built-in modules, preserving constraint C-003

### 0.4.3 Fix Validation

- **Test command to verify EADDRINUSE handling**:
  ```
  node server.js & sleep 1; node server.js 2>&1; kill %1
  ```
  Expected: Second instance logs `Server error: listen EADDRINUSE: address already in use 127.0.0.1:3000` and exits with code 1 (no raw stack trace)

- **Test command to verify graceful SIGTERM shutdown**:
  ```
  node server.js & sleep 1; kill -TERM $!; sleep 2
  ```
  Expected: Server logs `SIGTERM received. Shutting down gracefully...` followed by `Server closed.` and exits with code 0

- **Test command to verify graceful SIGINT shutdown**:
  ```
  node server.js & sleep 1; kill -INT $!; sleep 2
  ```
  Expected: Server logs `SIGINT received. Shutting down gracefully...` followed by `Server closed.` and exits with code 0

- **Test command to verify normal operation**:
  ```
  node server.js & sleep 1; curl http://127.0.0.1:3000/; kill %1
  ```
  Expected: Response body is `Hello, World!` with status 200 (no regression)

- **Confirmation method**: Run all four test commands sequentially and verify each produces the expected output. Compare startup log format to original to confirm F-004 compliance.

## 0.5 Scope Boundaries

### 0.5.1 Changes Required (Exhaustive List)

| Action | File | Lines | Specific Change |
|--------|------|-------|-----------------|
| MODIFIED | `server.js` | 1–14 (all) | Replace entire file content with enhanced version adding: `server.on('error')`, `server.on('clientError')`, `process.on('SIGTERM')`, `process.on('SIGINT')`, `process.on('uncaughtException')`, `process.on('unhandledRejection')`, `try/catch` in request handler, `isShuttingDown` flag, `gracefulShutdown()` function, and 503 response during shutdown |

**No other files require modification.** The fix is entirely contained within `server.js`. The `package.json`, `package-lock.json`, and `README.md` files remain unchanged. No new files are created. No files are deleted.

**File inventory**:

| File Path | Action | Rationale |
|-----------|--------|-----------|
| `server.js` | MODIFIED | Sole runtime artifact; all five root causes reside here |
| `package.json` | UNCHANGED | No new dependencies needed; zero-dependency constraint (C-003) preserved |
| `package-lock.json` | UNCHANGED | No dependency changes |
| `README.md` | UNCHANGED | Documentation is out of scope for this bug fix |

### 0.5.2 Explicitly Excluded

- **Do not modify**: `package.json` — No new dependencies should be added. The fix uses only Node.js built-in modules (`http`, `process`), preserving the zero-dependency constraint (C-003)
- **Do not modify**: `package-lock.json` — No dependency graph changes
- **Do not modify**: `README.md` — Documentation updates are outside the scope of this bug fix
- **Do not refactor**: The static response body `'Hello, World!\n'` — This hardcoded string is an intentional design decision (F-002) and must remain identical
- **Do not refactor**: The hardcoded `hostname` (`127.0.0.1`) and `port` (`3000`) constants — These are intentional (C-004, F-003) and must remain as `const` declarations with no override mechanism
- **Do not add**: Request routing, URL parsing, or method-based dispatch — The server intentionally returns the same response for all methods and paths (F-002, ADR-006)
- **Do not add**: External logging frameworks (e.g., winston, morgan) — All logging uses `console.log` and `console.error` per the existing convention
- **Do not add**: TLS/HTTPS support — Explicitly excluded per ADR-005
- **Do not add**: Configuration file loading, environment variable reading, or CLI argument parsing — Excluded per C-004
- **Do not add**: Unit test files — Test creation is outside the scope of this bug fix
- **Do not add**: `package.json` `scripts` entries — No npm script modifications

## 0.6 Verification Protocol

### 0.6.1 Bug Elimination Confirmation

- **Execute**: Start server and attempt duplicate bind:
  ```
  node server.js & sleep 1; node server.js 2>&1
  ```
  **Verify output matches**: `Server error: listen EADDRINUSE: address already in use 127.0.0.1:3000` — clean log line with no raw stack trace, process exits with code 1

- **Execute**: Start server and send SIGTERM:
  ```
  node server.js & sleep 1; kill -TERM $!; wait $!
  ```
  **Verify output matches**: `SIGTERM received. Shutting down gracefully...` followed by `Server closed.` — process exits with code 0

- **Execute**: Start server and send SIGINT:
  ```
  node server.js & sleep 1; kill -INT $!; wait $!
  ```
  **Verify output matches**: `SIGINT received. Shutting down gracefully...` followed by `Server closed.` — process exits with code 0

- **Confirm error no longer appears in**: stdout/stderr — No `node:events:502 throw er; // Unhandled 'error' event` stack traces should appear for any of the tested scenarios

- **Validate functionality with**: Standard HTTP request after fix:
  ```
  node server.js & sleep 1; curl -s http://127.0.0.1:3000/; kill %1
  ```
  **Verify**: Response is exactly `Hello, World!` with HTTP status 200 and `Content-Type: text/plain`

### 0.6.2 Regression Check

- **Run existing test suite**: No formal test suite exists for this project. Verification relies on manual curl commands as documented above.

- **Verify unchanged behavior in**:
  - Static response content: Must be exactly `Hello, World!\n` for all HTTP methods and all URL paths
  - Startup log message: Must be exactly `Server running at http://127.0.0.1:3000/` (format unchanged from original per F-004)
  - Listening address: Must remain `127.0.0.1:3000` (unchanged per F-003)
  - HTTP status code: Must remain `200` for all normal requests
  - Content-Type header: Must remain `text/plain`
  - Zero dependencies: `npm ls` must report no installed packages

- **Confirm performance metrics**: For this minimal server, performance validation consists of:
  ```
  node server.js & sleep 1; curl -w "HTTP_CODE:%{http_code} TIME:%{time_total}s\n" -s -o /dev/null http://127.0.0.1:3000/; kill %1
  ```
  **Verify**: HTTP_CODE is `200` and TIME is under `0.1s` (confirming no measurable overhead from added error handling)

## 0.7 Rules

No user-specified rules or coding guidelines were provided for this project. The following rules are derived from the project's existing conventions and constraints:

- **Zero-dependency constraint (C-003)**: All fixes must use only Node.js built-in modules. No external packages may be added to `package.json` or installed via npm.
- **Hardcoded configuration (C-004)**: All server parameters (`hostname`, `port`, response body, status code, content type) must remain as hardcoded `const` declarations. No environment variables, CLI arguments, or configuration files may be introduced.
- **Localhost-only binding (C-002)**: The server must continue to bind exclusively to `127.0.0.1`. No changes to the listening address are permitted.
- **Static response behavior (F-002)**: The response body `Hello, World!\n` must be returned identically for all HTTP methods, paths, and header combinations. The response must not vary based on request content.
- **Startup log format (F-004)**: The startup message must remain exactly `Server running at http://127.0.0.1:3000/` with no format changes.
- **Immutability principle**: The README.md states "Do not touch!" — this bug fix modifies only `server.js` and preserves all original functional behavior while adding defensive patterns.
- **CommonJS module system**: The project uses `require()` syntax (CommonJS). Do not convert to ES modules (`import`/`export`).
- **Minimal change principle**: Make the exact specified changes only. Zero modifications outside the bug fix scope. No refactoring of working code beyond what is required to address the five root causes.
- **Existing logging convention**: The project uses `console.log` for informational messages. Error logging should use `console.error` for consistency with Node.js conventions.
- **Node.js v20.x compatibility**: All code must be compatible with Node.js v20.20.1 (the project's installed runtime). No APIs exclusive to Node.js v21+ may be used.

## 0.8 References

### 0.8.1 Repository Files and Folders Searched

| File Path | Purpose | Key Findings |
|-----------|---------|--------------|
| `server.js` | Primary runtime artifact — sole HTTP server | 14 lines with zero error handling, zero signal handlers, zero input validation, zero resource cleanup |
| `package.json` | Package manifest | Name: `hello_world`, version `1.0.0`, zero dependencies, `main` field: `index.js` |
| `package-lock.json` | Dependency lock file | lockfileVersion 3, empty dependency graph |
| `README.md` | Project documentation | "hao-backprop-test" — test project for backprop integration with "Do not touch!" directive |
| `.git/` | Version control | Single commit `d9eb3e1 Add files via upload` |

### 0.8.2 Technical Specification Sections Referenced

| Section | Key Information Extracted |
|---------|--------------------------|
| 1.1 Executive Summary | Project identity: lightweight Backprop integration test fixture, author `hxu`, controlled stability artifact |
| 2.2 Functional Requirements | Five feature groups (F-001 through F-005) defining HTTP server init, static response, localhost binding, startup logging, and test fixture behavior |
| 3.1 Stack Overview | JavaScript ES6+ (CommonJS), Node.js (unspecified version), npm ≥v9, built-in `http` module only, zero external dependencies |
| 4.5 Error Handling Flowcharts | Critical: No `.on('error')` handler → EADDRINUSE crashes; no shutdown logic → immediate termination; no runtime error handling in request handler |
| 5.2 Component Details | `server.js` implements F-001 through F-004; all six runtime parameters hardcoded as `const`; zero persistent state |
| 6.4 Security Architecture | Security via minimalism; ADR-005 (No TLS), ADR-006 (No input processing), ADR-007 (No error handling); zero attack surface |

### 0.8.3 Web Sources Referenced

| Source | URL | Relevance |
|--------|-----|-----------|
| Node.js Official Documentation (Process) | `https://nodejs.org/api/process.html` | `uncaughtException` and `unhandledRejection` event documentation; confirms default crash behavior and correct usage patterns |
| DigitalOcean — How To Create a Web Server with HTTP Module | `https://www.digitalocean.com/community/tutorials/how-to-create-a-web-server-in-node-js-with-the-http-module` | Production best practices for error recovery and server creation patterns |
| UsefulAngle — Creating a Web Server in Node.js | `https://usefulangle.com/post/178/nodejs-create-server` | Documents both `server.on('error')` and `server.on('clientError')` as required error event handlers with code examples |
| DEV Community — Graceful Shutdown in Node.js | `https://dev.to/superiqbal7/graceful-shutdown-in-nodejs-handling-stranger-danger-29jo` | `server.close()` + forced timeout pattern for graceful shutdown implementation |
| Lagoon Documentation — Node.js Graceful Shutdown | `https://docs.lagoon.sh/using-lagoon-advanced/nodejs/` | Confirms Node.js does not handle shutdown gracefully by default; `server.close()` required |
| Honeybadger — Comprehensive Error Handling in Node.js | `https://www.honeybadger.io/blog/errors-nodejs/` | `uncaughtException` cleanup pattern: log → `server.close()` → `process.exit(1)` with forced timeout |
| Toptal — Node.js Error-handling Best Practices | `https://www.toptal.com/nodejs/node-js-error-handling` | Recommends both `unhandledRejection` and `uncaughtException` handlers as essential safety nets |
| DEV Community — uncaughtException and unhandledRejection | `https://dev.to/silentwatcher_95/the-silent-killers-in-nodejs-uncaughtexception-and-unhandledrejection-1p9b` | Node.js v15+ treats unhandled rejections as fatal; confirms need for process-level handlers |

### 0.8.4 Attachments

No attachments were provided for this project. No Figma screens, design mockups, or external documents were supplied.

