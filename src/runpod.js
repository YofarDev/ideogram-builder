let config = null;

async function getConfig() {
    if (config) return config;
    const resp = await fetch('/api/config');
    const data = await resp.json();
    config = data.runpod || {};
    return config;
}

/**
 * Submit a generation snapshot to RunPod and poll until complete.
 * @param {object} snapshot - { importJson, width, height, preset, workflow,
 *   turboStrength, loras: [{filename, source_url, strengths}], seed }
 * @param {object} [opts] - { onStatus?(elapsedSec), signal? }
 * @returns {Promise<{ dataUrl: string, imageUrl: string }>}
 */
export async function runJob(snapshot, { onStatus, signal } = {}) {
    const { api_key, endpoint_id } = await getConfig();
    if (!api_key || !endpoint_id) {
        throw new Error('RunPod not configured. Add runpod.api_key and runpod.endpoint_id to ~/.config/llm-credentials.json');
    }

    const baseUrl = `https://api.runpod.ai/v2/${endpoint_id}`;
    const headers = {
        'Authorization': `Bearer ${api_key}`,
        'Content-Type': 'application/json',
    };

    const submitResp = await fetch(`${baseUrl}/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            input: {
                import_json: snapshot.importJson,
                width: snapshot.width,
                height: snapshot.height,
                preset: snapshot.preset,
                workflow: snapshot.workflow,
                turbo_strength: snapshot.turboStrength,
                loras: snapshot.loras,
                seed: snapshot.seed,
            }
        }),
        signal,
    });

    if (!submitResp.ok) {
        const err = await submitResp.text();
        throw new Error(`Submit failed (${submitResp.status}): ${err}`);
    }

    const { id: jobId } = await submitResp.json();
    const result = await pollStatus(baseUrl, headers, jobId, onStatus, signal);

    if (result.status === 'FAILED') {
        throw new Error(result.error || 'Generation failed');
    }

    const images = result.output?.images || [];
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

async function pollStatus(baseUrl, headers, jobId, onStatus, signal) {
    const startTime = Date.now();
    const timeout = 5 * 60 * 1000;

    // ponytail: 1s ticker decoupled from 3s poll cadence so elapsed updates every second
    const ticker = setInterval(() => {
        onStatus?.(Math.round((Date.now() - startTime) / 1000));
    }, 1000);
    onStatus?.(0);

    try {
        while (Date.now() - startTime < timeout) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

            const resp = await fetch(`${baseUrl}/status/${jobId}`, { headers, signal });
            if (!resp.ok) throw new Error(`Status check failed: ${resp.status}`);

            const result = await resp.json();
            if (result.status === 'COMPLETED') return result;
            if (result.status === 'FAILED') return result;

            await new Promise(r => setTimeout(r, 3000));
        }
        throw new Error('Generation timed out after 5 minutes');
    } finally {
        clearInterval(ticker);
    }
}
