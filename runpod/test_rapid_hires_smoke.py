from smoke_rapid_hires import adapter_switch_worker


def record(worker, adapter, status="completed"):
    return {"status": status, "generation": {"adapter": adapter},
            "metrics": {"worker_instance_id": worker}}


def test_autoscaling_does_not_hide_a_real_resident_adapter_switch():
    assert adapter_switch_worker([
        record("other", "rapid4"), record("resident", "dmd8"), record("resident", "rapid4"),
    ]) == "resident"


def test_a_cross_worker_or_failed_run_is_not_a_resident_switch():
    assert adapter_switch_worker([record("one", "dmd8"), record("two", "rapid4")]) is None
    assert adapter_switch_worker([record("one", "dmd8"), record("one", "rapid4", "failed")]) is None
    assert adapter_switch_worker([record(None, "dmd8"), record(None, "rapid4")]) is None
