import { state } from './state.js';
import { emit, on } from './events.js';
import { showToast } from './toast.js';
import { logError } from './client-log.js';
import { runJob } from './backend.js';
import { renderQueue } from './queue-panel.js';
import { buildSnapshot, generationMeta } from './queue-snapshot.js';
import { ensurePresetUsable, checkSnapshot, getCapabilities } from './moss-presets.js';
import { detectPromptFormat } from './prompt-convert.js';

let queue = [];
let isRunning = false;
let counter = 1;

const panel = () => document.getElementById('queue-panel');
const statusEl = () => document.getElementById('generate-status');

function makeJob(importJson, model) {
    // Resolve all model-specific fields together. Quality and Turbo are names
    // in both models, so name membership cannot select the intended recipe.
    const snapshot = { ...buildSnapshot(model || state.model), importJson };
    // Collections can submit a layout while the editor is in caption mode.
    if (snapshot.model === 'moss' && detectPromptFormat(importJson) !== 'caption') {
        snapshot.enhanceCaption = false;
    }
    return {
        id: counter++,
        snapshot,
        status: 'queued',
        abort: new AbortController(),
    };
}

/** Guards the actual snapshot (its preset AND dimensions), not editor state. */
function snapshotGuard(job, { dispatch = false } = {}) {
    const verdict = checkSnapshot(job.snapshot);
    if (verdict.ok) return true;
    if (dispatch) {
        const backend = localStorage.getItem('ideogram_backend') || 'runpod';
        // Unknown capabilities during a refresh/failure are not an explicit
        // withdrawal of a recipe accepted at enqueue. Retain it for refresh.
        job.status = backend === 'modal' && getCapabilities() === null ? 'blocked' : 'failed';
        job.error = job.status === 'blocked'
            ? 'Waiting for backend capabilities; refresh backend settings to resume.'
            : verdict.message;
        if (job.status === 'failed') showToast(job.error, 'error', 5000);
        render();
        return false;
    }
    showToast(verdict.message, 'error', 5000);
    return false;
}

export function enqueue() {
    const prepared = { ok: true };
    emit('prompt:prepare', prepared);
    if (!prepared.ok) {
        showToast('The draft could not be applied. Fix the prompt before generating.', 'error');
        return;
    }
    const jsonText = document.getElementById('json-output').value;
    if (!jsonText.trim()) {
        const message = state.model === 'moss' && state.moss.promptMode === 'caption'
            ? 'Enter a MOSS caption before generating.'
            : 'Create a prompt first — draw boxes and fill the settings, or load JSON.';
        showToast(message, 'error');
        return;
    }
    if (!ensurePresetUsable(state.model)) return;
    const job = makeJob(jsonText);
    if (!snapshotGuard(job)) return;
    queue.push(job);
    render();
    drain();
}

export function enqueueImportJson(importJson, { model } = {}) {
    if (!importJson || !importJson.trim()) return;
    if (!ensurePresetUsable(model || state.model)) return;
    const job = makeJob(importJson, model);
    if (!snapshotGuard(job)) return;
    queue.push(job);
    render();
    drain();
}

export function removeJob(id) {
    const job = queue.find(j => j.id === id);
    if (!job) return;
    job.abort.abort();
    if (job.thumbUrl?.startsWith('blob:')) URL.revokeObjectURL(job.thumbUrl);
    queue = queue.filter(j => j.id !== id);
    render();
}

export function retryJob(id) {
    const job = queue.find(job => job.id === id);
    if (!job || job.status !== 'failed') return;
    if (!snapshotGuard(job)) return;
    job.abort = new AbortController();
    job.status = 'queued';
    delete job.error;
    delete job.elapsed;
    render();
    drain();
}

async function drain() {
    if (isRunning) return;
    isRunning = true;
    emit('runpod:loading');

    while (true) {
        const job = queue.find(j => j.status === 'queued');
        if (!job) break;
        // Capabilities may have changed since enqueue (backend switch, refresh):
        // re-validate the snapshot at dispatch, not just the editor's state.
        if (!snapshotGuard(job, { dispatch: true })) continue;
        job.status = 'running';
        render();
        try {
            const { dataUrl, imageUrl, seed: serverSeed, generation } = await runJob(job.snapshot, {
                onStatus: (elapsed) => {
                    if (job.abort.signal.aborted || job.status !== 'running') return;
                    job.elapsed = elapsed;
                    if (statusEl()) statusEl().textContent = `Generating... (${elapsed}s)`;
                    render();
                },
                signal: job.abort.signal,
            });
            // A canceled backend request may still resolve; never load its image.
            if (job.abort.signal.aborted) {
                if (imageUrl?.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
                continue;
            }
            job.status = 'done';
            job.thumbUrl = imageUrl;
            const meta = generationMeta(job.snapshot, serverSeed, generation);
            job.serverSeed = serverSeed;
            emit('image:ready', { imageUrl, dataUrl, importJson: job.snapshot.importJson, loras: job.snapshot.loras, source: 'generation', meta });
        } catch (err) {
            if (job.abort.signal.aborted || err.name === 'AbortError') {
                queue = queue.filter(j => j !== job);
                render();
                continue;
            }
            job.status = 'failed';
            job.error = err.message;
            if (statusEl()) statusEl().textContent = 'Error: ' + err.message;
            showToast('Generation failed: ' + err.message, 'error');
            // The snackbar fades out — keep the failure in the server terminal too.
            logError(`Generation failed: ${err.message}`, {
                model: job.snapshot.model || 'ideogram',
                backend: job.snapshot.backend,
                seed: job.snapshot.seed,
            });
        }
        render();
    }

    isRunning = false;
    if (statusEl()) statusEl().textContent = '';
    emit('runpod:done');
}

function render() {
    renderQueue(queue);
}

export function initQueue() {
    const el = panel();
    if (el && !el.dataset.bound) {
        el.dataset.bound = '1';
        el.addEventListener('click', (e) => {
            const btn = e.target.closest('.queue-remove');
            if (btn) removeJob(Number(btn.dataset.id));
            const retry = e.target.closest('.queue-retry');
            if (retry) retryJob(Number(retry.dataset.id));
        });
    }
    on('queue:enqueue', ({ importJson, model }) => enqueueImportJson(importJson, { model }));
    on('moss:capabilities-changed', ({ backend, known }) => {
        const current = localStorage.getItem('ideogram_backend') || 'runpod';
        if (backend !== current || (current === 'modal' && !known)) return;
        let resumed = false;
        for (const job of queue) {
            if (job.status !== 'blocked') continue;
            job.status = 'queued';
            delete job.error;
            resumed = true;
        }
        if (resumed) {
            render();
            drain();
        }
    });
    render();
}
