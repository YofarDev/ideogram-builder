"""Prompt-scoped timing/telemetry for the ComfyUI request path.

Monotonic-clock wall estimates only: WebSocket-derived intervals are observed
wall-clock, never CUDA-kernel timings. Every event is filtered by prompt_id;
cached nodes are reported as cached, never as measured zero cost. After a
reconnect, incomplete intervals are marked unavailable instead of fabricated.
All collection is defensive — a metrics bug must never fail a generation.
"""

import time

SCHEMA_VERSION = 1


class MetricsCollector:
    """Aggregates ComfyUI websocket events for one queued prompt.

    node_stage_map: node-id -> stage name (from moss_workflow.stage_map), used
    to fold per-node intervals into text_encode/sampler/vae_decode/save stages.
    """

    def __init__(self, *, prompt_id, request_id="unknown", worker_instance_id="unknown",
                 runtime_profile="unknown", node_stage_map=None, clock=time.monotonic):
        self._clock = clock
        self.prompt_id = prompt_id
        self.request_id = request_id
        self.worker_instance_id = worker_instance_id
        self.runtime_profile = runtime_profile
        self.node_stage_map = dict(node_stage_map or {})

        self._worker_start = clock()
        self._queued_at = None          # POST /prompt completed
        self._execution_started_at = None
        self._node_starts = {}          # node_id -> start time
        self._node_intervals = {}       # node_id -> (start, end)
        self.cached_node_ids = []
        self._done_at = None
        self._reconnected = False
        self._error = None

    # -- event intake -------------------------------------------------------

    def mark_queued(self):
        """Call right after POST /prompt returns; queue wait ends when the
        execution_start event for our prompt arrives."""
        self._queued_at = self._clock()

    def mark_reconnected(self):
        """A websocket reconnect happened: intervals still open at the drop can
        no longer be trusted as continuous, so the measurement is incomplete."""
        self._reconnected = True

    def on_ws_message(self, message):
        try:
            if not isinstance(message, dict):
                return
            mtype = message.get("type")
            data = message.get("data") or {}
            if data.get("prompt_id") != self.prompt_id:
                return  # another prompt sharing the connection — ignore
            if mtype == "execution_start":
                if self._execution_started_at is None:
                    self._execution_started_at = self._clock()
            elif mtype == "executing":
                node = data.get("node")
                if node is None:
                    if self._done_at is None:
                        self._done_at = self._clock()
                    return
                self._node_starts[node] = self._clock()
            elif mtype == "executed":
                node = data.get("node")
                self._close_node(node)
            elif mtype == "execution_cached":
                nodes = data.get("nodes") or []
                for node in nodes:
                    if node not in self.cached_node_ids:
                        self.cached_node_ids.append(node)
                    # A cached node replays executing/executed without a real
                    # run — never bill it an interval.
                    self._node_starts.pop(node, None)
            elif mtype == "execution_error":
                self._error = str(data.get("exception_message") or "execution_error")
                self._close_node(data.get("node_id"))
        except Exception:  # noqa: BLE001 — telemetry must never break generation
            pass

    def _close_node(self, node):
        start = self._node_starts.pop(node, None)
        if start is not None and node not in self._node_intervals:
            self._node_intervals[node] = (start, self._clock())

    # -- output -------------------------------------------------------------

    def observed_node_wall_ms(self):
        out = {}
        for node, (start, end) in self._node_intervals.items():
            stage = self.node_stage_map.get(node, f"node_{node}")
            out[stage] = round((end - start) * 1000, 1)
        return out

    def comfy_queue_ms(self):
        if self._queued_at is None or self._execution_started_at is None:
            return None
        return round((self._execution_started_at - self._queued_at) * 1000, 1)

    def measurement_complete(self):
        """False when intervals stayed open (lost events), a reconnect occurred,
        or the run errored before completion — the stage numbers then cover only
        the observed part and must not be read as total node cost."""
        if self._reconnected or self._error:
            return False
        if self._done_at is None:
            return False
        return not self._node_starts

    def to_dict(self):
        try:
            worker_total = round((self._clock() - self._worker_start) * 1000, 1)
        except Exception:  # noqa: BLE001
            worker_total = None
        return {
            "schema_version": SCHEMA_VERSION,
            "request_id": self.request_id,
            "worker_instance_id": self.worker_instance_id,
            "runtime_profile": self.runtime_profile,
            "prompt_id": self.prompt_id,
            "worker_total_ms": worker_total,
            "comfy_queue_ms": self.comfy_queue_ms(),
            "observed_node_wall_ms": self.observed_node_wall_ms(),
            "cached_node_ids": list(self.cached_node_ids),
            "node_stage_map": dict(self.node_stage_map),
            "measurement_complete": self.measurement_complete(),
            "measurement_note": self._note(),
        }

    def _note(self):
        if self._reconnected:
            return "websocket reconnected mid-run; open intervals unavailable"
        if self._error:
            return f"execution error before completion: {self._error}"
        if self._done_at is None:
            return "completion event not observed"
        if self._node_starts:
            return "some node intervals never closed"
        return None


def metrics_enabled(env=None):
    import os
    env = os.environ if env is None else env
    return (env.get("MOSS_METRICS") or "on").strip().lower() != "off"
