"""
Local preview server for the portfolio.

    python3 serve.py          -> http://localhost:8000

Same as `python3 -m http.server`, except it tells the browser not to cache
anything, so every refresh shows your latest edits. Not needed for hosting.
"""
import http.server
import socketserver

PORT = 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("", PORT), NoCacheHandler) as httpd:
    print(f"Serving on http://localhost:{PORT}  (Ctrl+C to stop)")
    httpd.serve_forever()
