// gallery-meta.js — Restore generation meta from a gallery card. Split from
// gallery.js (LOC limit). Model switch happens FIRST so json-builder renders
// the right format; seed:false keeps D4 field seeding quiet.

import { state } from './state.js';
import { emit } from './events.js';
import { restoreLorasFromMeta } from './lora.js';
import { capabilitiesPending, isAvailable, presetLabel } from './moss-presets.js';
import { showToast } from './toast.js';

export function restoreMeta(meta) {
    // Model first — the preset/negative/prompt-mode restores below depend on it
    const model = meta.model || 'ideogram';
    if (model !== state.model) {
        emit('model:set', { model, seed: false });
    }

    if (meta.backend) {
        const previousBackend = localStorage.getItem('ideogram_backend') || 'runpod';
        localStorage.setItem('ideogram_backend', meta.backend);
        const be = document.querySelector(`input[name="backend"][value="${meta.backend}"]`);
        if (be) be.checked = true;
        if (previousBackend !== meta.backend) {
            emit('backend:changed', { backend: meta.backend });
        }
    }

    if (model === 'moss') {
        restoreMossMeta(meta);
    } else if (meta.preset) {
        state.preset = meta.preset;
        document.querySelectorAll('input[name="steps"]').forEach(r => {
            if (r.dataset.preset === meta.preset) r.checked = true;
        });
    }

    if (meta.seed !== undefined && meta.seed >= 0) {
        state.seed = meta.seed;
        const seedInput = document.getElementById('seed-input');
        if (seedInput) seedInput.value = meta.seed;
    }
    if (meta.workflow) {
        state.workflow = meta.workflow;
        const wf = document.querySelector(`input[name="workflow"][value="${meta.workflow}"]`);
        if (wf) wf.checked = true;
        localStorage.setItem('ideogram_workflow', meta.workflow);
    }
    if (meta.turboStrength !== undefined) {
        state.turboStrength = meta.turboStrength;
        const ts = document.getElementById('turbo-strength');
        if (ts) ts.value = meta.turboStrength;
    }
    if (meta.width && meta.height) {
        state.canvas.width = meta.width;
        state.canvas.height = meta.height;
        const dd = document.getElementById('dim-display');
        if (dd) dd.textContent = `${meta.width} \u00d7 ${meta.height}`;
        const ar = document.getElementById('aspect-ratio');
        if (ar) {
            const opt = Array.from(ar.options).find(o => o.value === `${meta.width}x${meta.height}`);
            if (opt) ar.value = opt.value;
        }
    }
    if (meta.photoArtMode !== undefined && model !== 'moss') {
        state.photoArtMode = meta.photoArtMode;
        const modeRadio = document.getElementById(meta.photoArtMode === 1 ? 'mode_artstyle' : 'mode_photo');
        if (modeRadio) modeRadio.checked = true;
    }
    if (Array.isArray(meta.loras)) {
        restoreLorasFromMeta(meta.loras);
    }
}

function restoreMossMeta(meta) {
    if (meta.mossPreset) {
        state.moss.preset = meta.mossPreset;
        localStorage.setItem('ideogram_moss_preset', meta.mossPreset);
        const r = document.querySelector(`input[name="moss_preset"][value="${meta.mossPreset}"]`);
        if (r) r.checked = true;
        // Availability-aware restore: keep the saved recipe selected, but make
        // an unavailable candidate preset explicit — never silently swap it.
        // A Modal backend change starts an asynchronous capability refresh.
        // Its completion reports unavailable recipes; unknown is not rejection.
        if (!capabilitiesPending() && !isAvailable(meta.mossPreset)) {
            showToast(`Preset “${presetLabel(meta.mossPreset)}” was saved with this image but is not available on the current backend — select a supported preset before generating.`, 'error', 5000);
        }
    }
    if (meta.negativePrompt !== undefined && meta.negativePrompt !== null) {
        const neg = document.getElementById('moss-negative');
        if (neg) neg.value = meta.negativePrompt;
    }
    // Pre-feature images were never enhanced. Do not inherit the last run.
    state.moss.enhanceCaption = meta.enhanceCaption === true;
    const box = document.getElementById('moss-enhance-caption');
    if (box) box.checked = state.moss.enhanceCaption;
    if (meta.promptFormat) {
        state.moss.promptMode = meta.promptFormat;
        document.body.dataset.mossPrompt = meta.promptFormat;
        const r = document.querySelector(`input[name="moss_prompt_mode"][value="${meta.promptFormat}"]`);
        if (r) r.checked = true;
    }
    emit('moss:settings-restored');
}
