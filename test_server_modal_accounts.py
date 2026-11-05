"""Modal account discovery, switching and usage helpers in server.py.

Run: uv run --with pytest --with numpy --with pillow --with requests pytest test_server_modal_accounts.py
"""
import json
import threading
import urllib.request
from pathlib import Path
from unittest import mock

import pytest

import server

BASE = "https://yofarcorp--ideogram-builder-web-app.us-east.modal.run/generate"


def _profiles(home: Path) -> None:
    # Same layout used in practice: the standard file plus renamed per-account copies.
    (home / ".modal.toml").write_text(
        '[yoannfaraus]\ntoken_id = "ak-2"\ntoken_secret = "as-2"\nactive = true\n'
    )
    (home / ".modal-yofardev.toml").write_text(
        '[yofardev]\ntoken_id = "ak-1"\ntoken_secret = "as-1"\nactive = true\n'
    )
    (home / ".modal-yofarcorp.toml").write_text(
        '[yofarcorp]\ntoken_id = "ak-3"\ntoken_secret = "as-3"\nactive = true\n'
    )


def _creds() -> dict:
    return {"modal": {"endpoint_url": BASE, "auth_token": "shared", "lora_volume": "ideogram-loras"}}


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    _profiles(tmp_path)
    return tmp_path


def test_discovers_profiles_and_derives_their_endpoints(home):
    effective, accounts = server._modal_settings(_creds())

    assert effective["active"] == "yofarcorp"
    assert set(accounts) == {"yofarcorp", "yofardev", "yoannfaraus"}
    assert accounts["yofardev"]["endpoint_url"].startswith("https://yofardev--ideogram-builder-web-app")
    assert accounts["yofardev"]["token_id"] == "ak-1"
    assert accounts["yoannfaraus"]["token_secret"] == "as-2"
    assert effective["endpoint_url"] == BASE
    assert effective["auth_token"] == "shared"


def test_switch_persists_active_and_materializes_accounts(home, monkeypatch):
    creds_path = home / "creds.json"
    creds_path.write_text(json.dumps(_creds()))
    monkeypatch.setattr(server, "CREDENTIALS_PATH", creds_path)

    server._set_modal_account(json.loads(creds_path.read_text()), "yofardev")

    saved = json.loads(creds_path.read_text())
    assert saved["modal"]["active"] == "yofardev"
    assert saved["modal"]["endpoint_url"].startswith("https://yofardev--")
    assert "yofarcorp" in saved["modal"]["accounts"]
    effective, _ = server._modal_settings(saved)
    assert effective["active"] == "yofardev"
    assert effective["endpoint_url"].startswith("https://yofardev--")


def test_public_config_never_exposes_cli_tokens(home):
    public = server._modal_public_config(server._modal_settings(_creds())[0])
    assert public["active"] == "yofarcorp"
    assert set(public["accounts"]) == {"yofarcorp", "yofardev", "yoannfaraus"}
    assert "token_id" not in public and "token_secret" not in public


def test_usage_parses_summary_and_computes_remaining(home, monkeypatch):
    server._modal_usage_cache.clear()
    creds = _creds()
    creds["modal"].update({"token_id": "ak-3", "token_secret": "as-3"})
    run = mock.Mock(return_value=mock.Mock(
        returncode=0, stdout='{"metered_cost":"12.5","billed_cost":"0.5"}', stderr=""))
    monkeypatch.setattr(server.subprocess, "run", run)

    usage = server._modal_usage(creds, "yofarcorp")

    assert usage == {
        "account": "yofarcorp",
        "metered_cost": 12.5,
        "billed_cost": 0.5,
        "monthly_credits": 30.0,
        "remaining": 17.5,
    }
    env = run.call_args.kwargs["env"]
    assert env["MODAL_TOKEN_ID"] == "ak-3"
    assert env["MODAL_TOKEN_SECRET"] == "as-3"


@pytest.fixture
def account_server(home, monkeypatch):
    creds_path = home / "creds.json"
    creds_path.write_text(json.dumps(_creds()))
    monkeypatch.setattr(server, "CREDENTIALS_PATH", creds_path)
    monkeypatch.setattr(server.subprocess, "run", mock.Mock(return_value=mock.Mock(returncode=0)))
    httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def _json(url, data=None):
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def test_http_switch_updates_effective_config(account_server):
    config = _json(account_server + "/api/config")
    assert config["modal"]["active"] == "yofarcorp"
    assert set(config["modal"]["accounts"]) == {"yofarcorp", "yofardev", "yoannfaraus"}

    switched = _json(account_server + "/api/modal/active", {"name": "yofardev"})
    assert switched["active"] == "yofardev"
    assert switched["endpoint_url"].startswith("https://yofardev--")

    after = _json(account_server + "/api/config")
    assert after["modal"]["active"] == "yofardev"
    assert after["modal"]["endpoint_url"] == switched["endpoint_url"]
    assert "token_id" not in after["modal"]
