import { state } from './state.js';
import { emit } from './events.js';
import { showToast } from './toast.js';

let config = null;
let abortController = null;

async function getConfig() {
    if (config) return config;
    const resp = await fetch('/api/config');
    const data = await resp.json();
    config = data.runpod || {};
    return config;
}

function setGenerating(active) {
    const btn = document.getElementById('btn-generate-image');
    if (active) {
        btn.disabled = true;
        btn.textContent = 'Generating...';
    } else {
        btn.disabled = false;
        btn.textContent = 'Generate Image';
    }
}

export async function generateImage() {
    const statusEl = document.getElementById('generate-status');
    const jsonText = document.getElementById('json-output').value;

    if (!jsonText.trim()) {
        showToast('Create a prompt first — draw boxes and fill the settings, or load JSON.', 'error');
        return;
    }

    const { api_key, endpoint_id } = await getConfig();
    if (!api_key || !endpoint_id) {
        showToast('RunPod not configured. Add runpod.api_key and runpod.endpoint_id to ~/.config/llm-credentials.json', 'error');
        return;
    }

    abortController = new AbortController();
    setGenerating(true);
    if (statusEl) statusEl.textContent = 'Sending request...';
    emit('runpod:loading');

    try {
        const baseUrl = `https://api.runpod.ai/v2/${endpoint_id}`;
        const headers = {
            'Authorization': `Bearer ${api_key}`,
            'Content-Type': 'application/json',
        };

        // Minify the JSON to match training distribution (compact separators)
        let importJson;
        try {
            importJson = JSON.stringify(JSON.parse(jsonText), null, null);
        } catch {
            importJson = jsonText;
        }

        const submitResp = await fetch(`${baseUrl}/run`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                input: {
                    import_json: importJson,
                    width: state.canvas.width,
                    height: state.canvas.height,
                    preset: state.preset,
                    workflow: state.workflow,
                    loras: state.loras.map(l => ({
                        filename: l.filename,
                        source_url: l.source_url,
                        strengths: l.strengths,
                    })),
                    seed: state.seed,
                }
            }),
            signal: abortController.signal,
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
        const dataUrl = `data:${mime};base64,${imageData}`;
        const blob = await fetch(dataUrl).then(r => r.blob());
        const imageUrl = URL.createObjectURL(blob);

        emit('image:ready', { imageUrl, dataUrl });
        if (statusEl) statusEl.textContent = '';
    } catch (err) {
        if (err.name === 'AbortError') {
            if (statusEl) statusEl.textContent = 'Cancelled';
            showToast('Generation cancelled.', 'info');
        } else {
            console.error('RunPod error:', err);
            if (statusEl) statusEl.textContent = 'Error: ' + err.message;
            showToast('Generation failed: ' + err.message, 'error');
        }
    } finally {
        setGenerating(false);
        abortController = null;
        emit('runpod:done');
    }
}

async function pollStatus(baseUrl, headers, jobId, statusEl) {
    const startTime = Date.now();
    const timeout = 5 * 60 * 1000;

    while (Date.now() - startTime < timeout) {
        if (abortController?.signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        if (statusEl) statusEl.textContent = `Generating... (${elapsed}s)`;

        const resp = await fetch(`${baseUrl}/status/${jobId}`, { headers, signal: abortController?.signal });
        if (!resp.ok) throw new Error(`Status check failed: ${resp.status}`);

        const result = await resp.json();

        if (result.status === 'COMPLETED') return result;
        if (result.status === 'FAILED') return result;

        await new Promise(r => setTimeout(r, 3000));
    }

    throw new Error('Generation timed out after 5 minutes');
}
