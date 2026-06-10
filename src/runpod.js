import { state } from './state.js';
import { emit } from './events.js';

let config = null;

async function getConfig() {
    if (config) return config;
    const resp = await fetch('/api/config');
    const data = await resp.json();
    config = data.runpod || {};
    return config;
}

export async function generateImage() {
    const btn = document.getElementById('btn-generate-image');
    const statusEl = document.getElementById('generate-status');
    const jsonText = document.getElementById('json-output').value;

    if (!jsonText.trim()) {
        alert('Generate or paste a JSON prompt first.');
        return;
    }

    const { api_key, endpoint_id } = await getConfig();
    if (!api_key || !endpoint_id) {
        alert('RunPod not configured. Add runpod.api_key and runpod.endpoint_id to ~/.config/llm-credentials.json');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Generating...';
    if (statusEl) statusEl.textContent = 'Sending request...';
    emit('runpod:loading');

    try {
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
                    import_json: jsonText,
                    width: state.canvas.width,
                    height: state.canvas.height,
                }
            }),
        });

        if (!submitResp.ok) {
            const err = await submitResp.text();
            throw new Error(`Submit failed (${submitResp.status}): ${err}`);
        }

        const { id: jobId } = await submitResp.json();

        const result = await pollStatus(baseUrl, headers, jobId, statusEl);

        if (result.status === 'FAILED') {
            throw new Error(result.error || 'Generation failed');
        }

        const images = result.output?.images || [];
        if (images.length === 0) {
            throw new Error('No images returned');
        }

        const imageData = images[0].data;
        const mime = images[0].filename?.endsWith('.png') ? 'image/png' : 'image/jpeg';
        const blob = await fetch(`data:${mime};base64,${imageData}`).then(r => r.blob());
        const imageUrl = URL.createObjectURL(blob);

        emit('image:ready', { imageUrl });
        if (statusEl) statusEl.textContent = '';
    } catch (err) {
        console.error('RunPod error:', err);
        if (statusEl) statusEl.textContent = 'Error: ' + err.message;
        alert('Generation failed: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Generate Image';
        emit('runpod:done');
    }
}

async function pollStatus(baseUrl, headers, jobId, statusEl) {
    const startTime = Date.now();
    const timeout = 5 * 60 * 1000;

    while (Date.now() - startTime < timeout) {
        if (statusEl) statusEl.textContent = `Generating... (${Math.round((Date.now() - startTime) / 1000)}s)`;

        const resp = await fetch(`${baseUrl}/status/${jobId}`, { headers });
        if (!resp.ok) throw new Error(`Status check failed: ${resp.status}`);

        const result = await resp.json();

        if (result.status === 'COMPLETED') return result;
        if (result.status === 'FAILED') return result;

        await new Promise(r => setTimeout(r, 3000));
    }

    throw new Error('Generation timed out after 5 minutes');
}
