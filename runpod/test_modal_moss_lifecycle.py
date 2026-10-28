"""Use the installed Modal SDK, but replace process/network/GPU boundaries only."""
import functools
import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest

modal = pytest.importorskip('modal')


def load_app():
    spec = importlib.util.spec_from_file_location('modal_moss_regression', Path(__file__).parent/'modal_app.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_default_deployment_keeps_rapid_permanent_and_baseline_rollback(monkeypatch):
    import moss_config
    for key in ('MOSS_RUNTIME_PROFILE', 'MOSS_ENABLED_PRESETS', 'MOSS_EXPERIMENTAL_PRESETS'):
        monkeypatch.delenv(key, raising=False)
    app = load_app()
    assert app._MOSS_ENV['MOSS_RUNTIME_PROFILE'] == 'rapid-auto-int8-cu128'
    assert app._MOSS_ENV['MOSS_EXPERIMENTAL_PRESETS'] == ''
    assert 'Rapid' in app.MOSS_ENABLED_PRESETS
    assert 'Rapid' in moss_config.advertised_presets(app.MOSS_PROFILE)
    monkeypatch.setenv('MOSS_RUNTIME_PROFILE', 'baseline')
    app = load_app()
    assert app._MOSS_ENV['MOSS_RUNTIME_PROFILE'] == 'baseline'
    assert 'Rapid' not in app.MOSS_ENABLED_PRESETS


def test_remote_configuration_snapshot_options_and_matched_build(monkeypatch):
    for key, value in {'MOSS_RUNTIME_PROFILE':'resident-auto-int8', 'MOSS_RUNTIME_BUILD':'cu130',
                       'MOSS_ENABLED_PRESETS':'Fast', 'MOSS_SNAPSHOT_MODE':'gpu_experimental',
                       'MOSS_MIN_CONTAINERS':'1', 'MOSS_APP_NAME':'moss-review-candidate'}.items():
        monkeypatch.setenv(key, value)
    calls = []
    original = modal.App.cls
    @functools.wraps(original)
    def capture(self, *args, **kwargs):
        calls.append(kwargs)
        return original(self, *args, **kwargs)
    monkeypatch.setattr(modal.App, 'cls', capture)
    m = load_app()
    normal, snapshot = calls[-2:]
    assert normal['min_containers'] == 0
    assert snapshot['min_containers'] == 1
    assert snapshot['enable_memory_snapshot'] is True
    assert snapshot['experimental_options']['enable_gpu_snapshot'] is True
    assert normal['env'] == snapshot['env'] == m._MOSS_ENV
    assert m._MOSS_ENV['MOSS_RUNTIME_PROFILE'] == 'resident-auto-int8'
    assert m._MOSS_ENV['MOSS_ENABLED_PRESETS'] == 'Fast'
    assert m._MOSS_BUILD_ARGS == {'TORCH_SPEC':'torch==2.11.0 torchvision==0.26.0 torchaudio==2.11.0',
                                  'TORCH_INDEX':'https://download.pytorch.org/whl/cu130'}


def test_model_paths_exist_before_popen_and_diagnostics_come_from_child(monkeypatch, tmp_path):
    import os
    import requests
    import moss_assets
    import moss_config
    import runtime_check
    m = load_app()
    events = []
    # Isolate the parent environment; startup deliberately installs its canonical config.
    monkeypatch.setattr(os, 'environ', dict(os.environ))
    pathfile = tmp_path/'moss-extra.yaml'
    userfile = tmp_path/'extra_model_paths.yaml'
    userfile.write_text('user-owned config')
    original = moss_assets.write_extra_model_paths
    def write(dest):
        events.append('paths')
        original(pathfile, models_root=str(tmp_path/'models'))
    monkeypatch.setattr(moss_assets, 'write_extra_model_paths', write)
    monkeypatch.setattr(moss_assets, 'assert_profile_assets', lambda *a: None)
    monkeypatch.setattr(moss_assets, 'assert_loader_visibility', lambda *a: None)
    class Process:
        def poll(self): return None
        def terminate(self): events.append('stop')
        def wait(self, **kw): return 0
    def popen(args, env):
        assert pathfile.exists() and '--extra-model-paths-config' in args
        assert args[args.index('--extra-model-paths-config')+1] == '/tmp/moss-extra-model-paths.yaml'
        assert env['MOSS_RUNTIME_PROFILE'] == 'resident-highvram-int8'
        assert '--highvram' in args
        assert moss_config.resolve_profile()['profile_id'] == env['MOSS_RUNTIME_PROFILE']
        events.append('popen')
        return Process()
    monkeypatch.setattr(m.subprocess, 'Popen', popen)
    child = {'origin':'ComfyUI child', 'torch_version_cuda':'13.0', 'comfy_policy_applied':True,
             'comfy_kitchen_backends':{'cuda':{'available':True,'disabled':False}}, 'cuda_dispatch_probe':{'ok':True}}
    def get(url, **kw):
        events.append('child-runtime' if url.endswith('/moss/runtime') else 'http-ready')
        return SimpleNamespace(status_code=200, raise_for_status=lambda:None, json=lambda:child)
    monkeypatch.setattr(requests, 'get', get)
    # Parent collection must not be used to claim accelerated dispatch.
    monkeypatch.setattr(runtime_check, 'collect', lambda: (_ for _ in ()).throw(AssertionError('parent diagnostic')))
    worker = m.ComfyMoss()
    worker._profile = moss_config.resolve_profile({'MOSS_RUNTIME_PROFILE':'resident-highvram-int8'})
    worker._enabled_presets = ('Fast',)
    worker.startup()
    assert worker.runtime_info is child
    assert worker.runtime_info["runtime_profile"] == "resident-highvram-int8"
    assert events == ['paths','popen','http-ready','child-runtime','http-ready']
    assert userfile.read_text() == 'user-owned config'
    worker.shutdown()


def test_docker_context_includes_every_copied_runtime_file():
    import shlex
    root = Path(__file__).resolve().parent.parent
    ignored = modal.FilePatternMatcher.from_file(root/'.dockerignore')
    for filename in ('Dockerfile','Dockerfile.moss'):
        for line in (root/'runpod'/filename).read_text().splitlines():
            if not line.startswith('COPY '):
                continue
            source = shlex.split(line)[1]
            path = root/source
            assert path.exists(), f'{filename}: missing COPY source {source}'
            assert not ignored(Path(source)), f'{filename}: ignored COPY source {source}'
            if path.is_dir():
                files = [p for p in path.rglob('*') if p.is_file() and p.suffix != '.pyc']
                assert files
                for file in files:
                    assert not ignored(file.relative_to(root)), f'Ignored runtime file: {file}'
    for private in ('.git/config', '.config/llm-credentials.json', 'runpod/test_moss_config.py',
                    'runpod/custom_nodes/moss_runtime/__pycache__/module.pyc', 'node_modules/module.js'):
        assert ignored(Path(private)), f'Unnecessary/private context file included: {private}'


def test_source_overlays_cover_every_dockerfile_copy_target():
    """The cached-image overlay must re-layer EVERY repo file the Dockerfiles
    COPY — otherwise stale copies inside a reused image shadow the new sources
    (plan 2026-10-28 §1). Directory COPYs expand to all included files."""
    import shlex
    root = Path(__file__).resolve().parent.parent
    m = load_app()
    overlays = {name: dict(getattr(m, name)) for name in ('IDEOGRAM_OVERLAY_FILES', 'MOSS_OVERLAY_FILES')}
    ideogram_sources = set(overlays['IDEOGRAM_OVERLAY_FILES'])
    moss_sources = set(overlays['MOSS_OVERLAY_FILES'])
    for filename, covered in (('Dockerfile', ideogram_sources), ('Dockerfile.moss', moss_sources)):
        for line in (root/'runpod'/filename).read_text().splitlines():
            if not line.startswith('COPY '):
                continue
            source = shlex.split(line)[1]
            path = root/source
            if path.is_dir():
                files = {str(p.relative_to(root)) for p in path.rglob('*')
                         if p.is_file() and p.suffix != '.pyc'}
                assert files, f'{filename}: COPY directory {source} expanded to nothing'
                assert files <= covered, f'{filename}: overlay misses directory files: {sorted(files - covered)}'
            else:
                assert source in covered, f'{filename}: overlay misses COPY source {source}'
    # The MOSS runtime custom node must keep its importable package file.
    assert 'runpod/custom_nodes/moss_runtime/__init__.py' in moss_sources


def test_cached_image_ids_drive_from_id_with_full_overlay(monkeypatch):
    """MOSS_CACHED_IMAGE_ID/IDEOGRAM_CACHED_IMAGE_ID switch the worker images to
    Image.from_id + the complete source overlay; unset falls back to the
    Dockerfile builds. Workspace IDs stay out of source defaults."""
    recorded = {'from_id': [], 'dockerfile': []}

    def fake_from_id(image_id):
        recorded['from_id'].append(image_id)
        return modal.Image.debian_slim()

    original_from_dockerfile = modal.Image.from_dockerfile

    def fake_from_dockerfile(dockerfile, **kwargs):
        recorded['dockerfile'].append(dockerfile)
        return original_from_dockerfile(dockerfile, **kwargs)

    monkeypatch.setattr(modal.Image, 'from_id', staticmethod(fake_from_id))
    monkeypatch.setattr(modal.Image, 'from_dockerfile', staticmethod(fake_from_dockerfile))
    monkeypatch.setenv('MOSS_CACHED_IMAGE_ID', 'im-moss-cached')
    monkeypatch.setenv('IDEOGRAM_CACHED_IMAGE_ID', 'im-ideogram-cached')
    m = load_app()
    assert recorded['from_id'] == ['im-ideogram-cached', 'im-moss-cached']
    assert recorded['dockerfile'] == []
    # With no IDs the default is the reproducible full build; never hard-coded.
    monkeypatch.delenv('MOSS_CACHED_IMAGE_ID')
    monkeypatch.delenv('IDEOGRAM_CACHED_IMAGE_ID')
    recorded['from_id'].clear()
    load_app()
    assert recorded['from_id'] == []
    assert set(recorded['dockerfile']) == {'runpod/Dockerfile', 'runpod/Dockerfile.moss'}
