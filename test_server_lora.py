"""Tests for the LoRA upload endpoints in server.py — no network, no real
modal/hf calls (subprocess is mocked).

Run: uv run --with pytest --with numpy --with requests pytest test_server_lora.py
"""
import json
import threading
import urllib.request
from pathlib import Path
from unittest import mock
from urllib.parse import urlparse

import pytest

import sys
sys.path.insert(0, str(Path(__file__).parent))
import server

CREDS_BOTH = {
    "modal": {"lora_volume": "ideogram-loras"},
    "huggingface": {"token": "hf_secret_token", "lora_repo": "user/private-loras"},
}


# --- validation + sanitization -------------------------------------------------


def test_validate_rejects_wrong_extension():
    error, name = server._validate_lora_upload("moss", "evil.bin")
    assert error == "only .safetensors files are accepted"
    assert name == ""


def test_validate_rejects_unknown_model():
    error, _ = server._validate_lora_upload("foo", "a.safetensors")
    assert "model must be" in error


def test_sanitize_matches_handler_regex():
    # '#' starts a URL fragment for urlparse — the handler's sanitize behaves
    # the same way; the tail after it is dropped
    _, name = server._validate_lora_upload("ideogram", "my lora #2!.safetensors")
    assert name == "my_lora_"
    _, name = server._validate_lora_upload("ideogram", "my lora v2!.safetensors")
    assert name == "my_lora_v2_.safetensors"
    _, name = server._validate_lora_upload("ideogram", "../../etc/passwd.safetensors")
    assert name == "passwd.safetensors"


def test_targets_require_full_hf_config():
    assert server._lora_upload_targets(CREDS_BOTH) == {"modal": True, "hf": True}
    assert server._lora_upload_targets({"huggingface": {"token": "t"}})["hf"] is False
    assert server._lora_upload_targets({"modal": {}})["modal"] is False


# --- subprocess dispatch (mocked — never touches the network) ------------------


def ok_run(*args, **kwargs):
    return mock.Mock(returncode=0, stderr=b"", stdout=b"")


def test_hf_upload_argv_and_env(tmp_path):
    local = tmp_path / "x.safetensors"
    local.write_bytes(b"x")
    with mock.patch.object(server.subprocess, "run", side_effect=ok_run) as run:
        url = server._hf_lora_upload(CREDS_BOTH, local, "moss", "x.safetensors")
    assert url == "https://huggingface.co/user/private-loras/resolve/main/moss/x.safetensors"
    calls = [c.args[0] for c in run.call_args_list]
    assert calls[0] == ["hf", "repo", "create", "user/private-loras", "--private", "--type", "model"]
    assert calls[1] == ["hf", "upload", "user/private-loras", str(local), "moss/x.safetensors", "--private"]
    for c in run.call_args_list:
        assert isinstance(c.args[0], list)          # never shell=True
        assert c.kwargs.get("env", {}).get("HF_TOKEN") == "hf_secret_token"


def test_hf_upload_failure_scrubs_token(tmp_path):
    local = tmp_path / "x.safetensors"
    local.write_bytes(b"x")

    def failing_run(cmd, **kwargs):
        if cmd[1] == "upload":
            return mock.Mock(returncode=1, stderr=f"boom hf_secret_token".encode())
        return mock.Mock(returncode=0, stderr=b"")

    with mock.patch.object(server.subprocess, "run", side_effect=failing_run):
        with pytest.raises(RuntimeError) as exc:
            server._hf_lora_upload(CREDS_BOTH, local, "moss", "x.safetensors")
    assert "hf_secret_token" not in str(exc.value)
    assert "***" in str(exc.value)


def test_modal_put_argv(tmp_path):
    local = tmp_path / "x.safetensors"
    local.write_bytes(b"x")
    with mock.patch.object(server.subprocess, "run", side_effect=ok_run) as run:
        server._modal_lora_put(CREDS_BOTH, local, "moss", "x.safetensors")
    args, kwargs = run.call_args
    assert args[0] == ["modal", "volume", "put", "--force", "ideogram-loras", str(local), "/moss/x.safetensors"]
    assert not kwargs.get("shell")


# --- HTTP endpoints against a live ThreadingHTTPServer on an ephemeral port ----


@pytest.fixture
def lora_server(tmp_path, monkeypatch):
    creds_path = tmp_path / "creds.json"
    creds_path.write_text(json.dumps(CREDS_BOTH))
    monkeypatch.setattr(server, "CREDENTIALS_PATH", creds_path)
    monkeypatch.setattr(server, "LORA_CACHE_DIR", tmp_path / "loras")
    httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}", tmp_path
    httpd.shutdown()


def get_json(url):
    with urllib.request.urlopen(url) as resp:
        return json.loads(resp.read())


def test_targets_endpoint(lora_server):
    base, _ = lora_server
    assert get_json(base + "/api/lora/targets") == {"modal": True, "hf": True}


def test_upload_endpoint_streams_and_dispatches(lora_server):
    base, tmp = lora_server
    body = b"x" * (2 * 1024 * 1024 + 7)  # forces multiple 1 MB chunks
    req = urllib.request.Request(
        base + "/api/lora/upload?name=my%20lora.safetensors&model=moss",
        data=body, method="POST")
    with mock.patch.object(server.subprocess, "run", side_effect=ok_run) as run:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
    assert result["filename"] == "user/moss/my_lora.safetensors"
    assert result["source_url"] == "https://huggingface.co/user/private-loras/resolve/main/moss/my_lora.safetensors"
    assert result["targets"] == ["modal", "hf"]
    saved = tmp / "loras" / "moss" / "my_lora.safetensors"
    assert saved.read_bytes() == body
    assert run.call_count == 3  # modal put + hf repo create + hf upload


def test_upload_rejects_non_safetensors(lora_server):
    # 1-byte body: the server drains small bodies before closing, so the clean
    # 400 is the expected path; a reset is tolerated only with no side effects.
    base, tmp = lora_server
    req = urllib.request.Request(base + "/api/lora/upload?name=x.bin&model=moss", data=b"x", method="POST")
    try:
        urllib.request.urlopen(req)
        assert False, "expected 400"
    except urllib.error.HTTPError as e:
        assert e.code == 400
        assert ".safetensors" in json.loads(e.read())["error"]
    except ConnectionResetError:
        assert not (tmp / "loras" / "moss" / "x.bin").exists()


def test_upload_rejects_when_no_target(tmp_path, monkeypatch):
    creds_path = tmp_path / "creds.json"
    creds_path.write_text(json.dumps({}))
    monkeypatch.setattr(server, "CREDENTIALS_PATH", creds_path)
    monkeypatch.setattr(server, "LORA_CACHE_DIR", tmp_path / "loras")
    httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    req = urllib.request.Request(base + "/api/lora/upload?name=x.safetensors&model=moss", data=b"x", method="POST")
    try:
        urllib.request.urlopen(req)
        assert False, "expected 400"
    except urllib.error.HTTPError as e:
        assert e.code == 400
        assert "no upload target" in json.loads(e.read())["error"]
    httpd.shutdown()


# --- Truncated uploads / bad Content-Length ------------------------------------


def _raw_post(base, path, headers, body=b""):
    """Raw socket POST that shuts down the write side — lets us lie about
    Content-Length to simulate a mid-upload client disconnect."""
    import socket
    u = urlparse(base)
    sock = socket.create_connection((u.hostname, u.port), timeout=10)
    req = f"POST {path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\n{headers}Connection: close\r\n\r\n"
    sock.sendall(req.encode() + body)
    sock.shutdown(socket.SHUT_WR)
    resp = b""
    while True:
        data = sock.recv(4096)
        if not data:
            break
        resp += data
    sock.close()
    return resp


def test_upload_truncated_body_deleted_and_rejected(lora_server):
    base, tmp = lora_server
    body = b"partial-bytes"
    promised = len(body) + 500  # lie: client promises more than it sends
    with mock.patch.object(server.subprocess, "run") as run:
        resp = _raw_post(base, "/api/lora/upload?name=x.safetensors&model=moss",
                         f"Content-Length: {promised}\r\n", body)
        run.assert_not_called()  # partial files never reach any target
    status_line = resp.split(b"\r\n")[0]
    assert b"400" in status_line
    assert b"upload incomplete" in resp
    assert not (tmp / "loras" / "moss" / "x.safetensors").exists()


def test_upload_missing_content_length_rejected(lora_server):
    base, tmp = lora_server
    resp = _raw_post(base, "/api/lora/upload?name=x.safetensors&model=moss", "", b"")
    assert b"411" in resp.split(b"\r\n")[0]
    assert not (tmp / "loras" / "moss" / "x.safetensors").exists()


def test_upload_zero_content_length_rejected(lora_server):
    base, tmp = lora_server
    resp = _raw_post(base, "/api/lora/upload?name=x.safetensors&model=moss", "Content-Length: 0\r\n", b"")
    assert b"411" in resp.split(b"\r\n")[0]
    assert not any((tmp / "loras").rglob("*.safetensors")) if (tmp / "loras").exists() else True
