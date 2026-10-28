"""Preview sizing, cache invalidation, and the local HTTP endpoint."""
import io
import threading
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

import pytest
from PIL import Image

import server
from gallery_thumbnails import gallery_thumbnail, _render_thumbnail


@pytest.fixture
def image_dir(tmp_path):
    Image.new("RGB", (1600, 1000), "red").save(tmp_path / "my image.png")
    _render_thumbnail.cache_clear()
    return tmp_path


def test_preview_is_small_webp_and_preserves_original(image_dir):
    original = (image_dir / "my image.png").read_bytes()
    preview = gallery_thumbnail(image_dir, "my image.png")
    with Image.open(io.BytesIO(preview)) as image:
        assert image.format == "WEBP"
        assert image.size == (320, 320)
    assert len(preview) < len(original)
    assert (image_dir / "my image.png").read_bytes() == original


def test_reuses_cached_preview_and_invalidates_on_image_change(image_dir):
    first = gallery_thumbnail(image_dir, "my image.png")
    assert gallery_thumbnail(image_dir, "my image.png") is first
    assert _render_thumbnail.cache_info().hits == 1
    Image.new("RGB", (500, 500), "blue").save(image_dir / "my image.png")
    assert gallery_thumbnail(image_dir, "my image.png") != first


@pytest.mark.parametrize("name", ["", "../outside.png", "/tmp/image.png", "..\\outside.png", "data.json"])
def test_rejects_invalid_names(image_dir, name):
    with pytest.raises(ValueError):
        gallery_thumbnail(image_dir, name)


def test_rejects_symlink_outside_output(image_dir, tmp_path):
    other = tmp_path.parent / (tmp_path.name + ".png")
    try:
        Image.new("RGB", (10, 10)).save(other)
        (image_dir / "link.png").symlink_to(other)
        with pytest.raises(ValueError):
            gallery_thumbnail(image_dir, "link.png")
    finally:
        other.unlink(missing_ok=True)


@pytest.fixture
def thumbnail_server(image_dir):
    with mock.patch.object(server, "OUTPUT_DIR", image_dir):
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        yield f"http://127.0.0.1:{httpd.server_port}"
        httpd.shutdown()
        httpd.server_close()
        thread.join()


def test_http_preview_and_cache_header(thumbnail_server):
    with urllib.request.urlopen(thumbnail_server + "/api/thumbnail?name=my%20image.png&v=1") as response:
        assert response.headers["Content-Type"] == "image/webp"
        assert response.headers["Cache-Control"] == "private, max-age=3600"
        assert len(response.read()) == int(response.headers["Content-Length"])


def test_http_missing_preview_returns_404(thumbnail_server):
    with pytest.raises(urllib.error.HTTPError) as error:
        urllib.request.urlopen(thumbnail_server + "/api/thumbnail?name=missing.png")
    assert error.value.code == 404
    assert error.value.headers["Cache-Control"] == "no-store, must-revalidate"
