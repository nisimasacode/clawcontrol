#!/usr/bin/env python3
"""
CDP HTTP+WebSocket proxy for Chrome.
Listens on 0.0.0.0:9223 and proxies to Chrome at 127.0.0.1:9222.
Rewrites WebSocket URLs in HTTP responses so they point back to this proxy.
Handles both plain HTTP (json/version) and WebSocket upgrades.
"""
import socket
import threading
import http.client
import selectors
from selectors import SelectorKey
from typing import List, Tuple

PROXY_HOST = "0.0.0.0"
PROXY_PORT = 9223
CHROME_HOST = "127.0.0.1"
CHROME_PORT = 9222

# Chrome only accepts Host: localhost
CHROME_HOST_HEADER = "localhost"


class ProxyBackend:
    """Manages a connection pair: browser <-> chrome, rewriting WS URLs in HTTP responses."""

    def __init__(self, browser_sock: socket.socket):
        self.browser_sock = browser_sock
        self.chrome_sock = None
        self.selector = selectors.DefaultSelector()
        self.running = True
        self.browser_host = None  # Host header from browser (used for WS URL rewrite)

    def _build_http_request(self, browser_sock: socket.socket) -> tuple:
        """Read a complete HTTP request from browser, return (method, path, headers, body)."""
        raw = b""
        while b"\r\n\r\n" not in raw:
            chunk = browser_sock.recv(4096)
            if not chunk:
                raise EOFError("Browser closed connection")
            raw += chunk

        header_end = raw.index(b"\r\n\r\n")
        headers_raw = raw[:header_end].decode("utf-8", errors="replace")
        body = raw[header_end + 4:]

        lines = headers_raw.split("\r\n")
        request_line = lines[0]
        method, path, version = request_line.split(" ")

        headers = {}
        for line in lines[1:]:
            if ": " in line:
                k, v = line.split(": ", 1)
                headers[k.lower()] = v

        return method.upper(), path, headers, body, headers.get("host", "")

    def _send_to_chrome(self, method: str, path: str, headers: dict, body: bytes) -> bytes:
        """Forward request to Chrome, return response."""
        conn = http.client.HTTPConnection(CHROME_HOST, CHROME_PORT, timeout=30)
        chrome_headers = {k: (CHROME_HOST_HEADER if k == "host" else v) for k, v in headers.items()}

        try:
            conn.request(method, path, body=body, headers=chrome_headers)
            resp = conn.getresponse()
            resp_body = resp.read()

            status_line = f"HTTP/1.1 {resp.status} {resp.reason}\r\n"
            # Strip Content-Length so browser uses actual body size (body may change after URL rewrite)
            resp_headers = [(k, v) for k, v in resp.getheaders() if k.lower() not in ("content-length", "content-encoding")]
            resp_headers_str = "\r\n".join(f"{k}: {v}" for k, v in resp_headers)
            full_resp = f"{status_line}{resp_headers_str}\r\n\r\n".encode() + resp_body
            return full_resp
        finally:
            conn.close()

    def _rewrite_ws_url(self, data: bytes) -> bytes:
        """Rewrite ws:// URLs in response data to point to proxy host."""
        # browser_host is the Host header value, may include :port — strip port for WS URL
        host_only = self.browser_host.split(":")[0] if self.browser_host else "localhost"
        rewrite_to = f"ws://{host_only}:{PROXY_PORT}".encode()
        # Also without port (e.g. ws://localhost/devtools/...)
        data = data.replace(b"ws://127.0.0.1:9222", rewrite_to)
        data = data.replace(b"ws://localhost:9222", rewrite_to)
        data = data.replace(b"ws://127.0.0.1:9223", rewrite_to)
        data = data.replace(b"ws://localhost:9223", rewrite_to)
        data = data.replace(b"ws://127.0.0.1", rewrite_to)
        data = data.replace(b"ws://localhost", rewrite_to)
        return data

    def _is_websocket_upgrade(self, headers: dict) -> bool:
        return headers.get("upgrade", "").lower() == "websocket"

    def handle(self):
        """Handle the browser connection - either HTTP or WebSocket."""
        try:
            method, path, headers, body, browser_host = self._build_http_request(self.browser_sock)
            self.browser_host = browser_host

            if self._is_websocket_upgrade(headers):
                # === WebSocket upgrade ===
                self.chrome_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self.chrome_sock.connect((CHROME_HOST, CHROME_PORT))
                self.chrome_sock.settimeout(30)

                # Forward upgrade request to Chrome
                chrome_headers = {k: (CHROME_HOST_HEADER if k == "host" else v) for k, v in headers.items()}
                req_lines = [f"{method} {path} HTTP/1.1"]
                for k, v in chrome_headers.items():
                    if k == "sec-websocket-key":
                        req_lines.append(f"Sec-WebSocket-Key: {v}")
                    elif k == "sec-websocket-version":
                        req_lines.append(f"Sec-WebSocket-Version: {v}")
                    elif k == "sec-websocket-protocol":
                        req_lines.append(f"Sec-WebSocket-Protocol: {v}")
                    elif k != "host":
                        req_lines.append(f"{k}: {v}")
                req_lines.append(f"Host: {CHROME_HOST_HEADER}")
                req_lines.append("")
                req_lines.append("")
                self.chrome_sock.sendall("\r\n".join(req_lines).encode())

                # Read Chrome's 101 response and forward to browser
                chrome_resp = b""
                while b"\r\n\r\n" not in chrome_resp:
                    chunk = self.chrome_sock.recv(4096)
                    if not chunk:
                        self.browser_sock.close()
                        self.chrome_sock.close()
                        return
                    chrome_resp += chunk
                self.browser_sock.sendall(chrome_resp)

                # Relay WebSocket frames bidirectionally
                self.browser_sock.setblocking(False)
                self.chrome_sock.setblocking(False)

                sel = selectors.DefaultSelector()
                sel.register(self.browser_sock, selectors.EVENT_READ, "browser")
                sel.register(self.chrome_sock, selectors.EVENT_READ, "chrome")

                while self.running:
                    events = sel.select(timeout=1.0)
                    for key, _ in events:
                        sock = key.fileobj
                        other = self.chrome_sock if sock == self.browser_sock else self.browser_sock
                        try:
                            data = sock.recv(4096)
                            if not data:
                                self.running = False
                                break
                            other.sendall(data)
                        except (BlockingIOError, OSError):
                            pass

            else:
                # === Plain HTTP ===
                resp = self._send_to_chrome(method, path, headers, body)
                resp = self._rewrite_ws_url(resp)
                self.browser_sock.sendall(resp)

        except Exception as e:
            print(f"Proxy error: {e}")
        finally:
            self.running = False
            try:
                self.browser_sock.close()
            except Exception:
                pass
            try:
                if self.chrome_sock:
                    self.chrome_sock.close()
            except Exception:
                pass


def handle_client(browser_sock: socket.socket, addr: Tuple[str, int]):
    backend = ProxyBackend(browser_sock)
    backend.handle()


def main():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((PROXY_HOST, PROXY_PORT))
    server.listen(50)
    print(f"CDP proxy listening on {PROXY_HOST}:{PROXY_PORT} -> Chrome at {CHROME_HOST}:{CHROME_PORT}")

    try:
        while True:
            browser_sock, addr = server.accept()
            t = threading.Thread(target=handle_client, args=(browser_sock, addr), daemon=True)
            t.start()
    except KeyboardInterrupt:
        print("Shutting down")
    finally:
        server.close()


if __name__ == "__main__":
    main()
