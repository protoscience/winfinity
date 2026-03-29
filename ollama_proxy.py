#!/usr/bin/env python3
"""
Thin reverse proxy for Ollama that adds the Private-Network-Access header
Chrome requires when the page is served from a remote/public origin.

Usage:
    python3 ollama_proxy.py [--port 11435] [--ollama http://localhost:11434]

Then set Winfinity's Ollama URL to: http://192.168.1.120:11435
"""
import argparse
import http.server
import urllib.request
import urllib.error


PNA_HEADERS = [
    ('Access-Control-Allow-Origin',          '*'),
    ('Access-Control-Allow-Private-Network', 'true'),
    ('Access-Control-Allow-Methods',         'GET, POST, PUT, DELETE, OPTIONS'),
    ('Access-Control-Allow-Headers',         'Content-Type, Authorization'),
    ('Access-Control-Max-Age',               '86400'),
]


class ProxyHandler(http.server.BaseHTTPRequestHandler):
    ollama_base = 'http://localhost:11434'

    def _cors(self):
        for k, v in PNA_HEADERS:
            self.send_header(k, v)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        self._proxy('GET', body=None)

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length else b''
        self._proxy('POST', body=body)

    def _proxy(self, method, body):
        target = self.ollama_base + self.path
        req = urllib.request.Request(target, data=body, method=method)
        req.add_header('Content-Type', self.headers.get('Content-Type', 'application/json'))
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                data = resp.read()
            self.send_response(200)
            self.send_header('Content-Type', resp.headers.get('Content-Type', 'application/json'))
            self._cors()
            self.end_headers()
            self.wfile.write(data)
        except urllib.error.URLError as e:
            self.send_response(502)
            self._cors()
            self.end_headers()
            self.wfile.write(f'{{"error":"{e.reason}"}}'.encode())

    def log_message(self, fmt, *args):
        print(f'[proxy] {self.address_string()} {fmt % args}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Ollama PNA proxy')
    parser.add_argument('--port',   type=int, default=11435,
                        help='Port this proxy listens on (default: 11435)')
    parser.add_argument('--ollama', default='http://localhost:11434',
                        help='Ollama base URL (default: http://localhost:11434)')
    args = parser.parse_args()

    ProxyHandler.ollama_base = args.ollama.rstrip('/')

    print(f'Ollama PNA proxy listening on 0.0.0.0:{args.port}')
    print(f'Forwarding to {ProxyHandler.ollama_base}')
    print(f'Set Winfinity Ollama URL to: http://YOUR_MAC_IP:{args.port}')
    http.server.HTTPServer(('0.0.0.0', args.port), ProxyHandler).serve_forever()
