#!/usr/bin/env python3
import base64
import json
import os
import subprocess
import sys
from datetime import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

CREDENTIALS_PATH = Path.home() / ".config" / "llm-credentials.json"
OUTPUT_DIR = Path(__file__).parent / "output"
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
                for key in ("deepseek", "google", "openrouter", "mimo", "runpod"):
                    if key in creds:
                        config[key] = creds[key]
                self.wfile.write(json.dumps(config).encode())
            except FileNotFoundError:
                self.wfile.write(json.dumps({"error": "credentials file not found"}).encode())
        elif self.path == "/api/open-output":
            OUTPUT_DIR.mkdir(exist_ok=True)
            if sys.platform == "darwin":
                subprocess.Popen(["open", str(OUTPUT_DIR)])
            elif sys.platform == "win32":
                os.startfile(str(OUTPUT_DIR))
            else:
                subprocess.Popen(["xdg-open", str(OUTPUT_DIR)])
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True}).encode())
        elif self.path == "/api/open-config":
            CREDENTIALS_PATH.parent.mkdir(parents=True, exist_ok=True)
            if not CREDENTIALS_PATH.exists():
                CREDENTIALS_PATH.write_text(json.dumps({
                    "deepseek": {"base_url": "https://api.deepseek.com/v1", "api_key": "", "default_model": "", "models": [""]},
                    "google": {"base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "api_key": "", "default_model": "", "models": [""]},
                    "openrouter": {"base_url": "https://openrouter.ai/api/v1", "api_key": "", "default_model": "", "models": [""]},
                    "mimo": {"base_url": "https://api.xiaomimimo.com/v1", "api_key": "", "default_model": "", "models": [""]},
                }, indent=2))
            if sys.platform == "darwin":
                subprocess.Popen(["open", str(CREDENTIALS_PATH)])
            elif sys.platform == "win32":
                os.startfile(str(CREDENTIALS_PATH))
            else:
                subprocess.Popen(["xdg-open", str(CREDENTIALS_PATH)])
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True}).encode())
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/save-image":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            data_url = body.get("dataUrl", "")
            if not data_url:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "no dataUrl"}).encode())
                return

            header, b64 = data_url.split(",", 1)
            ext = "png" if "image/png" in header else "jpg"
            OUTPUT_DIR.mkdir(exist_ok=True)
            stem = f"img_{datetime.now():%Y%m%d_%H%M%S}"
            filename = f"{stem}.{ext}"
            (OUTPUT_DIR / filename).write_bytes(base64.b64decode(b64))

            prompt_json = body.get("promptJson", "")
            if prompt_json:
                (OUTPUT_DIR / f"{stem}.json").write_text(prompt_json)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "filename": filename}).encode())
        else:
            self.send_error(404)

    def log_message(self, format, *args):
        if args[0] == "GET" and args[1] == "/api/config":
            return
        super().log_message(format, *args)


if __name__ == "__main__":
    httpd = HTTPServer(("", PORT), Handler)
    print(f"Ideogram Builder — http://localhost:{PORT}")
    httpd.serve_forever()
