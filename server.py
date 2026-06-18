#!/usr/bin/env python3
import base64
import json
import os
import subprocess
import sys
from datetime import datetime
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

CREDENTIALS_PATH = Path.home() / ".config" / "llm-credentials.json"
OUTPUT_DIR = Path(__file__).parent / "output"
IMG_TO_JSON_DIR = Path(__file__).parent / "img-to-json"
PORT = int(os.environ.get("PORT", "8080"))

# Import canonicalize + verify from img-to-json utils
sys.path.insert(0, str(IMG_TO_JSON_DIR))
from utils.caption_verifier import canonicalize, verify


class Handler(SimpleHTTPRequestHandler):
    def _send_json(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _canonicalize_and_verify(self, raw_dict: dict) -> tuple[dict, list[str]]:
        try:
            raw_str = json.dumps(raw_dict, separators=(",", ":"), ensure_ascii=False)
            canon_str = canonicalize(raw_str)
            warnings = verify(canon_str)
            return json.loads(canon_str), warnings
        except json.JSONDecodeError as e:
            return raw_dict, [f"Invalid JSON: {e}"]

    def _handle_vision_api(self, model, image_b64, ext):
        try:
            provider, model_name = model.split("::", 1)
        except ValueError:
            self._send_json(400, {"error": "invalid model format, expected provider::model_name"})
            return

        try:
            creds = json.loads(CREDENTIALS_PATH.read_text())
            vision = creds.get("vision", {})
            provider_cfg = vision.get(provider, {})
            base_url = provider_cfg.get("base_url", "")
            api_key = provider_cfg.get("api_key", "")
            if not base_url or not api_key:
                self._send_json(400, {"error": f"vision provider '{provider}' not configured in credentials"})
                return
        except FileNotFoundError:
            self._send_json(500, {"error": "credentials file not found"})
            return

        prompt_path = IMG_TO_JSON_DIR / "prompts" / "vision_analysis.txt"
        try:
            system_prompt = prompt_path.read_text().strip()
        except FileNotFoundError:
            self._send_json(500, {"error": "vision_analysis.txt prompt not found"})
            return

        url = f"{base_url.rstrip('/')}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }

        def _make_payload(use_json_mode: bool):
            payload = {
                "model": model_name,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Analyze this image and return the JSON prompt data."},
                            {"type": "image_url", "image_url": {"url": image_b64}},
                        ],
                    },
                ],
                "max_tokens": 4096,
            }
            if use_json_mode:
                payload["response_format"] = {"type": "json_object"}
            return payload

        def _do_request(payload):
            data = json.dumps(payload).encode()
            req = Request(url, data=data, headers=headers, method="POST")
            with urlopen(req, timeout=120) as resp:
                result = json.loads(resp.read().decode())
            return result

        use_json_mode = True
        for attempt in range(2):
            try:
                payload = _make_payload(use_json_mode)
                result = _do_request(payload)
                break
            except URLError as e:
                code = getattr(e, "code", None)
                if code == 400 and use_json_mode:
                    use_json_mode = False
                    continue
                self._send_json(502, {"error": f"Vision API request failed: {str(e)}"})
                return
            except json.JSONDecodeError:
                self._send_json(502, {"error": "Vision API returned invalid JSON response"})
                return

        try:
            content = result["choices"][0]["message"]["content"]
            if not content:
                self._send_json(502, {"error": "Vision API returned empty response"})
                return
            parsed = json.loads(content)
            canon, warnings = self._canonicalize_and_verify(parsed)
            self._send_json(200, {"json": canon, "warnings": warnings})
        except (KeyError, IndexError, json.JSONDecodeError):
            self._send_json(502, {"error": "Failed to parse vision API response content"})

    def do_GET(self):
        if self.path == "/api/config":
            try:
                creds = json.loads(CREDENTIALS_PATH.read_text())
                config = {}
                for key in ("deepseek", "google", "openrouter", "mimo", "runpod", "vision"):
                    if key in creds:
                        config[key] = creds[key]
                config["_meta"] = {
                    "local_available": sys.platform == "darwin",
                }
                self._send_json(200, config)
            except FileNotFoundError:
                self._send_json(200, {"error": "credentials file not found"})
        elif self.path == "/api/open-output":
            OUTPUT_DIR.mkdir(exist_ok=True)
            if sys.platform == "darwin":
                subprocess.Popen(["open", str(OUTPUT_DIR)])
            elif sys.platform == "win32":
                os.startfile(str(OUTPUT_DIR))
            else:
                subprocess.Popen(["xdg-open", str(OUTPUT_DIR)])
            self._send_json(200, {"ok": True})
        elif self.path == "/api/open-config":
            CREDENTIALS_PATH.parent.mkdir(parents=True, exist_ok=True)
            if not CREDENTIALS_PATH.exists():
                CREDENTIALS_PATH.write_text(json.dumps({
                    "deepseek": {"base_url": "https://api.deepseek.com/v1", "api_key": "", "default_model": "", "models": [""]},
                    "google": {"base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "api_key": "", "default_model": "", "models": [""]},
                    "openrouter": {"base_url": "https://openrouter.ai/api/v1", "api_key": "", "default_model": "", "models": [""]},
                    "mimo": {"base_url": "https://api.xiaomimimo.com/v1", "api_key": "", "default_model": "", "models": [""]},
                    "vision": {
                        "local": {
                            "default_model": "qwen3-vl-4b",
                            "models": ["qwen3-vl-4b"]
                        },
                        "openai": {
                            "base_url": "https://api.openai.com/v1",
                            "api_key": "",
                            "default_model": "gpt-4o",
                            "models": ["gpt-4o", "gpt-4o-mini"]
                        }
                    },
                }, indent=2))
            if sys.platform == "darwin":
                subprocess.Popen(["open", str(CREDENTIALS_PATH)])
            elif sys.platform == "win32":
                os.startfile(str(CREDENTIALS_PATH))
            else:
                subprocess.Popen(["xdg-open", str(CREDENTIALS_PATH)])
            self._send_json(200, {"ok": True})
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/save-image":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            data_url = body.get("dataUrl", "")
            if not data_url:
                self._send_json(400, {"error": "no dataUrl"})
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

            self._send_json(200, {"ok": True, "filename": filename})
        elif self.path == "/api/img-to-json":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            image_b64 = body.get("image", "")
            model = body.get("model", "local")
            no_sam = body.get("no_sam", False)
            low_memory = body.get("low_memory", False)
            debug_flag = body.get("debug", False)

            if not image_b64:
                self._send_json(400, {"error": "no image field"})
                return

            try:
                header, b64 = image_b64.split(",", 1)
            except ValueError:
                self._send_json(400, {"error": "invalid data URL"})
                return

            ext = "png" if "image/png" in header else "jpg"

            if model == "local":
                img_data = base64.b64decode(b64)
                import tempfile
                tmp = tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False)
                try:
                    tmp.write(img_data)
                    tmp.close()

                    cmd = ["uv", "run", "--directory", str(IMG_TO_JSON_DIR), "python", "main.py", tmp.name]
                    if no_sam:
                        cmd.append("--no-sam")
                    if low_memory:
                        cmd.append("--low-memory")
                    if debug_flag:
                        cmd.append("--debug")

                    result = subprocess.run(
                        cmd, capture_output=True, text=True, timeout=180,
                        cwd=str(IMG_TO_JSON_DIR),
                    )

                    if result.returncode != 0:
                        error_msg = result.stderr.strip() or f"exit code {result.returncode}"
                        self._send_json(500, {"error": error_msg})
                        return

                    json_output = json.loads(result.stdout)

                    # Extract verifier warnings from stderr
                    verifier_warnings = [
                        line for line in result.stderr.splitlines()
                        if line.startswith("[verifier]")
                    ]

                    # Extract debug dir from stderr
                    debug_dir = None
                    for line in result.stderr.splitlines():
                        if line.startswith("[debug_dir]"):
                            debug_dir = line[len("[debug_dir]"):]
                            break

                    canon, canon_warnings = self._canonicalize_and_verify(json_output)
                    all_warnings = verifier_warnings + canon_warnings

                    response = {"json": canon, "warnings": all_warnings}
                    if debug_dir:
                        response["debug_dir"] = debug_dir
                    self._send_json(200, response)
                except subprocess.TimeoutExpired:
                    self._send_json(504, {"error": "Pipeline timed out after 180 seconds"})
                except json.JSONDecodeError:
                    self._send_json(500, {"error": "Pipeline returned invalid JSON"})
                except FileNotFoundError:
                    self._send_json(500, {"error": "img-to-json pipeline not found"})
                finally:
                    os.unlink(tmp.name)
            else:
                self._handle_vision_api(model, image_b64, ext)
        else:
            self._send_json(404, {"error": "not found"})

    def log_message(self, format, *args):
        if args[0] == "GET" and args[1] == "/api/config":
            return
        super().log_message(format, *args)


if __name__ == "__main__":
    httpd = ThreadingHTTPServer(("", PORT), Handler)
    print(f"Ideogram Builder — http://localhost:{PORT}")
    httpd.serve_forever()
