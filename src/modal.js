// modal.js — Modal backend caller. Submit + poll (mirrors runpod.js pattern).
// POST /generate spawns the job → GET /status/{call_id} polls until complete.
// Same { dataUrl, imageUrl } return shape as runpod.js, plus optional
// { seed, metrics, generation, clientTotalMs } from the server result.

let config = null;

// Completion-detection schedule: an immediate first poll (a fast GPU result
// should not wait for a timer), 250/500 ms next, then 1 s intervals through the
// first ten seconds, backing off to 2 s for long jobs. Measured HTTP latency
// sets the floor on detection lag — polling is transport, not inference.
const POLL_SCHEDULE_MS = [0, 250, 500];
const FAST_WINDOW_MS = 10_000;
const FAST_INTERVAL_MS = 1000;
const SLOW_INTERVAL_MS = 2000;
const TIMEOUT_MS = 15 * 60 * 1000;

function pollDelayMs(pollIndex, startTime) {
    if (pollIndex < POLL_SCHEDULE_MS.length) return POLL_SCHEDULE_MS[pollIndex];
    return (Date.now() - startTime < FAST_WINDOW_MS) ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS;
}

async function getConfig({ signal, refresh = false } = {}) {
    if (config && !refresh) return config;
    const resp = await fetch('/api/config', { signal });
    if (!resp.ok) throw new Error(`Configuration unavailable (${resp.status})`);
    const data = await resp.json();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    config = data.modal || {};
    return config;
}

function abortableDelay(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);           // release the timer when aborted
            signal?.removeEventListener('abort', onAbort);
            reject(new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

/**
 * @param {object} snapshot - same shape runpod.js consumes
 * @param {object} [opts] - { onStatus?(elapsedSec), signal? }
 * @returns {Promise<{ dataUrl: string, imageUrl: string, seed?: number,
 *   metrics?: object, generation?: object, clientTotalMs?: number }>}
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
                ...(snapshot.model === 'moss' ? {
                    model: 'moss',
                    negative_prompt: snapshot.negativePrompt ?? '',
                } : {}),
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
        const clientTotalMs = Date.now() - startTime;

        if (result.status === 'failed') {
            throw new Error(result.error || 'Generation failed');
        }

        const payload = result.result ?? {};
        // "completed" can still carry a handler-level error (validation,
        // unsupported preset/size, missing assets…).
        if (payload.error) {
            throw new Error(payload.error);
        }

        const images = payload.output?.images || payload.images || [];
        if (images.length === 0) {
            throw new Error('No images returned');
        }

        const imageData = images[0].data;
        const mime = images[0].filename?.endsWith('.png') ? 'image/png' : 'image/jpeg';
        const dataUrl = `data:${mime};base64,${imageData}`;
        const blob = await fetch(dataUrl).then(r => r.blob());
        const imageUrl = URL.createObjectURL(blob);
        return {
            dataUrl,
            imageUrl,
            seed: payload.seed,
            metrics: payload.metrics,
            generation: payload.generation,
            clientTotalMs,
        };
    } finally {
        clearInterval(ticker);
    }
}

async function pollStatus(baseUrl, headers, callId, signal, startTime) {
    let pollIndex = 0;
    while (Date.now() - startTime < TIMEOUT_MS) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        await abortableDelay(pollDelayMs(pollIndex, startTime), signal);
        pollIndex += 1;

        const resp = await fetch(`${baseUrl}/status/${callId}`, { headers, signal });
        if (!resp.ok) throw new Error(`Modal status check failed: ${resp.status}`);

        const result = await resp.json();
        if (result.status === 'completed' || result.status === 'failed') return result;
    }
    throw new Error('Generation timed out after 15 minutes');
}

/**
 * Advertised presets from the deployment (GET /capabilities, served by the
 * CPU proxy — never starts a GPU container). Returns null when unavailable
 * (old backend, offline, auth failure) so callers keep the base presets.
 */
export async function fetchCapabilities({ signal, refresh = false } = {}) {
    let endpoint_url, auth_token;
    try {
        ({ endpoint_url, auth_token } = await getConfig({ signal, refresh }));
    } catch {
        return null;
    }
    if (!endpoint_url) return null;
    const baseUrl = endpoint_url.replace(/\/generate\/?$/, '');
    try {
        const resp = await fetch(`${baseUrl}/capabilities`, {
            headers: auth_token ? { 'Authorization': `Bearer ${auth_token}` } : {},
            signal,
        });
        if (!resp.ok) return null;
        const caps = await resp.json();
        return Array.isArray(caps?.presets) ? caps : null;
    } catch {
        return null;
    }
}
