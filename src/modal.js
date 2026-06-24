// modal.js — Modal backend caller. Synchronous POST (no polling): Modal returns
// the image in one response. Same { dataUrl, imageUrl } shape as runpod.js.

let config = null;

async function getConfig() {
    if (config) return config;
    const resp = await fetch('/api/config');
    const data = await resp.json();
    config = data.modal || {};
    return config;
}

/**
 * @param {object} snapshot - same shape runpod.js consumes
 * @param {object} [opts] - { onStatus?(elapsedSec), signal? }
 * @returns {Promise<{ dataUrl: string, imageUrl: string }>}
 */
export async function runJob(snapshot, { onStatus, signal } = {}) {
    const { endpoint_url, auth_token } = await getConfig();
    if (!endpoint_url) {
        throw new Error('Modal not configured. Add modal.endpoint_url and modal.auth_token to ~/.config/llm-credentials.json');
    }

    const startTime = Date.now();
    const ticker = setInterval(() => {
        onStatus?.(Math.round((Date.now() - startTime) / 1000));
    }, 1000);
    onStatus?.(0);

    let resp;
    try {
        resp = await fetch(endpoint_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(auth_token ? { 'Authorization': `Bearer ${auth_token}` } : {}),
            },
            body: JSON.stringify({
                import_json: snapshot.importJson,
                width: snapshot.width,
                height: snapshot.height,
                preset: snapshot.preset,
                workflow: snapshot.workflow,
                turbo_strength: snapshot.turboStrength,
                loras: snapshot.loras,
                seed: snapshot.seed,
            }),
            signal,
        });
    } finally {
        clearInterval(ticker);
    }

    if (resp.status === 401 || resp.status === 403) {
        throw new Error('Modal auth failed — check modal.auth_token');
    }
    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Modal request failed (${resp.status}): ${err}`);
    }

    const result = await resp.json();
    if (result.error) {
        throw new Error(result.error);
    }

    const images = result.output?.images || result.images || [];
    if (images.length === 0) {
        throw new Error('No images returned');
    }

    const imageData = images[0].data;
    const mime = images[0].filename?.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const dataUrl = `data:${mime};base64,${imageData}`;
    const blob = await fetch(dataUrl).then(r => r.blob());
    const imageUrl = URL.createObjectURL(blob);
    return { dataUrl, imageUrl };
}
