"""Regression coverage for review R01–R16, including actual lifecycle boundaries."""
import copy
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

import comfy_metrics
import handler
import moss_assets
import moss_benchmark as bench
import moss_cache
import moss_config as config
import moss_workflow
import runtime_check
from moss_benchmark_worker import BenchmarkWorkers


def test_all_explicit_profile_identities_and_warm_variants_survive_resolution():
    for pid, profile in config.RUNTIME_PROFILES.items():
        assert config.resolve_profile({'MOSS_RUNTIME_PROFILE': pid}) == profile
        warmed = config.resolve_profile({'MOSS_RUNTIME_PROFILE': pid, 'MOSS_WARMUP': 'true'})
        assert warmed['warmup'] is True
        assert warmed['profile_id'] == pid.removesuffix('-warm') + '-warm'
    runtime_check.enforce_profile_requirements(config.resolve_profile({}), {'torch_version_cuda': '12.6'})


@pytest.mark.parametrize('state', [None, 'enabled', True, {'available': False, 'disabled': False},
                                   {'available': True, 'disabled': True}, {'available': True}])
def test_backend_detection_fails_closed_for_real_registry_failures(state):
    assert runtime_check.accelerated_backend_enabled({'comfy_kitchen_backends': {'cuda': state}})[0] is False


def test_cuda_gate_requires_child_policy_and_successful_dispatch():
    profile = config.resolve_profile({'MOSS_RUNTIME_PROFILE': 'resident-auto-int8'})
    info = {'torch_version_cuda': '13.0', 'comfy_kitchen_backends': {'cuda': {'available': True, 'disabled': False}},
            'cuda_dispatch_probe': {'ok': True}, 'comfy_policy_applied': True}
    runtime_check.enforce_profile_requirements(profile, info)
    for change in ({'comfy_policy_applied': False}, {'cuda_dispatch_probe': {'ok': False}}):
        with pytest.raises(RuntimeError):
            runtime_check.enforce_profile_requirements(profile, {**info, **change})


def test_real_serial_trace_without_core_executed_events():
    now = [10.0]
    c = comfy_metrics.MetricsCollector(prompt_id='p', clock=lambda: now[0], worker_started=5,
                                       node_stage_map=moss_workflow.STAGE_BY_NODE)
    c.mark_queued()
    def event(kind, **data):
        c.on_ws_message({'type': kind, 'data': {'prompt_id': 'p', **data}})
    event('execution_start')
    event('execution_cached', nodes=['8'])
    for node, duration in [('7', 2), ('10', 4), ('11', 1), ('12', .5)]:
        event('executing', node=node)
        now[0] += duration
    event('executed', node='12')  # SaveImage alone has UI output.
    event('executing', node=None)
    result = c.to_dict()
    assert result['measurement_complete'] is True
    assert result['observed_node_wall_ms'] == {'text_encode_positive': 2000, 'sampler': 4000, 'vae_decode': 1000, 'save_image': 500}
    assert result['worker_total_ms'] == 12500  # includes pre-queue preparation
    assert result['cached_node_ids'] == ['8']


def test_capability_allowlist_and_independent_resolution_promotion(monkeypatch):
    profile = config.resolve_profile({'MOSS_RUNTIME_PROFILE': 'resident-highvram-int8-adapters'})
    profile['status'] = 'validated'
    profile['validated_presets']['Rapid'] = 1
    caps = config.capabilities(profile, enabled=('Fast', 'Rapid'))
    assert [p['id'] for p in caps['presets']] == ['Fast', 'Rapid']
    assert caps['presets'][1]['validation_status'] == 'validated'
    assert caps['presets'][1]['max_area_mp'] == 1  # technical limit binds even when validated
    monkeypatch.setitem(config.RUNTIME_PROFILES, profile['profile_id'], profile)
    with pytest.raises(config.PresetUnsupportedError, match='supports up to 1 MP'):
        config.validate_request_preset('Rapid', 1536, 1024, {'MOSS_RUNTIME_PROFILE': profile['profile_id']})
    assert config.capabilities(config.resolve_profile({}), enabled=('Fast',))['presets'][0]['id'] == 'Fast'
    assert len(config.capabilities(config.resolve_profile({}), enabled=('Fast',))['presets']) == 1


def test_bf16_and_merged_fp32_reference_graphs_have_correct_loaders():
    template = json.loads((Path(__file__).parent / 'workflow_template_moss.json').read_text())
    for pid, dit, adapter in [('bf16-adapters', 'dit_bf16', 'adapter_rapid4'),
                               ('rapid-fp32-reference', 'dit_rapid4_fp32', None)]:
        # Reference profiles are measured in benchmark mode: Rapid is a
        # technical candidate there, not an advertised recipe.
        profile, preset, steps = config.validate_request_preset(
            'Rapid', 1024, 1024, {'MOSS_RUNTIME_PROFILE': pid, 'MOSS_BENCHMARK_MODE': 'true'})
        needed = moss_assets.required_asset_keys(profile, ['Rapid'])
        assert dit in needed
        assert ('adapter_rapid4' in needed) == bool(adapter)
        assets = {'dit': moss_assets.asset(dit)['workflow_ref'], 'encoder': 'enc', 'vae': 'vae'}
        wf, info = moss_workflow.build_moss_workflow(template, preset_name='Rapid', preset=preset,
                    prompt='p', negative='', width=1024, height=1024, seed=1, loras=[],
                    profile=profile, assets=assets, adapter_ref=moss_assets.asset(adapter)['workflow_ref'] if adapter else None)
        assert wf['1']['inputs']['unet_name'] == assets['dit']
        assert ('4' in wf) == bool(adapter)
        assert info['effective_steps'] == steps
    entry = moss_assets.asset('dit_rapid4_fp32')
    assert entry['role'] == 'diffusion_model' and '/diffusion_models/' in entry['container_path']


def test_cache_compatibility_and_immutable_concurrent_publication(tmp_path):
    profile = config.resolve_profile({'MOSS_RUNTIME_PROFILE': 'compile-inductor-resident-int8'})
    runtime = {'gpu_capability': '12.0', 'torch': '2.11', 'triton': '3.6', 'comfyui_revision': 'abc'}
    args = (profile, runtime, {'manifest_id': 'm'}, {'lock_id': 'l'})
    kwargs = {'shared_root': tmp_path / 'shared', 'local_root': tmp_path / 'local'}
    first, concurrent = moss_cache.prepare(*args, **kwargs), moss_cache.prepare(*args, **kwargs)
    assert first['namespace'] == concurrent['namespace']
    assert first['env'] != concurrent['env']
    (Path(first['local']) / 'inductor').mkdir()
    (Path(first['local']) / 'inductor' / 'kernel').write_text('complete kernel')
    moss_cache.publish(first)
    reused = moss_cache.prepare(*args, **kwargs)
    assert (Path(reused['local']) / 'inductor' / 'kernel').read_text() == 'complete kernel'
    assert not (Path(concurrent['local']) / 'inductor' / 'kernel').exists()
    for p, r, m, lock in [(dict(profile, compile_backend='cudagraphs'), runtime, args[2], args[3]),
                           (profile, dict(runtime, torch='other'), args[2], args[3]),
                           (profile, runtime, {'manifest_id':'other'}, args[3])]:
        assert moss_cache.namespace(p, r, m, lock) != first['namespace']


def test_benchmark_starts_real_lifecycle_before_handler_and_switches_profiles(monkeypatch):
    events = []
    saved_profile = os.environ.get('MOSS_RUNTIME_PROFILE')
    class Worker:
        runtime_info = {'origin': 'child'}
        def startup(self):
            events.append(('ready', self._profile['profile_id']))
            assert config.resolve_profile()['profile_id'] == self._profile['profile_id']
        def shutdown(self):
            events.append(('stop', self._profile['profile_id']))
    def execute(job, timeout_s):
        pid = config.resolve_profile()['profile_id']
        assert events[-1] == ('ready', pid)
        assert handler._MOSS_JOBS_IN_WORKER == 0
        events.append(('handler', pid))
        return {'status': 'completed', 'result': {'generation': {'runtime_profile': pid}}}
    monkeypatch.setattr(bench, 'run_internal', execute)
    with BenchmarkWorkers(Worker) as workers:
        for pid in ['baseline', 'resident-highvram-int8']:
            body = workers({'config': {'profile': pid}})
            assert body['result']['benchmark']['runtime'] == {'origin': 'child'}
    assert events == [('ready','baseline'), ('handler','baseline'), ('stop','baseline'),
                      ('ready','resident-highvram-int8'), ('handler','resident-highvram-int8'), ('stop','resident-highvram-int8')]
    assert os.environ.get('MOSS_RUNTIME_PROFILE') == saved_profile


def test_benchmark_checks_executed_profile_and_never_dumps_client_runtime(tmp_path):
    result = bench.run_benchmark(mode='internal', runner=lambda *a, **kw: {'status':'completed', 'result':{
        'generation':{'runtime_profile':'baseline'}}}, profiles=['resident-highvram-int8'],
        fixture_ids=['poster_en_bold'], seeds=[1], warmup=False, out_dir=tmp_path)
    row = json.loads((tmp_path/'results.jsonl').read_text())
    assert row['status'] == 'failed' and 'Profile mismatch' in row['error']
    assert list((tmp_path/'runtime').iterdir()) == []
    assert result['rows'][0]['valid_timings'] == 0


def test_http_multiple_profiles_require_separate_deployments(tmp_path):
    with pytest.raises(ValueError, match='profile-to-endpoint'):
        bench.run_benchmark(endpoint='https://example.invalid', profiles=['baseline','resident-auto-int8'], out_dir=tmp_path)


def test_cached_matrix_groups_multiple_prompts_and_new_prompt_cache_keys_differ():
    fixtures = bench.load_fixtures(ids=['poster_en_bold','poster_zh_vertical'])
    configs = [{'profile':'baseline', 'preset':'Fast'}]
    jobs = bench.build_jobs(fixtures, [1,2,3], configs, cached_prompt=True)
    assert [j['fixture_id'] for j in jobs] == ['poster_en_bold']*3 + ['poster_zh_vertical']*3
    assert bench._payload(jobs[0])['import_json'] == bench._payload(jobs[1])['import_json']
    fresh = bench.build_jobs(fixtures[:1], [1,2], configs)
    a,b = [bench._payload(j)['import_json'] for j in fresh]
    assert a != b and json.loads(a) == json.loads(b)
    assert bench.cache_state({'node_stage_map':{'7':'text_encode_positive','8':'text_encode_negative'}, 'cached_node_ids':['7','8']}) == 'cached'


def test_summary_keeps_failed_partial_cold_and_different_workloads_separate(tmp_path):
    from test_moss_benchmark import _record
    base = _record('baseline','Fast','w',1000,2000)
    records = [base, dict(base, status='failed', metrics={**base['metrics'],'worker_total_ms':99999}),
               dict(base, metrics={**base['metrics'],'measurement_complete':False,'worker_total_ms':88888}),
               dict(base, width=2048), dict(base, generation={'first_generation_in_worker':True})]
    path = tmp_path/'results.jsonl'
    path.write_text('\n'.join(json.dumps(r) for r in records))
    result = bench.summarize(path)
    assert len(result['rows']) == 3
    warm = next(r for r in result['rows'] if r['width']==1024 and not r['cold'])
    assert warm['n'] == 3 and warm['valid_timings'] == 1 and warm['worker_total_ms_median'] == 2000


def test_full_slg_control_is_benchmark_only_and_differs_only_in_slg():
    with pytest.raises(config.PresetUnsupportedError):
        config.validate_request_preset('FastFullSLG',1024,1024,{})
    _, control, _ = config.validate_request_preset('FastFullSLG',1024,1024,{'MOSS_BENCHMARK_MODE':'true'})
    assert control == {**config.MOSS_PRESETS['Fast'], 'slg': (0,1), 'label':'Fast full SLG control'}
    assert 'FastFullSLG' not in config.advertised_presets(config.resolve_profile({}))


def test_worker_requires_native_loaders_to_list_volume_assets(monkeypatch):
    profile = config.resolve_profile({'MOSS_RUNTIME_PROFILE':'bf16-adapters'})
    monkeypatch.setattr(moss_assets, 'resolve_profile_assets', lambda p: {'dit':'volume-bf16.safetensors','encoder':'enc','vae':'vae'})
    monkeypatch.setattr(moss_assets, 'resolve_adapter', lambda a: ('local','moss/control/rapid.safetensors'))
    info = {node:{'input':{'required':{field:[choices]}}} for node,field,choices in [
        ('UNETLoader','unet_name',['volume-bf16.safetensors']), ('CLIPLoader','clip_name',['enc']),
        ('VAELoader','vae_name',['vae']), ('LoraLoaderModelOnly','lora_name',['moss/control/rapid.safetensors'])]}
    moss_assets.assert_loader_visibility(profile, ['Rapid'], info)
    info['UNETLoader']['input']['required']['unet_name'][0] = []
    with pytest.raises(moss_assets.AssetError, match='cannot see'):
        moss_assets.assert_loader_visibility(profile, ['Rapid'], info)


def test_benchmark_warms_each_configuration_and_prompt(tmp_path):
    calls = []
    def execute(job, **kwargs):
        calls.append(job)
        return {'status':'completed','result':{'generation':{'runtime_profile':job['config']['profile']}}}
    bench.run_benchmark(mode='internal', runner=execute, presets=['Fast','Turbo'],
                         fixture_ids=['poster_en_bold','poster_zh_vertical'], seeds=[1,2],
                         cached_prompt=True, out_dir=tmp_path, save_images=False)
    assert len(calls) == 12  # four per-prompt/config warmups + eight measured
    for offset in range(0,12,3):
        assert calls[offset]['seed'] == 3
        assert [j['seed'] for j in calls[offset+1:offset+3]] == [1,2]
        assert len({j['fixture_id'] for j in calls[offset:offset+3]}) == 1


def test_explicit_resolution_and_lora_requests_are_recorded(tmp_path):
    loras = [{'filename':'user/test.safetensors','strengths':{'positive':0.7}}]
    calls = []
    def execute(job, **kwargs):
        calls.append(bench._payload(job))
        return {'status':'completed','result':{'generation':{'runtime_profile':'baseline'}}}
    bench.run_benchmark(mode='internal', runner=execute, fixture_ids=['poster_en_bold'], seeds=[1],
                         loras=loras, width=2048, height=2048, warmup=False, out_dir=tmp_path, save_images=False)
    assert calls[0]['width'] == 2048 and calls[0]['loras'] == loras
    assert json.loads((tmp_path/'results.jsonl').read_text())['loras'] == loras


def test_memory_sampling_is_device_wide_and_missing_nvml_does_not_break_run(monkeypatch):
    from moss_memory import MemorySampler
    monkeypatch.setattr('subprocess.check_output', lambda *a, **kw: 'GPU-test, 1200\n')
    sampler = MemorySampler()
    sampler.sample()
    assert sampler.result()['sampled_device_peak_mib'] == {'GPU-test':1200}
    monkeypatch.setattr('subprocess.check_output', lambda *a, **kw: (_ for _ in ()).throw(FileNotFoundError('not installed')))
    sampler.sample()
    assert sampler.result()['error']


def test_handler_oom_wrapped_in_http_completion_keeps_original_failure(tmp_path):
    bench.run_benchmark(mode='internal', runner=lambda *a, **kw: {'status':'completed', 'result':{'error':'CUDA out of memory'}},
                         fixture_ids=['poster_en_bold'], seeds=[1], warmup=False, out_dir=tmp_path)
    record = json.loads((tmp_path/'results.jsonl').read_text())
    assert record['status'] == 'failed' and record['error'] == 'CUDA out of memory'


def test_internal_latency_excludes_synchronous_memory_probe_overhead(monkeypatch):
    import moss_memory
    now = [0.0]
    monkeypatch.setattr(os, 'environ', {'MOSS_RUNTIME_PROFILE':'baseline'})
    monkeypatch.setattr(bench.time, 'monotonic', lambda: now[0])
    class Sampler:
        def __enter__(self): now[0] += 10; return self
        def __exit__(self, *args): now[0] += 10
        def result(self): return {}
    def generate(job):
        now[0] += 3
        return {'generation':{'runtime_profile':'baseline'}}
    monkeypatch.setattr(moss_memory, 'MemorySampler', Sampler)
    monkeypatch.setattr(handler, 'handler', generate)
    job = bench.build_jobs(bench.load_fixtures(ids=['poster_en_bold']), [1], [{'profile':'baseline','preset':'Fast'}])[0]
    assert bench.run_internal(job)['latency_ms'] == 3000
