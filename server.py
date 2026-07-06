#!/usr/bin/env python3
import base64
import http.client
import json
import os
import re
import signal
import subprocess
import sys
import time
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

_vision_state = {"proc": None, "cancelled": False, "status": ""}


class _Cancelled(Exception):
    """Raised when the user cancels an in-flight vision subprocess or cloud call."""

# Import canonicalize + verify from img-to-json utils
sys.path.insert(0, str(IMG_TO_JSON_DIR))
from utils.caption_verifier import canonicalize, verify
from utils.bbox import to_yxyx, format_prompt


def _vlog(*parts):
    """Vision-prefixed stderr line for debugging the img-to-json flow."""
    print("[vision]", *parts, file=sys.stderr, flush=True)


def _vstatus(msg):
    """Set the live UI status (polled via /api/img-to-json/status) AND log to stderr."""
    _vision_state["status"] = msg
    _vlog(msg)


def _interruptible_sleep(seconds):
    """Sleep that aborts on vision cancel. Returns True if cancelled."""
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if _vision_state["cancelled"]:
            return True
        time.sleep(0.2)
    return _vision_state["cancelled"]


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Dev server: never serve stale JS/CSS after edits (forces the browser
        # to revalidate on every request).
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

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

    def _cloud_vlm_chat(self, base_url, api_key, model_name, system_prompt, user_text, image_b64, phase=""):
        """One cloud VLM chat completion. Returns raw content string.
        json_mode first, falls back to text mode on HTTP 400. Retries transient
        errors (429/500/502/503/504 + network/timeout) with capped exponential
        backoff up to 10 attempts. Abortable via _vision_state["cancelled"].
        Raises _Cancelled on user cancel, RuntimeError on hard failure."""
        url = f"{base_url.rstrip('/')}/chat/completions"
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": [
                {"type": "text", "text": user_text},
                {"type": "image_url", "image_url": {"url": image_b64}},
            ]},
        ]
        transient_codes = {429, 500, 502, 503, 504}
        max_attempts = 10
        label = f"{phase} " if phase else ""
        use_json = True
        for attempt in range(max_attempts):
            if _vision_state["cancelled"]:
                raise _Cancelled()
            payload = {"model": model_name, "messages": messages, "max_tokens": 4096}
            if use_json:
                payload["response_format"] = {"type": "json_object"}
            try:
                data = json.dumps(payload).encode()
                req = Request(url, data=data, headers=headers, method="POST")
                _vstatus(f"{label}Calling {model_name} (attempt {attempt + 1}/{max_attempts})\u2026")
                with urlopen(req, timeout=120) as resp:
                    raw = resp.read().decode(errors="replace")
                result = json.loads(raw)
                content = result["choices"][0]["message"]["content"]
                if not content:
                    raise RuntimeError("cloud VLM returned empty content")
                return content
            except URLError as e:
                code = getattr(e, "code", None)
                preview = ""
                try:
                    preview = e.read().decode(errors="replace")[:500]
                except Exception:
                    pass
                if code == 400 and use_json:
                    use_json = False
                    _vstatus(f"{label}Model rejected JSON mode, retrying as text\u2026")
                    continue
                if code in transient_codes and attempt < max_attempts - 1:
                    delay = min(2 ** attempt, 30)
                    _vstatus(f"{label}Server busy (HTTP {code}), retry {attempt + 1}/{max_attempts} in {delay}s")
                    if _interruptible_sleep(delay):
                        raise _Cancelled()
                    continue
                raise RuntimeError(f"cloud VLM request failed (code={code}): {preview or e.reason}")
            except (TimeoutError, ConnectionError) as e:
                if attempt < max_attempts - 1:
                    delay = min(2 ** attempt, 30)
                    _vstatus(f"{label}Network error ({type(e).__name__}), retry {attempt + 1}/{max_attempts} in {delay}s")
                    if _interruptible_sleep(delay):
                        raise _Cancelled()
                    continue
                raise RuntimeError(f"cloud VLM network error: {type(e).__name__}: {e}")
            except http.client.HTTPException as e:
                raise RuntimeError(f"cloud VLM connection failed: {type(e).__name__}: {e}")
            except (KeyError, IndexError, TypeError) as e:
                raise RuntimeError(f"cloud VLM unexpected response shape: {e}")
        raise RuntimeError(f"cloud VLM failed after {max_attempts} attempts")

    def _run_pipeline_subprocess(self, cmd):
        """Spawn img-to-json subprocess, capture output. Returns (json, verifier_warnings, debug_dir, stderr_lines).
        Raises _Cancelled on user cancel, RuntimeError on non-zero exit / bad JSON."""
        _vlog(f"subprocess: {' '.join(cmd)}")
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, cwd=str(IMG_TO_JSON_DIR), start_new_session=True,
        )
        _vision_state["proc"] = proc
        _vision_state["cancelled"] = False
        stdout, stderr = proc.communicate()
        _vision_state["proc"] = None

        for line in stderr.splitlines():
            print(f"[vision:subprocess] {line}", file=sys.stderr, flush=True)

        if _vision_state["cancelled"]:
            raise _Cancelled()
        if proc.returncode != 0:
            raise RuntimeError(stderr.strip() or f"exit code {proc.returncode}")

        try:
            json_output = json.loads(stdout)
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Pipeline returned invalid JSON: {e}; stdout preview: {stdout[:500]!r}")

        verifier_warnings = [line for line in stderr.splitlines() if line.startswith("[verifier]")]
        debug_dir = None
        for line in stderr.splitlines():
            if line.startswith("[debug_dir]"):
                debug_dir = line[len("[debug_dir]"):]
                break
        return json_output, verifier_warnings, debug_dir

    def _resolve_cloud_provider(self, model):
        """Returns (provider, model_name, base_url, api_key) or sends a JSON error + returns None."""
        try:
            provider, model_name = model.split("::", 1)
        except ValueError:
            self._send_json(400, {"error": "invalid model format, expected provider::model_name"})
            return None
        try:
            creds = json.loads(CREDENTIALS_PATH.read_text())
        except FileNotFoundError:
            self._send_json(500, {"error": "credentials file not found"})
            return None
        vision = creds.get("vision", {})
        provider_cfg = vision.get(provider) or creds.get(provider, {})
        base_url = provider_cfg.get("base_url", "")
        api_key = provider_cfg.get("api_key", "")
        if not base_url or not api_key:
            self._send_json(400, {"error": f"vision provider '{provider}' not configured in credentials"})
            return None
        return provider, model_name, base_url, api_key

    def _handle_vision_api(self, model, image_b64, ext, bbox_format="xyxy"):
        # ponytail: single-shot cloud VLM call. Split path is _handle_vision_split.
        resolved = self._resolve_cloud_provider(model)
        if resolved is None:
            return
        provider, model_name, base_url, api_key = resolved
        _vlog(f"external: provider={provider} model={model_name} bbox_format={bbox_format} image_b64_len={len(image_b64)}")

        prompt_path = IMG_TO_JSON_DIR / "prompts" / "vision_analysis.txt"
        try:
            system_prompt = format_prompt(prompt_path.read_text().strip(), bbox_format)
        except FileNotFoundError:
            self._send_json(500, {"error": "vision_analysis.txt prompt not found"})
            return

        try:
            content = self._cloud_vlm_chat(base_url, api_key, model_name, system_prompt,
                                           "Analyze this image and return the JSON prompt data.", image_b64)
        except RuntimeError as e:
            _vlog(f"external: cloud call failed: {e}")
            self._send_json(502, {"error": str(e)})
            return

        _vlog(f"external: content_len={len(content)} preview={content[:200]!r}")
        _vstatus("Parsing response\u2026")
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            self._send_json(502, {"error": "Vision API content not valid JSON", "detail": content[:500]})
            return
        elements = (parsed.get("compositional_deconstruction") or {}).get("elements") or []
        for el in elements:
            if "bbox" in el:
                el["bbox"] = to_yxyx(el.get("bbox"), bbox_format)
        _vstatus("Verifying output\u2026")
        canon, warnings = self._canonicalize_and_verify(parsed)
        if warnings:
            _vlog(f"external: verifier warnings: {warnings}")
        _vlog(f"external: ok, elements={len(canon.get('compositional_deconstruction', {}).get('elements', []))}")
        self._send_json(200, {"json": canon, "warnings": warnings})

    def _handle_vision_split(self, model, image_b64, ext, bbox_format="xyxy", debug_flag=False, style_override=None):
        """Cloud-VLM split: 2 chat calls (scene + objects) → local subprocess for SAM + build_json.
        SAM3 has no cloud equivalent, so it stays local; the VLM work is what moves to the cloud."""
        resolved = self._resolve_cloud_provider(model)
        if resolved is None:
            return
        provider, model_name, base_url, api_key = resolved
        _vlog(f"external-split: provider={provider} model={model_name} bbox_format={bbox_format}")

        scene_prompt_name = "scene_analysis_no_style.txt" if style_override else "scene_analysis.txt"
        try:
            scene_prompt = (IMG_TO_JSON_DIR / "prompts" / scene_prompt_name).read_text().strip()
            object_prompt = (IMG_TO_JSON_DIR / "prompts" / "object_listing.txt").read_text().strip()
        except FileNotFoundError as e:
            self._send_json(500, {"error": f"split prompt not found: {e}"})
            return

        # Call 1: scene
        try:
            scene_content = self._cloud_vlm_chat(base_url, api_key, model_name, scene_prompt,
                                                 "Analyze this image and return the JSON.", image_b64, phase="Scene")
            scene = json.loads(scene_content)
        except RuntimeError as e:
            self._send_json(502, {"error": f"scene call failed: {e}"})
            return
        except json.JSONDecodeError:
            self._send_json(502, {"error": "scene call returned invalid JSON", "detail": scene_content[:500]})
            return

        # Call 2: objects
        try:
            objects_content = self._cloud_vlm_chat(base_url, api_key, model_name, object_prompt,
                                                   "List the individual objects in this image and return the JSON.", image_b64, phase="Objects")
            objects_resp = json.loads(objects_content)
        except RuntimeError as e:
            self._send_json(502, {"error": f"object call failed: {e}"})
            return
        except json.JSONDecodeError:
            self._send_json(502, {"error": "object call returned invalid JSON", "detail": objects_content[:500]})
            return

        _vlog(f"external-split: VLM done, scene keys={list(scene.keys())} objects={len(objects_resp.get('objects', []))}")

        # Spawn local subprocess for SAM + build_json (pipeline_split.run with overrides)
        try:
            header, b64 = image_b64.split(",", 1)
        except ValueError:
            b64 = image_b64
        img_data = base64.b64decode(b64)

        import tempfile
        tmp_img = tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False)
        tmp_scene = tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w")
        tmp_objects = tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w")
        tmp_style = None
        try:
            tmp_img.write(img_data); tmp_img.close()
            json.dump(scene, tmp_scene); tmp_scene.close()
            json.dump(objects_resp, tmp_objects); tmp_objects.close()

            cmd = ["uv", "run", "--directory", str(IMG_TO_JSON_DIR), "python", "main.py", tmp_img.name,
                   "--split", "--bbox-format", bbox_format,
                   "--scene-file", tmp_scene.name, "--objects-file", tmp_objects.name]
            if debug_flag:
                cmd.append("--debug")
            if style_override:
                tmp_style = tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w")
                json.dump(style_override, tmp_style); tmp_style.close()
                cmd.extend(["--style-override", tmp_style.name])

            _vstatus("Running local SAM + build pipeline\u2026")
            try:
                json_output, verifier_warnings, debug_dir = self._run_pipeline_subprocess(cmd)
            except _Cancelled:
                self._send_json(499, {"error": "Cancelled"})
                return
            except FileNotFoundError:
                self._send_json(500, {"error": "img-to-json pipeline not found"})
                return
            except RuntimeError as e:
                self._send_json(500, {"error": str(e)})
                return
        finally:
            for p in (tmp_img.name, tmp_scene.name, tmp_objects.name):
                try: os.unlink(p)
                except OSError: pass
            if tmp_style:
                try: os.unlink(tmp_style.name)
                except OSError: pass

        canon, canon_warnings = self._canonicalize_and_verify(json_output)
        all_warnings = verifier_warnings + canon_warnings
        _vlog(f"external-split: ok, elements={len(canon.get('compositional_deconstruction', {}).get('elements', []))} warnings={len(all_warnings)}")
        response = {"json": canon, "warnings": all_warnings}
        if debug_dir:
            response["debug_dir"] = debug_dir
        self._send_json(200, response)

    def do_GET(self):
        if self.path == "/api/config":
            try:
                creds = json.loads(CREDENTIALS_PATH.read_text())
                config = {}
                for key in ("deepseek", "google", "openrouter", "mimo", "runpod", "modal", "vision"):
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
        elif self.path == "/api/list-output":
            OUTPUT_DIR.mkdir(exist_ok=True)
            items = []
            for img_path in OUTPUT_DIR.iterdir():
                if img_path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
                    continue
                json_path = OUTPUT_DIR / f"{img_path.name}.json"
                prompt_json = ""
                if json_path.exists():
                    try:
                        prompt_json = json_path.read_text()
                    except Exception:
                        pass
                meta_path = OUTPUT_DIR / f"{img_path.name}.meta.json"
                meta = {}
                if meta_path.exists():
                    try:
                        meta = json.loads(meta_path.read_text())
                    except Exception:
                        pass
                items.append({
                    "id": img_path.name,
                    "img": img_path.name,
                    "prompt_json": prompt_json,
                    "mtime": img_path.stat().st_mtime,
                    "meta": meta,
                })
            items.sort(key=lambda x: x["mtime"], reverse=True)
            self._send_json(200, items)
        elif self.path == "/api/open-config":
            CREDENTIALS_PATH.parent.mkdir(parents=True, exist_ok=True)
            if not CREDENTIALS_PATH.exists():
                CREDENTIALS_PATH.write_text(json.dumps({
                    "deepseek": {"base_url": "https://api.deepseek.com/v1", "api_key": "", "default_model": "", "models": [""], "has_vision": False},
                    "google": {"base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "api_key": "", "default_model": "", "models": [""], "has_vision": True},
                    "openrouter": {"base_url": "https://openrouter.ai/api/v1", "api_key": "", "default_model": "", "models": [""], "has_vision": False},
                    "mimo": {"base_url": "https://api.xiaomimimo.com/v1", "api_key": "", "default_model": "", "models": [""], "has_vision": False},
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
        elif self.path == "/api/img-to-json/status":
            self._send_json(200, {"status": _vision_state.get("status", "")})
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/img-to-json/cancel":
            _vision_state["cancelled"] = True
            proc = _vision_state["proc"]
            if proc and proc.poll() is None:
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                except (ProcessLookupError, OSError):
                    pass
            self._send_json(200, {"cancelled": True})
            return
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
            lora_suffix = body.get("loraSuffix", "")
            # ponytail: sanitize to alphanumerics/+/_/- to stay filesystem-safe
            lora_suffix = re.sub(r"[^A-Za-z0-9+_\-]", "", lora_suffix)
            if lora_suffix:
                stem = f"{stem}_{lora_suffix}"
            filename = f"{stem}.{ext}"
            (OUTPUT_DIR / filename).write_bytes(base64.b64decode(b64))

            prompt_json = body.get("promptJson", "")
            if prompt_json:
                (OUTPUT_DIR / f"{filename}.json").write_text(prompt_json)

            meta = body.get("meta")
            if meta:
                (OUTPUT_DIR / f"{filename}.meta.json").write_text(json.dumps(meta))

            self._send_json(200, {"ok": True, "filename": filename})
        elif self.path == "/api/delete-output":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            name = body.get("name", "")
            if not name or "/" in name or "\\" in name or ".." in name:
                self._send_json(400, {"error": "invalid name"})
                return
            deleted = False
            img_p = OUTPUT_DIR / name
            json_p = OUTPUT_DIR / f"{name}.json"
            meta_p = OUTPUT_DIR / f"{name}.meta.json"
            if img_p.exists():
                img_p.unlink()
                deleted = True
            if json_p.exists():
                json_p.unlink()
            if meta_p.exists():
                meta_p.unlink()
                deleted = True
            self._send_json(200, {"ok": deleted})
        elif self.path == "/api/recaption-element":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            image_b64 = body.get("image", "")
            bbox = body.get("bbox", [])
            element_index = body.get("elementIndex", 0)
            existing_json = body.get("existingJson", "")
            instructions = body.get("instructions", "")
            model = body.get("model", "")

            if not image_b64 or len(bbox) != 4 or not model:
                self._send_json(400, {"error": "Missing required fields: image, bbox, model"})
                return

            try:
                header, b64 = image_b64.split(",", 1)
            except ValueError:
                self._send_json(400, {"error": "invalid data URL"})
                return

            try:
                provider, model_name = model.split("::", 1)
            except ValueError:
                self._send_json(400, {"error": "invalid model format, expected provider::model_name"})
                return

            creds = json.loads(CREDENTIALS_PATH.read_text())
            vision = creds.get("vision", {})
            provider_cfg = vision.get(provider) or creds.get(provider, {})
            base_url = provider_cfg.get("base_url", "")
            api_key = provider_cfg.get("api_key", "")
            if not base_url or not api_key:
                self._send_json(400, {"error": f"vision provider '{provider}' not configured"})
                return

            import tempfile as _tf
            import base64 as _b64
            from PIL import Image as _PIL
            sys.path.insert(0, str(IMG_TO_JSON_DIR))
            from utils.bbox_highlight import render_highlight
            from utils.caption_verifier import canonicalize, verify

            img_data = _b64.b64decode(b64)
            ext = "png" if "image/png" in header else "jpg"
            tmp_img = _tf.NamedTemporaryFile(suffix=f".{ext}", delete=False)
            tmp_img.write(img_data)
            tmp_img.close()

            try:
                pil_image = _PIL.open(tmp_img.name)
                highlight_path = render_highlight(pil_image, bbox)
            except Exception as e:
                os.unlink(tmp_img.name)
                self._send_json(400, {"error": f"bbox highlight failed: {str(e)}"})
                return

            try:
                with open(highlight_path, "rb") as f:
                    hl_b64 = _b64.b64encode(f.read()).decode()
                hl_data_url = f"data:image/jpeg;base64,{hl_b64}"

                prompt_path = IMG_TO_JSON_DIR / "prompts" / "element_recaption.txt"
                prompt_template = prompt_path.read_text().strip()

                instructions_block = (
                    f"Additional instructions from the user:\n{instructions}\n"
                    if instructions else ""
                )
                prompt = (
                    prompt_template
                    .replace("{elementIndex}", str(element_index))
                    .replace("{elementBbox}", json.dumps(bbox))
                    .replace("{instructionsBlock}", instructions_block)
                    .replace("{existingJson}", existing_json)
                )

                api_url = f"{base_url.rstrip('/')}/chat/completions"
                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                }
                payload = {
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": prompt},
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": "Return the JSON for the highlighted element."},
                                {"type": "image_url", "image_url": {"url": hl_data_url}},
                            ],
                        },
                    ],
                    "max_tokens": 1024,
                }

                req = Request(api_url, data=json.dumps(payload).encode(), headers=headers, method="POST")
                with urlopen(req, timeout=60) as resp:
                    result = json.loads(resp.read().decode())

                content = result["choices"][0]["message"]["content"]
                parsed = json.loads(content)
                desc = parsed.get("desc", "")
                has_text = parsed.get("has_text", False)
                visible_text = parsed.get("visible_text")

                self._send_json(200, {
                    "desc": desc,
                    "has_text": has_text,
                    "visible_text": visible_text,
                })
            except Exception as e:
                self._send_json(502, {"error": f"Recaption VLM call failed: {str(e)}"})
            finally:
                os.unlink(tmp_img.name)
                if os.path.exists(highlight_path):
                    os.unlink(highlight_path)
        elif self.path == "/api/img-to-json":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            image_b64 = body.get("image", "")
            model = body.get("model", "local")
            local_model = body.get("local_model")
            no_sam = body.get("no_sam", False)
            low_memory = body.get("low_memory", False)
            debug_flag = body.get("debug", False)
            pipeline = body.get("pipeline", "current")
            style_override = body.get("style_override")
            bbox_format = body.get("bbox_format", "xyxy")

            _vision_state["cancelled"] = False
            _vision_state["status"] = ""

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
                tmp_style = None
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
                    if pipeline == "split":
                        cmd.append("--split")
                    cmd.extend(["--bbox-format", bbox_format])
                    if style_override:
                        tmp_style = tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w")
                        tmp_style.write(json.dumps(style_override))
                        tmp_style.close()
                        cmd.extend(["--style-override", tmp_style.name])
                    if local_model:
                        cmd.extend(["--model", local_model])

                    _vlog(f"local: model={local_model} pipeline={pipeline} bbox_format={bbox_format} no_sam={no_sam} low_memory={low_memory} debug={debug_flag}")
                    _vstatus(f"Running local pipeline ({local_model or 'default'})\u2026")

                    try:
                        json_output, verifier_warnings, debug_dir = self._run_pipeline_subprocess(cmd)
                    except _Cancelled:
                        self._send_json(499, {"error": "Cancelled"})
                        return
                    except FileNotFoundError as e:
                        _vlog(f"local: subprocess not found: {e}")
                        self._send_json(500, {"error": "img-to-json pipeline not found"})
                        return
                    except RuntimeError as e:
                        self._send_json(500, {"error": str(e)})
                        return

                    canon, canon_warnings = self._canonicalize_and_verify(json_output)
                    all_warnings = verifier_warnings + canon_warnings
                    _vlog(f"local: ok, elements={len(canon.get('compositional_deconstruction', {}).get('elements', []))} warnings={len(all_warnings)}")

                    response = {"json": canon, "warnings": all_warnings}
                    if debug_dir:
                        response["debug_dir"] = debug_dir
                    self._send_json(200, response)
                except FileNotFoundError as e:
                    _vlog(f"local: subprocess not found: {e}")
                    self._send_json(500, {"error": "img-to-json pipeline not found"})
                finally:
                    os.unlink(tmp.name)
                    if tmp_style:
                        os.unlink(tmp_style.name)
            else:
                try:
                    _vstatus(f"Preparing image for {model}\u2026")
                    if pipeline == "split":
                        self._handle_vision_split(model, image_b64, ext, bbox_format,
                                                  debug_flag=debug_flag, style_override=style_override)
                    else:
                        self._handle_vision_api(model, image_b64, ext, bbox_format)
                except _Cancelled:
                    self._send_json(499, {"error": "Cancelled"})
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
