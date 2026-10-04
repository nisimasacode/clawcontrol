#!/usr/bin/env python3
"""Local HTTP server + CORS proxy for CDP screencast login tooling.

Serves cdp-screencast.html and proxies /cdp/* to a Chromium CDP endpoint
reachable on localhost (typically via an SSH tunnel to a published container
port).

Usage:
  python serve_cdp.py [cdp_port]

Default cdp_port is 9223. HTTP UI always listens on http://localhost:8000/
"""

import http.client
import http.server
import os
import socketserver
import sys

CDP_HOST = "localhost"
CDP_PORT = 9223


class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/cdp/"):
            self._proxy_cdp()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith("/cdp/"):
            self._proxy_cdp()
        else:
            super().do_POST()

    def _proxy_cdp(self):
        try:
            target = self.path[len("/cdp") :] or "/"
            conn = http.client.HTTPConnection(CDP_HOST, CDP_PORT, timeout=10)
            headers = {k: self.headers[k] for k in self.headers.keys()}
            headers.pop("Host", None)
            body = None
            if self.command == "POST":
                cl = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(cl)
            conn.request(self.command, target, body=body, headers=headers)
            resp = conn.getresponse()
            data = resp.read()
            self.send_response(resp.status)
            for h, v in resp.getheaders():
                if h.lower() not in ("transfer-encoding", "content-length", "connection"):
                    self.send_header(h, v)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", len(data))
            self.end_headers()
            if data:
                self.wfile.write(data)
            conn.close()
        except Exception as e:
            self.send_response(502)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(str(e).encode())

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        try:
            CDP_PORT = int(sys.argv[1])
        except ValueError:
            print(f"Invalid CDP port: {sys.argv[1]!r}", file=sys.stderr)
            sys.exit(2)
        if CDP_PORT < 1 or CDP_PORT > 65535:
            print(f"CDP port out of range: {CDP_PORT}", file=sys.stderr)
            sys.exit(2)

    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    with socketserver.TCPServer(("", 8000), CORSRequestHandler) as httpd:
        print("Serving at http://localhost:8000/")
        print(f"CORS CDP proxy at http://localhost:8000/cdp/... -> {CDP_HOST}:{CDP_PORT}")
        print("Open http://localhost:8000/cdp-screencast.html")
        httpd.serve_forever()
