"""Regression cases reproduced in the c5b643a Rapid review."""
import json
import os
from types import SimpleNamespace

import pytest

import handler
import moss_benchmark as bench
import moss_config as config
from moss_benchmark_worker import BenchmarkWorkers
from test_moss_benchmark import _record


@pytest.mark.parametrize('observed, expected', [
    ('HELLO WORLD', 0), ('hello   world', 0), ('HELLO', 6 / 11),
    ('HELLO WORLD EXTRA', 6 / 11), ('HELLO W0RLD', 1 / 11), ('', 1),
])
def test_review_sheet_scores_the_complete_reference(monkeypatch, tmp_path, observed, expected):
    monkeypatch.setattr(bench, '_FIXTURES_BY_ID', {'f': {'expected_text': ['HELLO', 'WORLD']}})
    monkeypatch.setattr(bench, '_ocr_transcriber', lambda: (lambda path: observed, 'review-stub'))
    record = _record('baseline', 'Fast', 'w', 1000, 2000)
    record['image_files'] = ['/not-read-by-stub.png']
    bench.write_review_sheet(tmp_path, [record], ocr=True)
    evidence = json.loads((tmp_path/'ocr.jsonl').read_text())
    assert evidence['expected'] == 'HELLO WORLD'
    assert evidence['observed'] == observed
    assert evidence['cer'] == pytest.approx(expected)


def test_switch_and_steady_timings_have_separate_summary_rows(tmp_path):
    steady = _record('baseline', 'Fast', 'w', 500, 1000)
    switched = _record('baseline', 'Fast', 'w', 500, 9000)
    steady['switched'], switched['switched'] = False, True
    path = tmp_path/'results.jsonl'
    path.write_text(json.dumps(steady)+'\n'+json.dumps(switched)+'\n')
    rows = bench.summarize(path)['rows']
    assert len(rows) == 2
    assert {r['switched']:r['worker_total_ms_median'] for r in rows} == {False:1000, True:9000}
    assert bench.cohort(steady) != bench.cohort(switched)  # also separates the regression guard


@pytest.mark.parametrize('warmup', [False, True])
def test_switch_flags_follow_warmups_as_well_as_measured_jobs(tmp_path, warmup):
    def execute(job, **kwargs):
        return {'status':'completed','result':{'generation':{'runtime_profile':'baseline'},
                'metrics':{'worker_instance_id':'same-server','measurement_complete':True}}}
    bench.run_benchmark(mode='internal', runner=execute, profiles=['baseline'], presets=['Fast','Turbo'],
                        fixture_ids=['poster_en_bold'], seeds=[1], out_dir=tmp_path,
                        warmup=warmup, save_images=False)
    records = [json.loads(line) for line in (tmp_path/'results.jsonl').read_text().splitlines()]
    assert [r['switched'] for r in records] == ([False,False] if warmup else [False,True])
    if warmup:
        warmups = [json.loads(line) for line in (tmp_path/'warmups.jsonl').read_text().splitlines()]
        assert [r['switched'] for r in warmups] == [False,True]


def test_profile_round_trip_rewarms_the_replaced_server(tmp_path):
    profile = None
    epoch = 0
    def execute(job, **kwargs):
        nonlocal profile, epoch
        if profile != job['config']['profile']:
            profile = job['config']['profile']
            epoch += 1
        return {'status':'completed','result':{'generation':{'runtime_profile':profile},
                'metrics':{'worker_instance_id':str(epoch),'measurement_complete':True}}}
    bench.run_benchmark(mode='internal', runner=execute, profiles=['baseline','rapid-auto-int8-cu128'],
                        presets=['Fast'], fixture_ids=['poster_en_bold'], seeds=[1,2],
                        out_dir=tmp_path, save_images=False)
    warmups = [json.loads(line) for line in (tmp_path/'warmups.jsonl').read_text().splitlines()]
    assert len(warmups) == 3  # baseline -> Rapid -> baseline, not the previous two cached warmups
    assert [r['metrics']['worker_instance_id'] for r in warmups] == ['1','2','3']
    assert not any(r['switched'] for r in warmups)  # these are fresh servers, not resident preset changes


def test_actual_worker_startup_gives_each_comfy_server_its_own_identity(monkeypatch):
    pytest.importorskip('modal')
    import requests
    from test_modal_moss_lifecycle import load_app
    monkeypatch.setattr(os, 'environ', dict(os.environ))
    module = load_app()
    children, startups, observations = [], [], []
    class Process:
        def poll(self): return None
        def terminate(self): pass
        def wait(self, **kwargs): return 0
    def popen(args, env):
        children.append(env['MOSS_WORKER_INSTANCE_ID'])
        assert handler._worker_instance_id() == children[-1]
        return Process()
    monkeypatch.setattr(module.subprocess, 'Popen', popen)
    monkeypatch.setattr(requests, 'get', lambda *a, **kw: SimpleNamespace(status_code=200))
    class Worker(module._ComfyWorker):
        def post_ready(self):
            startups.append(self.worker_instance_id)
            self.runtime_info = {'worker_instance_id':self.worker_instance_id}
            assert handler._MOSS_JOBS_IN_WORKER == 0
            assert handler._OBJECT_INFO is None
    def execute(job, **kwargs):
        identity = handler._worker_instance_id()
        observations.append((identity, handler._MOSS_JOBS_IN_WORKER))
        handler._MOSS_JOBS_IN_WORKER += 1
        return {'status':'completed','result':{'generation':{'runtime_profile':job['config']['profile']},
                'metrics':{'worker_instance_id':identity}}}
    monkeypatch.setattr(bench, 'run_internal', execute)
    with BenchmarkWorkers(Worker) as workers:
        for profile in ['baseline','baseline','rapid-auto-int8-cu128','baseline']:
            body = workers({'config':{'profile':profile}})
            assert body['result']['benchmark']['runtime']['worker_instance_id'] == handler._worker_instance_id()
    assert len(set(startups)) == 3 and children == startups
    assert [count for _,count in observations] == [0,1,0,0]
    assert observations[0][0] == observations[1][0]
    assert observations[0][0] != observations[3][0]


@pytest.mark.parametrize('preset,validated,expected', [
    ('Fast', .5, .5), ('Rapid', .5, .5), ('Rapid', 2, 1), ('Rapid', None, 1),
])
def test_advertised_validated_limits_match_request_limits(monkeypatch, preset, validated, expected):
    profile = config.resolve_profile({'MOSS_RUNTIME_PROFILE':'rapid-auto-int8-cu128'})
    profile['status'] = 'validated'
    profile['validated_presets'][preset] = validated
    monkeypatch.setitem(config.RUNTIME_PROFILES, profile['profile_id'], profile)
    caps = config.capabilities(profile, experimental=())
    entry = next(p for p in caps['presets'] if p['id'] == preset)
    assert entry['max_area_mp'] == expected
    env = {'MOSS_RUNTIME_PROFILE':profile['profile_id']}
    config.validate_request_preset(preset, 512, 1024, env)
    if expected == .5:
        with pytest.raises(config.PresetUnsupportedError):
            config.validate_request_preset(preset, 1024, 1024, env)


def test_experimental_recipe_advertises_and_accepts_its_technical_limit(monkeypatch):
    profile = config.resolve_profile({'MOSS_RUNTIME_PROFILE':'rapid-auto-int8-cu128'})
    profile['validated_presets']['Rapid'] = .5
    monkeypatch.setitem(config.RUNTIME_PROFILES, profile['profile_id'], profile)
    caps = config.capabilities(profile, experimental=('Rapid',))
    entry = next(p for p in caps['presets'] if p['id'] == 'Rapid')
    assert entry['validation_status'] == 'experimental' and entry['max_area_mp'] == 1
    config.validate_request_preset('Rapid', 1024, 1024, {
        'MOSS_RUNTIME_PROFILE':profile['profile_id'], 'MOSS_EXPERIMENTAL_PRESETS':'Rapid'})
