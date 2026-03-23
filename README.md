# hao-backprop-test

A simple HTTP server built with [Flask](https://flask.palletsprojects.com/) (Python 3). This tutorial-style project demonstrates basic routing with two endpoints, rewritten from the original Node.js Express.js implementation.

## Prerequisites

- [Python](https://www.python.org/) >= 3.9
- pip (included with Python)

## Setup

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd hao-backprop-test
   ```

2. Create and activate a virtual environment (recommended):

   ```bash
   python -m venv venv
   source venv/bin/activate   # Linux / macOS
   venv\Scripts\activate      # Windows
   ```

3. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

## Running the Server

Start the server:

```bash
python app.py
```

The server will start on **port 3000** and log the URL to the console:

```
Server running at http://localhost:3000/
```

## Available Endpoints

| Method | Path       | Response          | Content-Type | Status |
|--------|------------|-------------------|--------------|--------|
| GET    | `/`        | `Hello, World!\n` | text/plain   | 200    |
| GET    | `/evening` | `Good evening`    | text/plain   | 200    |

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

- **Python 3** — Programming language
- **Flask** — Lightweight WSGI web framework with routing and request/response utilities
