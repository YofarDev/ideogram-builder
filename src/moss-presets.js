// moss-presets.js — MOSS preset descriptions and capability-aware selection
// helpers (no DOM writes at import time; the UI layer applies availability).
//
// The server (Modal GET /capabilities) is the source of truth for which
// candidate presets are actually deployed/validated. Without capabilities the
// original three presets are shown. Candidate presets (Rapid/Draft β,
// Fast+/Quality+ β) appear only when the endpoint advertises them.

import { state } from './state.js';
import { showToast } from './toast.js';

export const BASE_PRESETS = ['Fast', 'Quality', 'Turbo'];
export const CANDIDATE_PRESETS = ['Rapid', 'Draft3', 'FastSpectrum', 'QualitySpectrum'];
export const MOSS_PRESET_IDS = [...BASE_PRESETS, ...CANDIDATE_PRESETS];

// UI copy; limits and status come from the server capabilities, not this
// table. Rapid stays explicitly experimental in local fallback copy — no
// unproven performance claims.
export const PRESET_INFO = {
    Fast: { label: 'Fast', blurb: '25 steps · balanced quality/speed' },
    Quality: { label: 'Quality', blurb: '50 steps · maximum quality' },
    Turbo: { label: 'Turbo β', blurb: '8 steps · DMD distillation' },
    Rapid: { label: 'Rapid β', blurb: '4 steps · experimental · up to 1 MP' },
    Draft3: { label: 'Draft β', blurb: '3 steps, 1024² max · preview quality' },
    FastSpectrum: { label: 'Fast+ β', blurb: 'Fast with feature-forecasting acceleration' },
    QualitySpectrum: { label: 'Quality+ β', blurb: 'Quality with feature-forecasting acceleration' },
};

/** Capabilities entry for one preset (validation_status, max_area_mp, blurb). */
export function presetMeta(presetId) {
    return getCapabilities()?.presets?.find(p => p.id === presetId) || null;
}

/** validation_status from capabilities: "validated" | "experimental" | null. */
export function validationStatus(presetId) {
    return presetMeta(presetId)?.validation_status || null;
}

/** Advertised pixel-limit in MP. Without capabilities, apply the known v1
 * technical limits conservatively (they bind server-side regardless). */
export function presetAreaLimitMp(presetId) {
    const meta = presetMeta(presetId);
    if (meta?.max_area_mp != null) return meta.max_area_mp;
    return (presetId === 'Rapid' || presetId === 'Draft3') ? 1 : null;
}

let capabilitiesBackend = null;
let capabilities = null;   // null = unknown/absent → base presets only

export function setCapabilities(caps, backend = localStorage.getItem("ideogram_backend") || "runpod") {
    capabilitiesBackend = backend;
    capabilities = (caps && Array.isArray(caps.presets)) ? caps : null;
}

export function getCapabilities() {
    return capabilitiesBackend === (localStorage.getItem("ideogram_backend") || "runpod") ? capabilities : null;
}

/** An advertised list is authoritative, including restricted base presets. */
export function availablePresets() {
    const caps = getCapabilities();
    return caps ? caps.presets.map(p => p.id).filter(id => Object.hasOwn(PRESET_INFO, id)) : [...BASE_PRESETS];
}

export function isAvailable(presetId) {
    return availablePresets().includes(presetId);
}

export function describePreset(presetId) {
    const info = PRESET_INFO[presetId];
    const remote = getCapabilities()?.presets?.find(p => p.id === presetId);
    if (remote?.blurb) return remote.blurb;
    return info?.blurb || presetId;
}

export function presetLabel(presetId) {
    return PRESET_INFO[presetId]?.label || presetId;
}

/** Toast message explaining why a saved preset cannot be used here. */
export function availabilityMessage(presetId) {
    return `Preset “${presetLabel(presetId)}” is not available on the current backend — ` +
        'pick a supported preset before generating (the saved recipe is kept in the gallery).';
}

/**
 * Guards a submission. Returns true when OK; when false, the saved selection
 * is unavailable on this backend and the user must choose a supported one —
 * the image recipe is never silently swapped.
 */
export function ensurePresetUsable(model = state.model) {
    if (model !== 'moss') return true;
    const preset = state.moss.preset;
    if (isAvailable(preset)) return true;
    showToast(availabilityMessage(preset), 'error');
    return false;
}

/** True when the current moss preset needs the availability warning shown. */
export function currentPresetUnavailable() {
    return state.model === 'moss' && !isAvailable(state.moss.preset);
}

/**
 * Validates an actual queued snapshot — the preset AND dimensions that would
 * really be submitted, not the currently-edited canvas. Checks availability
 * and the preset's advertised pixel limit. Returns { ok, message }.
 */
export function checkSnapshot(snapshot) {
    if (snapshot?.model !== 'moss') return { ok: true, message: '' };
    const preset = snapshot.preset;
    if (!isAvailable(preset)) {
        return { ok: false, message: availabilityMessage(preset) };
    }
    const limitMp = presetAreaLimitMp(preset);
    if (limitMp != null) {
        const areaMp = (snapshot.width * snapshot.height) / (1024 * 1024);
        if (areaMp > limitMp) {
            return {
                ok: false,
                message: `Preset “${presetLabel(preset)}” supports up to ${limitMp} MP — ` +
                    `this request is ${snapshot.width}×${snapshot.height} (${areaMp.toFixed(2)} MP). ` +
                    'Keep the selected recipe and reduce the canvas size.',
            };
        }
    }
    return { ok: true, message: '' };
}
