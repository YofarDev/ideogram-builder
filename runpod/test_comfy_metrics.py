"""Tests for runpod/comfy_metrics.py — prompt-scoped event aggregation."""


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += seconds


STAGES = {"10": "sampler", "11": "vae_decode", "12": "save_image", "7": "text_encode_positive"}


def make_collector(prompt_id="pid1", **kwargs):
    from comfy_metrics import MetricsCollector

    clock = FakeClock()
    defaults = dict(
        prompt_id=prompt_id, request_id="req-1", worker_instance_id="worker-a",
        runtime_profile="baseline", node_stage_map=STAGES, clock=clock,
    )
    defaults.update(kwargs)
    return MetricsCollector(**defaults), clock


def completed_sequence(collector, clock, *, start_at=1.0, node="10", duration=3.0):
    clock.t = start_at
    collector.mark_queued()
    clock.advance(1.0)
    collector.on_ws_message({"type": "execution_start", "data": {"prompt_id": collector.prompt_id}})
    collector.on_ws_message({"type": "executing", "data": {"prompt_id": collector.prompt_id, "node": node}})
    clock.advance(duration)
    collector.on_ws_message({"type": "executed", "data": {"prompt_id": collector.prompt_id, "node": node}})
    collector.on_ws_message({"type": "executing", "data": {"prompt_id": collector.prompt_id, "node": None}})


def test_happy_path_records_stage_and_queue():
    collector, clock = make_collector()
    completed_sequence(collector, clock, node="10", duration=3.0)
    metrics = collector.to_dict()
    assert metrics["schema_version"] == 1
    assert metrics["comfy_queue_ms"] == 1000.0
    assert metrics["observed_node_wall_ms"]["sampler"] == 3000.0
    assert metrics["measurement_complete"] is True
    assert metrics["cached_node_ids"] == []
    assert metrics["worker_instance_id"] == "worker-a"
    assert metrics["runtime_profile"] == "baseline"
    assert metrics["measurement_note"] is None


def test_multiple_stages_mapped_by_class():
    collector, clock = make_collector()
    clock.t = 0.0
    collector.mark_queued()
    clock.advance(1.0)
    collector.on_ws_message({"type": "execution_start", "data": {"prompt_id": "pid1"}})
    for node, dur in (("7", 0.5), ("10", 2.0), ("11", 0.3), ("12", 0.1)):
        collector.on_ws_message({"type": "executing", "data": {"prompt_id": "pid1", "node": node}})
        clock.advance(dur)
        collector.on_ws_message({"type": "executed", "data": {"prompt_id": "pid1", "node": node}})
    collector.on_ws_message({"type": "executing", "data": {"prompt_id": "pid1", "node": None}})
    stages = collector.to_dict()["observed_node_wall_ms"]
    assert stages["text_encode_positive"] == 500.0
    assert stages["sampler"] == 2000.0
    assert stages["vae_decode"] == 300.0
    assert stages["save_image"] == 100.0


def test_events_from_other_prompts_are_ignored():
    collector, clock = make_collector(prompt_id="pid1")
    completed_sequence(collector, clock)
    collector.on_ws_message({"type": "executing", "data": {"prompt_id": "other", "node": "10"}})
    collector.on_ws_message({"type": "executed", "data": {"prompt_id": "other", "node": "10"}})
    metrics = collector.to_dict()
    assert list(metrics["observed_node_wall_ms"]) == ["sampler"]


def test_cached_nodes_recorded_not_zero_cost():
    collector, clock = make_collector()
    clock.t = 0.0
    collector.mark_queued()
    clock.advance(1.0)
    collector.on_ws_message({"type": "execution_cached", "data": {"prompt_id": "pid1", "nodes": ["7", "8"]}})
    collector.on_ws_message({"type": "executing", "data": {"prompt_id": "pid1", "node": "10"}})
    clock.advance(2.0)
    collector.on_ws_message({"type": "executed", "data": {"prompt_id": "pid1", "node": "10"}})
    collector.on_ws_message({"type": "executing", "data": {"prompt_id": "pid1", "node": None}})
    metrics = collector.to_dict()
    assert metrics["cached_node_ids"] == ["7", "8"]
    assert "text_encode_positive" not in metrics["observed_node_wall_ms"]  # never billed as measured
    assert metrics["observed_node_wall_ms"]["sampler"] == 2000.0
    assert metrics["measurement_complete"] is True


def test_reconnect_marks_measurement_incomplete():
    collector, clock = make_collector()
    completed_sequence(collector, clock)
    collector.mark_reconnected()
    metrics = collector.to_dict()
    assert metrics["measurement_complete"] is False
    assert "reconnected" in metrics["measurement_note"]


def test_execution_error_keeps_partial_metrics():
    collector, clock = make_collector()
    clock.t = 0.0
    collector.mark_queued()
    clock.advance(1.0)
    collector.on_ws_message({"type": "executing", "data": {"prompt_id": "pid1", "node": "10"}})
    clock.advance(1.5)
    collector.on_ws_message({
        "type": "execution_error",
        "data": {"prompt_id": "pid1", "node_id": "10", "exception_message": "OOM"},
    })
    metrics = collector.to_dict()
    assert metrics["measurement_complete"] is False
    assert metrics["observed_node_wall_ms"]["sampler"] == 1500.0  # partial interval retained
    assert "OOM" in metrics["measurement_note"]


def test_serial_completion_closes_last_interval_without_ui_event():
    collector, clock = make_collector()
    clock.t = 0.0
    collector.mark_queued()
    collector.on_ws_message({"type": "executing", "data": {"prompt_id": "pid1", "node": "10"}})
    clock.advance(3)
    collector.on_ws_message({"type": "executing", "data": {"prompt_id": "pid1", "node": None}})
    metrics = collector.to_dict()
    assert metrics["measurement_complete"] is True
    assert metrics["observed_node_wall_ms"] == {"sampler": 3000.0}


def test_queue_wait_unknown_when_execution_start_missing():
    collector, clock = make_collector()
    clock.t = 0.0
    collector.mark_queued()
    collector.on_ws_message({"type": "executing", "data": {"prompt_id": "pid1", "node": None}})
    assert collector.to_dict()["comfy_queue_ms"] is None


def test_worker_total_measured():
    collector, clock = make_collector()
    completed_sequence(collector, clock, start_at=1.0)
    clock.advance(4.2)
    # collector constructed at t=0; clock now at 9.2 → 9200 ms total.
    assert collector.to_dict()["worker_total_ms"] == 9200.0


def test_unmapped_node_gets_node_id_stage_name():
    collector, clock = make_collector(node_stage_map={})
    completed_sequence(collector, clock, node="99")
    assert collector.to_dict()["observed_node_wall_ms"] == {"node_99": 3000.0}


def test_garbage_input_never_raises():
    collector, _clock = make_collector()
    for junk in (None, "string", {}, {"type": None}, {"type": "executing"},
                 {"type": "executing", "data": None},
                 {"type": "execution_cached", "data": {"prompt_id": "pid1"}},
                 {"type": "executing", "data": {"prompt_id": "pid1", "node": ["weird"]}}):
        collector.on_ws_message(junk)
    assert collector.to_dict() is not None
