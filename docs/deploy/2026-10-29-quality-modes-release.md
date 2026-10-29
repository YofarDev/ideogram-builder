# MOSS quality modes and caption enhancement release

Production `yofarcorp/ideogram-builder` was deployed from clean source commit
`c6213e6e4a43802dd6f81eaa2e739b7ba3b0ecf4` with tag `git-c6213e6`.
[Modal deployment](https://modal.com/apps/yofarcorp/main/deployed/ideogram-builder).
[Release manifest](2026-10-29-quality-modes-release.json).

The deployment keeps `rapid-hires-auto-int8-cu128`, the baseline ComfyUI build,
and the existing immutable dependency/model images. Fast, Quality, Turbo, and
Rapid are enabled. Poster and Quality30 remain opt-in candidates as described in
the [quality modes plan](../plans/2026-10-29-moss-quality-modes.md).

Validation before deployment: 241 backend tests and 513 frontend tests passed,
with clean diff checks. TextGenerate's DynamicCombo input contract was checked
against both pinned ComfyUI revisions.

Production verification passed:

- Capabilities advertise the validated Rapid profile through 4 MP; experimental
  presets are absent.
- A 2048×2064 Rapid request is rejected with the 4 MP limit.
- Layout JSON with caption enhancement enabled is rejected with a plain-caption
  requirement.
- A normal Rapid caption generated a 1024×1024 PNG with four steps, the requested
  seed, and enhancement recorded as false (56.2 seconds end to end).
- The same caption with enhancement generated a 1024×1024 PNG with matching
  recipe metadata and enhancement recorded as true (74.1 seconds end to end).

Both images were inspected and showed a coherent fox in a snowy forest. This is
a bounded functional smoke check, not a quality benchmark. Reports, images, and
startup logs are retained locally under the ignored
`output/release-c6213e6/` directory. Timing includes API overhead and is specific
to these requests; initial GPU startup was exercised by the rejection probe.

The release manifest records the deployed code commit. This documentation was
committed afterward and does not change deployed runtime sources.
