#!/usr/bin/env python3
import json
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

CREDENTIALS_PATH = Path.home() / ".config" / "llm-credentials.json"
PORT = int(os.environ.get("PORT", "8080"))


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/config":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            try:
                creds = json.loads(CREDENTIALS_PATH.read_text())
                config = {}
                config["deepseek"] = creds.get("deepseek", {})
                config["runpod"] = creds.get("runpod", {})
                self.wfile.write(json.dumps(config).encode())
            except FileNotFoundError:
                self.wfile.write(json.dumps({"error": "credentials file not found"}).encode())
        else:
            super().do_GET()

    def log_message(self, format, *args):
        if args[0] == "GET" and args[1] == "/api/config":
            return
        super().log_message(format, *args)


if __name__ == "__main__":
    httpd = HTTPServer(("", PORT), Handler)
    print(f"Ideogram Builder — http://localhost:{PORT}")
    httpd.serve_forever()
