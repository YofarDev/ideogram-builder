// modal.js — Modal backend caller. Submit + poll (mirrors runpod.js pattern).
// POST /generate spawns the job → GET /status/{call_id} polls until complete.
// Same { dataUrl, imageUrl } return shape as runpod.js.

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

    const baseUrl = endpoint_url.replace(/\/generate\/?$/, '');
    const submitHeaders = {
        'Content-Type': 'application/json',
        ...(auth_token ? { 'Authorization': `Bearer ${auth_token}` } : {}),
    };
    const pollHeaders = auth_token
        ? { 'Authorization': `Bearer ${auth_token}` }
        : {};

    const startTime = Date.now();
    const ticker = setInterval(() => {
        onStatus?.(Math.round((Date.now() - startTime) / 1000));
    }, 1000);
    onStatus?.(0);

    try {
        const submitResp = await fetch(`${baseUrl}/generate`, {
            method: 'POST',
            headers: submitHeaders,
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

        if (submitResp.status === 401 || submitResp.status === 403) {
            throw new Error('Modal auth failed — check modal.auth_token');
        }
        if (!submitResp.ok) {
            const err = await submitResp.text();
            throw new Error(`Modal submit failed (${submitResp.status}): ${err}`);
        }

        const { call_id } = await submitResp.json();
        const result = await pollStatus(baseUrl, pollHeaders, call_id, signal, startTime);

        if (result.status === 'failed') {
            throw new Error(result.error || 'Generation failed');
        }

        const images = result.result?.output?.images || result.result?.images || [];
        if (images.length === 0) {
            throw new Error('No images returned');
        }

        const imageData = images[0].data;
        const mime = images[0].filename?.endsWith('.png') ? 'image/png' : 'image/jpeg';
        const dataUrl = `data:${mime};base64,${imageData}`;
        const blob = await fetch(dataUrl).then(r => r.blob());
        const imageUrl = URL.createObjectURL(blob);
        return { dataUrl, imageUrl };
    } finally {
        clearInterval(ticker);
    }
}

async function pollStatus(baseUrl, headers, callId, signal, startTime) {
    const timeout = 15 * 60 * 1000;

    while (Date.now() - startTime < timeout) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        await new Promise(r => setTimeout(r, 3000));

        const resp = await fetch(`${baseUrl}/status/${callId}`, { headers, signal });
        if (!resp.ok) throw new Error(`Modal status check failed: ${resp.status}`);

        const result = await resp.json();
        if (result.status === 'completed' || result.status === 'failed') return result;
    }
    throw new Error('Generation timed out after 15 minutes');
}
