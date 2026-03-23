# hao-backprop-test

A simple Node.js HTTP server built with [Express.js](https://expressjs.com/) v5. This tutorial-style project demonstrates basic routing with two endpoints.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18 (required by Express.js v5)
- npm (included with Node.js)

## Setup

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd hao-backprop-test
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

## Running the Server

Start the server using either of the following methods:

```bash
npm start
```

Or run the server script directly:

```bash
node server.js
```

The server will start on **port 3000** and log the URL to the console:

```
Server running at http://localhost:3000/
```

## Available Endpoints

| Method | Path       | Response         | Content-Type | Status |
|--------|------------|------------------|--------------|--------|
| GET    | `/`        | `Hello, World!\n` | text/plain   | 200    |
| GET    | `/evening` | `Good evening`   | text/plain   | 200    |

### Examples

Fetch the root endpoint:

```bash
curl http://localhost:3000/
# Hello, World!
```

Fetch the evening endpoint:

```bash
curl http://localhost:3000/evening
# Good evening
```

## Technology Stack

- **Node.js** — JavaScript runtime
- **Express.js v5** — HTTP framework with routing and middleware support
