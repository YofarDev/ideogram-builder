import { state } from './state.js';
import { emit } from './events.js';
import { showToast } from './toast.js';
import { runJob } from './runpod.js';

let queue = [];
let isRunning = false;
let counter = 1;

const panel = () => document.getElementById('queue-panel');
const genBtn = () => document.getElementById('btn-generate-image');
const statusEl = () => document.getElementById('generate-status');

function buildSnapshot() {
    const jsonText = document.getElementById('json-output').value;
    let importJson;
    try {
        importJson = JSON.stringify(JSON.parse(jsonText), null, null);
    } catch {
        importJson = jsonText;
    }
    return {
        importJson,
        width: state.canvas.width,
        height: state.canvas.height,
        preset: state.preset,
        workflow: state.workflow,
        turboStrength: state.turboStrength,
        loras: state.loras.map(l => ({
            filename: l.filename,
            source_url: l.source_url,
            strengths: l.strengths,
        })),
        seed: state.seed,
    };
}

export function enqueue() {
    const jsonText = document.getElementById('json-output').value;
    if (!jsonText.trim()) {
        showToast('Create a prompt first — draw boxes and fill the settings, or load JSON.', 'error');
        return;
    }
    const job = {
        id: counter++,
        snapshot: buildSnapshot(),
        status: 'queued',
        abort: new AbortController(),
    };
    queue.push(job);
    render();
    drain();
}

export function removeJob(id) {
    const job = queue.find(j => j.id === id);
    if (!job) return;
    if (job.status === 'running') job.abort.abort();
    queue = queue.filter(j => j.id !== id);
    render();
}

async function drain() {
    if (isRunning) return;
    isRunning = true;
    emit('runpod:loading');

    let job;
    while ((job = queue.find(j => j.status === 'queued'))) {
        job.status = 'running';
        render();
        try {
            const { dataUrl, imageUrl } = await runJob(job.snapshot, {
                onStatus: (elapsed) => {
                    job.elapsed = elapsed;
                    if (statusEl()) statusEl().textContent = `Generating... (${elapsed}s)`;
                    render();
                },
                signal: job.abort.signal,
            });
            job.status = 'done';
            job.thumbUrl = imageUrl;
            emit('image:ready', { imageUrl, dataUrl });
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

    const pending = queue.filter(j => j.status === 'queued' || j.status === 'running').length;
    genBtn().textContent = pending > 0 ? `Generate (+${pending} queued)` : 'Generate';

    el.innerHTML = queue.map(job => {
        const thumb = job.thumbUrl
            ? `<img class="queue-thumb" src="${job.thumbUrl}" alt="">`
            : `<span class="queue-spinner"></span>`;
        let statusText = 'Queued';
        if (job.status === 'running' && job.elapsed != null) statusText = `${job.elapsed}s`;
        else if (job.status === 'done') statusText = 'Done';
        else if (job.status === 'failed') statusText = 'Failed';
        return `
            <div class="queue-card queue-${job.status}" data-id="${job.id}">
                ${thumb}
                <span class="queue-seed">seed ${job.snapshot.seed}</span>
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
    render();
}
