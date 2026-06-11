import runpod
from runpod.serverless.utils import rp_upload
import json
import urllib.request
import urllib.parse
import time
import os
import requests
import base64
from io import BytesIO
import websocket
import uuid
import tempfile
import socket
import traceback
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

COMFY_API_AVAILABLE_INTERVAL_MS = int(os.environ.get("COMFY_API_AVAILABLE_INTERVAL_MS", 50))
COMFY_API_AVAILABLE_MAX_RETRIES = int(os.environ.get("COMFY_API_AVAILABLE_MAX_RETRIES", 0))
COMFY_API_FALLBACK_MAX_RETRIES = 500
COMFY_PID_FILE = "/tmp/comfyui.pid"
WEBSOCKET_RECONNECT_ATTEMPTS = int(os.environ.get("WEBSOCKET_RECONNECT_ATTEMPTS", 5))
WEBSOCKET_RECONNECT_DELAY_S = int(os.environ.get("WEBSOCKET_RECONNECT_DELAY_S", 3))

if os.environ.get("WEBSOCKET_TRACE", "false").lower() == "true":
    websocket.enableTrace(True)

COMFY_HOST = "127.0.0.1:8188"
REFRESH_WORKER = os.environ.get("REFRESH_WORKER", "false").lower() == "true"

WORKFLOW_TEMPLATE_PATH = "/workflow_template.json"

with open(WORKFLOW_TEMPLATE_PATH) as f:
    WORKFLOW_TEMPLATE = json.load(f)


def _get_comfyui_pid():
    try:
        with open(COMFY_PID_FILE, "r") as f:
            return int(f.read().strip())
    except (FileNotFoundError, ValueError):
        return None


def _is_comfyui_process_alive():
    pid = _get_comfyui_pid()
    if pid is None:
        return None
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def check_server(url, retries=0, delay=50):
    delay = max(1, delay)
    log_every = max(1, int(10_000 / delay))
    attempt = 0

    while True:
        process_status = _is_comfyui_process_alive()
        if process_status is False:
            return False

        try:
            response = requests.get(url, timeout=5)
            if response.status_code == 200:
                return True
        except requests.Timeout:
            pass
        except requests.RequestException:
            pass

        attempt += 1
        fallback = retries if retries > 0 else COMFY_API_FALLBACK_MAX_RETRIES
        if process_status is None and attempt >= fallback:
            return False

        if attempt % log_every == 0:
            elapsed_s = (attempt * delay) / 1000
            print(f"worker-ideogram4 - Still waiting for API server... ({elapsed_s:.0f}s elapsed, attempt {attempt})")

        time.sleep(delay / 1000)


def queue_workflow(workflow, client_id):
    payload = {"prompt": workflow, "client_id": client_id}
    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    response = requests.post(f"http://{COMFY_HOST}/prompt", data=data, headers=headers, timeout=30)

    if response.status_code == 400:
        try:
            error_data = response.json()
            raise ValueError(f"Workflow validation failed: {error_data}")
        except json.JSONDecodeError:
            raise ValueError(f"ComfyUI validation failed: {response.text}")

    response.raise_for_status()
    return response.json()


def get_history(prompt_id):
    response = requests.get(f"http://{COMFY_HOST}/history/{prompt_id}", timeout=30)
    response.raise_for_status()
    return response.json()


def get_image_data(filename, subfolder, image_type):
    data = {"filename": filename, "subfolder": subfolder, "type": image_type}
    url_values = urllib.parse.urlencode(data)
    try:
        response = requests.get(f"http://{COMFY_HOST}/view?{url_values}", timeout=60)
        response.raise_for_status()
        return response.content
    except requests.Timeout:
        return None
    except requests.RequestException:
        return None


def build_workflow(import_json, width, height, steps=None, seed=None):
    wf = json.loads(json.dumps(WORKFLOW_TEMPLATE))

    wf["160"]["inputs"]["width"] = width
    wf["160"]["inputs"]["height"] = height
    wf["185"]["inputs"]["width"] = width
    wf["185"]["inputs"]["height"] = height
    wf["185"]["inputs"]["import_json"] = import_json

    if steps is not None:
        wf["190"]["inputs"]["steps"] = steps
    if seed is not None and seed >= 0:
        wf["197"]["inputs"]["seed"] = seed

    return wf


def handler(job):
    job_input = job["input"]
    job_id = job["id"]

    import_json = job_input.get("import_json")
    if import_json is None:
        return {"error": "Missing 'import_json' parameter"}
    if isinstance(import_json, (dict, list)):
        import_json = json.dumps(import_json)

    width = job_input.get("width", 1024)
    height = job_input.get("height", 1024)
    steps = job_input.get("steps")
    seed = job_input.get("seed")

    if not isinstance(width, int) or not isinstance(height, int):
        return {"error": "'width' and 'height' must be integers"}
    if width <= 0 or height <= 0:
        return {"error": "'width' and 'height' must be positive integers"}

    if not check_server(f"http://{COMFY_HOST}/", COMFY_API_AVAILABLE_MAX_RETRIES, COMFY_API_AVAILABLE_INTERVAL_MS):
        return {"error": f"ComfyUI server ({COMFY_HOST}) not reachable after multiple retries."}

    workflow = build_workflow(import_json, width, height, steps=steps, seed=seed)

    ws = None
    client_id = str(uuid.uuid4())
    prompt_id = None
    output_data = []
    errors = []

    try:
        ws_url = f"ws://{COMFY_HOST}/ws?clientId={client_id}"
        ws = websocket.WebSocket()
        ws.connect(ws_url, timeout=10)

        queued = queue_workflow(workflow, client_id)
        prompt_id = queued.get("prompt_id")
        if not prompt_id:
            raise ValueError(f"Missing 'prompt_id' in queue response: {queued}")

        print(f"worker-ideogram4 - Queued workflow with ID: {prompt_id}")

        execution_done = False
        while True:
            try:
                out = ws.recv()
                if isinstance(out, str):
                    message = json.loads(out)
                    if message.get("type") == "executing":
                        data = message.get("data", {})
                        if data.get("node") is None and data.get("prompt_id") == prompt_id:
                            execution_done = True
                            break
                    elif message.get("type") == "execution_error":
                        data = message.get("data", {})
                        if data.get("prompt_id") == prompt_id:
                            errors.append(f"Execution error: Node {data.get('node_id')} - {data.get('exception_message')}")
                            break
            except websocket.WebSocketTimeoutException:
                continue
            except websocket.WebSocketConnectionClosedException as e:
                print(f"worker-ideogram4 - WebSocket disconnected, attempting reconnect...")
                try:
                    new_ws = websocket.WebSocket()
                    new_ws.connect(ws_url, timeout=10)
                    ws = new_ws
                    continue
                except Exception as reconnect_err:
                    raise e

        if not execution_done and not errors:
            raise ValueError("Workflow execution did not complete")

        history = get_history(prompt_id)
        if prompt_id not in history:
            return {"error": f"Prompt ID {prompt_id} not found in history"}

        outputs = history[prompt_id].get("outputs", {})
        for node_id, node_output in outputs.items():
            if "images" in node_output:
                for image_info in node_output["images"]:
                    filename = image_info.get("filename")
                    subfolder = image_info.get("subfolder", "")
                    img_type = image_info.get("type")

                    if img_type == "temp":
                        continue
                    if not filename:
                        continue

                    image_bytes = get_image_data(filename, subfolder, img_type)
                    if not image_bytes:
                        errors.append(f"Failed to fetch image data for {filename}")
                        continue

                    file_extension = os.path.splitext(filename)[1] or ".png"

                    if os.environ.get("BUCKET_ENDPOINT_URL"):
                        with tempfile.NamedTemporaryFile(suffix=file_extension, delete=False) as temp_file:
                            temp_file.write(image_bytes)
                            temp_path = temp_file.name
                        try:
                            s3_url = rp_upload.upload_image(job_id, temp_path)
                            output_data.append({"filename": filename, "type": "s3_url", "data": s3_url})
                        except Exception as e:
                            errors.append(f"S3 upload error: {e}")
                        finally:
                            if os.path.exists(temp_path):
                                os.remove(temp_path)
                    else:
                        base64_image = base64.b64encode(image_bytes).decode("utf-8")
                        output_data.append({"filename": filename, "type": "base64", "data": base64_image})

    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        print(f"worker-ideogram4 - Error: {e}")
        traceback.print_exc()
        return {"error": f"An unexpected error occurred: {e}"}
    finally:
        if ws and ws.connected:
            ws.close()

    if not output_data:
        return {"error": "No images generated", "details": errors}

    result = {"images": output_data}
    if errors:
        result["errors"] = errors

    return result


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
