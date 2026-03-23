"""
Flask application that serves two HTTP endpoints.

This module provides a lightweight HTTP server built with Flask, replicating
the functionality of the original Node.js Express.js server. It exposes:
  - GET /        -> Returns 'Hello, World!\\n' as plain text
  - GET /evening -> Returns 'Good evening' as plain text

Security headers (X-Content-Type-Options) are applied to every response
to prevent MIME type sniffing. The default Server header is suppressed to
avoid disclosing server technology, mirroring the Express.js behavior of
disabling the X-Powered-By header.
"""

from flask import Flask, Response
from werkzeug.serving import WSGIRequestHandler

# Suppress the Server header to prevent technology disclosure.
# This mirrors Express.js app.disable('x-powered-by') behavior.
# Override both server_version and sys_version so the resulting
# Server header is effectively empty.
WSGIRequestHandler.server_version = ''
WSGIRequestHandler.sys_version = ''

app = Flask(__name__)


@app.after_request
def set_security_headers(response):
    """Apply security headers to every outgoing response.

    Sets X-Content-Type-Options to 'nosniff' to prevent browsers from
    MIME-sniffing the response away from the declared Content-Type.
    """
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


@app.route('/', methods=['GET'])
def hello_world():
    """Handle GET / requests.

    Returns a plain-text response containing 'Hello, World!' followed by
    a newline character, preserving byte-identical parity with the original
    Node.js implementation.

    Returns:
        Response: HTTP 200 with Content-Type text/plain and body 'Hello, World!\\n'.
    """
    return Response('Hello, World!\n', status=200, content_type='text/plain')


@app.route('/evening', methods=['GET'])
def good_evening():
    """Handle GET /evening requests.

    Returns a plain-text response containing 'Good evening'.

    Returns:
        Response: HTTP 200 with Content-Type text/plain and body 'Good evening'.
    """
    return Response('Good evening', status=200, content_type='text/plain')


if __name__ == '__main__':
    port = 3000
    print(f'Server running at http://localhost:{port}/')
    app.run(host='0.0.0.0', port=port)
