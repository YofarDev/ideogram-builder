// Saved generation recipes are captured once and reused for retries.
import { state } from './state.js';

export function buildSnapshot(model = state.model) {
    const jsonText = document.getElementById('json-output').value;
    let importJson;
    try {
        importJson = JSON.stringify(JSON.parse(jsonText), null, null);
    } catch {
        importJson = jsonText;
    }
    const isMoss = model === 'moss';
    return {
        importJson,
        model,
        // MOSS-only; empty for Ideogram so its payload stays unchanged
        negativePrompt: isMoss ? (document.getElementById('moss-negative')?.value ?? '') : '',
        promptFormat: isMoss ? state.moss.promptMode : 'layout',
        enhanceCaption: isMoss && state.moss.promptMode === 'caption' && !!state.moss.enhanceCaption,
        width: state.canvas.width,
        height: state.canvas.height,
        preset: isMoss ? state.moss.preset : state.preset,
        workflow: state.workflow,
        turboStrength: state.turboStrength,
        loras: state.loras.map(l => ({
            filename: l.filename,
            source_url: l.source_url,
            strengths: { ...l.strengths },
        })),
        seed: state.seed,
        photoArtMode: state.photoArtMode,
        backend: localStorage.getItem('ideogram_backend') || 'runpod',
    };
}


// Prefer the resolved seed and executed MOSS recipe when the backend reports them.
export function generationMeta(snapshot, serverSeed, generation) {
    return {
        seed: (serverSeed ?? null) !== null ? serverSeed : snapshot.seed,
        preset: snapshot.preset,
        workflow: snapshot.workflow,
        turboStrength: snapshot.turboStrength,
        width: snapshot.width,
        height: snapshot.height,
        photoArtMode: snapshot.photoArtMode,
        backend: snapshot.backend,
        loras: snapshot.loras.map(l => ({ filename: l.filename, source_url: l.source_url, strengths: l.strengths })),
        // Model context for gallery restore (absent on pre-MOSS jobs = ideogram)
        model: snapshot.model || 'ideogram',
        negativePrompt: snapshot.negativePrompt ?? '',
        promptFormat: snapshot.promptFormat || 'layout',
        enhanceCaption: snapshot.enhanceCaption ?? false,
        ...(snapshot.model === 'moss' ? {
            mossPreset: snapshot.preset,
            ...(generation ? { generation } : {}),
        } : {}),
    };
}
