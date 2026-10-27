"""One real ComfyUI process per benchmark profile; always restore caller env."""
import os
import time

import moss_config


class BenchmarkWorkers:
    def __init__(self, worker_factory):
        self.worker_factory = worker_factory
        self.worker = None
        self.profile_id = None

    def __enter__(self):
        self.saved = dict(os.environ)
        return self

    def _stop(self):
        if self.worker is not None:
            worker, self.worker = self.worker, None
            worker.shutdown()

    def __exit__(self, *exc):
        try:
            self._stop()
        finally:
            os.environ.clear()
            os.environ.update(self.saved)

    def __call__(self, job, timeout_s=900):
        from moss_benchmark import run_internal
        import handler

        started = time.monotonic()
        requested = job['config']['profile']
        if requested != self.profile_id:
            self._stop()
            profile = moss_config.resolve_profile({'MOSS_RUNTIME_PROFILE': requested})
            for var in (*moss_config.PROFILE_ENV_FIELDS, 'MOSS_WARMUP'):
                os.environ.pop(var, None)
            os.environ.update(MOSS_RUNTIME_PROFILE=requested,
                              MOSS_ENABLED_PRESETS=','.join(profile['enabled_presets'] + (moss_config.BENCHMARK_PRESET_IDS if 'Fast' in profile['enabled_presets'] else ())),
                              MOSS_METRICS='on', MOSS_BENCHMARK_MODE='true')
            handler._MOSS_JOBS_IN_WORKER = 0
            handler._OBJECT_INFO = None
            self.worker = self.worker_factory()
            self.worker._profile = profile
            self.worker._enabled_presets = profile['enabled_presets'] + (moss_config.BENCHMARK_PRESET_IDS if 'Fast' in profile['enabled_presets'] else ())
            self.worker.startup()
            self.profile_id = requested
        remaining = timeout_s - (time.monotonic() - started)
        if remaining <= 0:
            raise TimeoutError("benchmark budget exhausted during worker startup")
        body = run_internal(job, timeout_s=remaining)
        result = body.get('result') or {}
        result.setdefault('benchmark', {})['runtime'] = self.worker.runtime_info
        return body
