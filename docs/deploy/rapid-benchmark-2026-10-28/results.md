# Rapid benchmark results

Steady warm worker wall time excludes HTTP polling and GPU/server startup; no p95 claim.

| Preset | Measured / steady | Worker median (s) | Sampler median (s) | Sampled device peak (GiB) |
| --- | --- | --- | --- | --- |
| Rapid | 36 / 34 | 3.49965 | 2.1031 | 12.596 |
| Turbo | 36 / 34 | 5.7332 | 4.28835 | 12.564 |
| Fast | 36 / 34 | 24.8402 | 23.08795 | 12.596 |

Paired comparisons exclude switched/cold/incomplete samples and require the same worker.

- Rapid vs Turbo: 34 pairs, 34 faster; median paired saving 2328.8 ms (41.299%).
- Rapid vs Fast: 34 pairs, 34 faster; median paired saving 21195.25 ms (85.63%).

Records: 108 measured + 36 warmups. Integrity violations: 0.

Unpromoted: automated OCR/visual screening is not a completed human CER/IoU/usability acceptance.
