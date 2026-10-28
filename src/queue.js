import { state } from './state.js';
import { emit, on } from './events.js';
import { showToast } from './toast.js';
import { logError } from './client-log.js';
import { runJob } from './backend.js';
import { ensurePresetUsable, checkSnapshot, getCapabilities } from './moss-presets.js';

let queue = [];
let isRunning = false;
let counter = 1;

const panel = () => document.getElementById('queue-panel');
const genBtn = () => document.getElementById('btn-generate-image');
const statusEl = () => document.getElementById('generate-status');

function buildSnapshot(model = state.model) {
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
        width: state.canvas.width,
        height: state.canvas.height,
        preset: isMoss ? state.moss.preset : state.preset,
        workflow: state.workflow,
        turboStrength: state.turboStrength,
        loras: state.loras.map(l => ({
            filename: l.filename,
            source_url: l.source_url,
            strengths: l.strengths,
        })),
        seed: state.seed,
        photoArtMode: state.photoArtMode,
        backend: localStorage.getItem('ideogram_backend') || 'runpod',
    };
}

function makeJob(importJson, model) {
    // Resolve all model-specific fields together. Quality and Turbo are names
    // in both models, so name membership cannot select the intended recipe.
    const snapshot = { ...buildSnapshot(model || state.model), importJson };
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
    const jsonText = document.getElementById('json-output').value;
    if (!jsonText.trim()) {
        showToast('Create a prompt first — draw boxes and fill the settings, or load JSON.', 'error');
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
    if (job.status === 'running') job.abort.abort();
    if (job.thumbUrl?.startsWith('blob:')) URL.revokeObjectURL(job.thumbUrl);
    queue = queue.filter(j => j.id !== id);
    render();
}

async function drain() {
    if (isRunning) return;
    isRunning = true;
    emit('runpod:loading');

    let job;
    while ((job = queue.find(j => j.status === 'queued'))) {
        // Capabilities may have changed since enqueue (backend switch, refresh):
        // re-validate the snapshot at dispatch, not just the editor's state.
        if (!snapshotGuard(job, { dispatch: true })) continue;
        job.status = 'running';
        render();
        try {
            const { dataUrl, imageUrl, seed: serverSeed, generation } = await runJob(job.snapshot, {
                onStatus: (elapsed) => {
                    job.elapsed = elapsed;
                    if (statusEl()) statusEl().textContent = `Generating... (${elapsed}s)`;
                    render();
                },
                signal: job.abort.signal,
            });
            job.status = 'done';
            job.thumbUrl = imageUrl;
            // Reproducibility: the server-resolved seed (the submitted one can
            // stay -1 after random generation) plus the recipe actually
            // executed, when the backend reports one.
            const meta = {
                seed: (serverSeed ?? null) !== null ? serverSeed : job.snapshot.seed,
                preset: job.snapshot.preset,
                workflow: job.snapshot.workflow,
                turboStrength: job.snapshot.turboStrength,
                width: job.snapshot.width,
                height: job.snapshot.height,
                photoArtMode: job.snapshot.photoArtMode,
                backend: job.snapshot.backend,
                loras: job.snapshot.loras.map(l => ({ filename: l.filename, source_url: l.source_url, strengths: l.strengths })),
                // Model context for gallery restore (absent on pre-MOSS jobs = ideogram)
                model: job.snapshot.model || 'ideogram',
                negativePrompt: job.snapshot.negativePrompt ?? '',
                promptFormat: job.snapshot.promptFormat || 'layout',
                ...(job.snapshot.model === 'moss' ? {
                    mossPreset: job.snapshot.preset,
                    ...(generation ? { generation } : {}),
                } : {}),
            };
            job.serverSeed = serverSeed;
            emit('image:ready', { imageUrl, dataUrl, importJson: job.snapshot.importJson, loras: job.snapshot.loras, source: 'generation', meta });
        } catch (err) {
            if (err.name === 'AbortError') {
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
    const el = panel();
    if (!el || !genBtn()) return;

    const pending = queue.filter(j => ['queued', 'running', 'blocked'].includes(j.status)).length;
    genBtn().textContent = pending > 0 ? `Generate (+${pending} queued)` : 'Generate';

    const badge = document.getElementById('queue-badge');
    if (badge) {
        if (pending > 0) { badge.textContent = pending; badge.hidden = false; }
        else { badge.hidden = true; }
    }

    el.innerHTML = queue.slice().reverse().map(job => {
        const thumb = job.thumbUrl
            ? `<img class="queue-thumb" src="${job.thumbUrl}" alt="">`
            : `<span class="queue-spinner"></span>`;
        let statusText = 'Queued';
        if (job.status === 'running' && job.elapsed != null) statusText = `${job.elapsed}s`;
        else if (job.status === 'done') statusText = 'Done';
        else if (job.status === 'failed') statusText = 'Failed';
        else if (job.status === 'blocked') statusText = 'Waiting for capabilities';
        const failTitle = (['failed', 'blocked'].includes(job.status) && job.error)
            ? ` title="${job.error.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`
            : '';
        return `
            <div class="queue-card queue-${job.status}" data-id="${job.id}"${failTitle}>
                ${thumb}
                <span class="queue-seed">seed ${job.serverSeed ?? job.snapshot.seed}</span>
                <span class="queue-status">${statusText}</span>
                <button class="queue-remove" data-id="${job.id}" aria-label="Remove job">&times;</button>
            </div>`;
    }).join('');
}

export function initQueue() {
    const el = panel();
    if (el && !el.dataset.bound) {
        el.dataset.bound = '1';
        el.addEventListener('click', (e) => {
            const btn = e.target.closest('.queue-remove');
            if (btn) removeJob(Number(btn.dataset.id));
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
