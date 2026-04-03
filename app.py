"""
Flask HTTP Server — functionally identical replacement for the Node.js server.js.

This module implements a minimal Flask application that responds to every inbound
HTTP request (regardless of method, path, headers, or payload) with an HTTP 200 OK
status, a Content-Type: text/plain header, and the exact body "Hello, World!\n".

The server binds exclusively to the loopback address 127.0.0.1 on port 3000,
preserving network binding parity with the original Node.js implementation.

Usage:
    python app.py
"""

from flask import Flask, Response

# Flask application instance — replaces Node.js http.createServer()
app = Flask(__name__)

# Network binding constants — PEP 8 naming convention for module-level constants
# These mirror the hardcoded values from the original server.js (lines 3-4)
HOSTNAME = '127.0.0.1'
PORT = 3000


@app.route('/', defaults={'path': ''}, methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'])
@app.route('/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'])
def catch_all(path):
    """
    Catch-all route handler that responds identically to every HTTP request.

    This handler replicates the behavior of the Node.js http.createServer() callback
    in server.js (lines 6-9), which ignores the request object entirely and always
    returns the same response: status 200, Content-Type text/plain, body "Hello, World!\n".

    The dual-decorator pattern ensures both the root path '/' and all sub-paths
    '/<path:path>' are matched. All standard HTTP methods are explicitly listed
    to prevent Flask's default GET-only routing.

    Args:
        path: The URL path captured by the route. This parameter is accepted but
              intentionally ignored to mirror the Node.js behavior where the req
              object is never read.

    Returns:
        A Flask Response object with status 200, Content-Type text/plain,
        and body "Hello, World!\n" (including the trailing newline character).
    """
    return Response('Hello, World!\n', status=200, content_type='text/plain')


if __name__ == '__main__':
    # Print startup message to stdout before starting the server,
    # replicating the Node.js console.log() in server.js (lines 12-14)
    print(f'Server running at http://{HOSTNAME}:{PORT}/')
    # Start the Flask development server on the loopback address,
    # equivalent to server.listen(port, hostname, callback) in Node.js
    app.run(host=HOSTNAME, port=PORT)
