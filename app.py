"""
Flask HTTP Server — functionally identical replacement for the original HTTP server.

This module implements a minimal Flask application that responds to every inbound
HTTP request (regardless of method, path, headers, or payload) with an HTTP 200 OK
status, a Content-Type: text/plain header, and the exact body "Hello, World!\n".

The server binds exclusively to the loopback address 127.0.0.1 on port 3000,
preserving network binding parity with the original implementation.

Usage:
    python app.py
"""

from flask import Flask, Response

# Flask application instance — replaces the original HTTP server factory
app = Flask(__name__)

# Network binding constants — PEP 8 naming convention for module-level constants
# These mirror the hardcoded values from the original server implementation
HOSTNAME = '127.0.0.1'
PORT = 3000


@app.route('/', defaults={'path': ''}, methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'])
@app.route('/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'])
def catch_all(path):
    """
    Catch-all route handler that responds identically to every HTTP request.

    This handler replicates the behavior of the original HTTP server's request handler
    callback, which ignores the request object entirely and always
    returns the same response: status 200, Content-Type text/plain, body "Hello, World!\n".

    The dual-decorator pattern ensures both the root path '/' and all sub-paths
    '/<path:path>' are matched. All standard HTTP methods are explicitly listed
    to prevent Flask's default GET-only routing.

    Args:
        path: The URL path captured by the route. This parameter is accepted but
              intentionally ignored to mirror the original server behavior where the request
              object is never read.

    Returns:
        A Flask Response object with status 200, Content-Type text/plain,
        and body "Hello, World!\n" (including the trailing newline character).
    """
    return Response('Hello, World!\n', status=200, content_type='text/plain')


if __name__ == '__main__':
    # Print startup message to stdout before starting the server,
    # replicating the original server's startup console logging
    print(f'Server running at http://{HOSTNAME}:{PORT}/')
    # Start the Flask development server on the loopback address,
    # equivalent to the original server's listen binding
    app.run(host=HOSTNAME, port=PORT)
