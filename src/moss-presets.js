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

// UI copy; step counts come from the server result metadata, not this table.
export const PRESET_INFO = {
    Fast: { label: 'Fast', blurb: '25 steps · balanced quality/speed' },
    Quality: { label: 'Quality', blurb: '50 steps · maximum quality' },
    Turbo: { label: 'Turbo β', blurb: '8 steps · DMD distillation' },
    Rapid: { label: 'Rapid β', blurb: '4 steps up to 1024² · fastest final-quality iterations' },
    Draft3: { label: 'Draft β', blurb: '3 steps, 1024² max · preview quality' },
    FastSpectrum: { label: 'Fast+ β', blurb: 'Fast with feature-forecasting acceleration' },
    QualitySpectrum: { label: 'Quality+ β', blurb: 'Quality with feature-forecasting acceleration' },
};

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
