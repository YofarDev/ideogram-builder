// Queue presentation keeps controls mounted while elapsed time changes.
const icons = {
    queued: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    blocked: '<path d="M9 5v14M15 5v14"/>',
    failed: '<circle cx="12" cy="12" r="8"/><path d="M12 7v6M12 16v1"/>',
    done: '<path d="m5 12 4 4L19 6"/>',
};

function createCard(id) {
    const row = document.createElement('div');
    row.dataset.id = id;
    row.setAttribute('role', 'listitem');
    row.innerHTML = `
        <div class="queue-visual" aria-hidden="true">
            <span class="queue-spinner" hidden></span>
            <svg class="queue-marker" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></svg>
        </div>
        <div class="queue-details">
            <span class="queue-status"></span>
            <span class="queue-recipe"></span>
            <span class="queue-seed"></span>
            <p class="queue-error" hidden></p>
        </div>
        <div class="queue-actions">
            <button type="button" class="queue-retry" hidden>Retry</button>
            <button type="button" class="queue-remove">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>
            </button>
        </div>`;
    return row;
}

function updateCard(row, job) {
    const running = job.status === 'running';
    const error = ['failed', 'blocked'].includes(job.status) ? job.error || '' : '';
    row.className = `queue-card queue-${job.status}`;
    row.title = error;
    const status = running ? `Generating${job.elapsed != null ? ` · ${job.elapsed}s` : '…'}`
        : { queued: 'Queued', done: 'Done', failed: 'Failed', blocked: 'Waiting for backend' }[job.status];
    row.querySelector('.queue-status').textContent = status;
    row.querySelector('.queue-recipe').textContent = `${job.snapshot.model === 'moss' ? 'MOSS' : 'Ideogram'} · ${job.snapshot.preset}`;
    row.querySelector('.queue-seed').textContent = `seed ${job.serverSeed ?? job.snapshot.seed}`;
    const message = row.querySelector('.queue-error');
    message.textContent = error;
    message.hidden = !error;
    let thumb = row.querySelector('.queue-thumb');
    if (job.thumbUrl) {
        if (!thumb) {
            thumb = document.createElement('img');
            thumb.className = 'queue-thumb';
            thumb.alt = '';
            row.querySelector('.queue-visual').prepend(thumb);
        }
        if (thumb.getAttribute('src') !== job.thumbUrl) thumb.src = job.thumbUrl;
    } else thumb?.remove();
    row.querySelector('.queue-spinner').hidden = !running;
    const marker = row.querySelector('.queue-marker');
    marker.hidden = running || !!job.thumbUrl;
    if (marker.dataset.status !== job.status) {
        marker.innerHTML = icons[job.status] || '';
        marker.dataset.status = job.status;
    }
    const remove = row.querySelector('.queue-remove');
    remove.dataset.id = job.id;
    remove.setAttribute('aria-label', `${running ? 'Cancel' : 'Remove'} job ${job.id}`);
    remove.title = running ? 'Cancel this job' : 'Remove from queue';
    const retry = row.querySelector('.queue-retry');
    retry.dataset.id = job.id;
    retry.setAttribute('aria-label', `Retry job ${job.id}`);
    retry.title = 'Retry the saved prompt and settings';
    if (job.status !== 'failed' && document.activeElement === retry) remove.focus();
    retry.hidden = job.status !== 'failed';
}

export function renderQueue(queue) {
    const panel = document.getElementById('queue-panel');
    if (!panel) return;
    const pending = queue.filter(job => ['queued', 'running', 'blocked'].includes(job.status)).length;
    // Generate keeps a fixed label (no toolbar reflow mid-run); the Queue badge carries the count
    document.getElementById('btn-queue')?.setAttribute('aria-label', pending ? `Queue, ${pending} pending` : 'Queue');
    const badge = document.getElementById('queue-badge');
    if (badge) { badge.textContent = pending; badge.hidden = !pending; }
    panel.setAttribute('aria-label', queue.length ? 'Generation queue' : 'Generation queue is empty');
    const rows = new Map([...panel.children].map(row => [Number(row.dataset.id), row]));
    const ids = new Set(queue.map(job => job.id));
    for (const [id, row] of rows) {
        if (!ids.has(id)) {
            if (row.contains(document.activeElement)) {
                const neighbour = row.nextElementSibling || row.previousElementSibling;
                (neighbour?.querySelector('.queue-remove') || document.getElementById('btn-queue'))?.focus();
            }
            row.remove();
        }
    }
    queue.slice().reverse().forEach((job, index) => {
        const row = rows.get(job.id) || createCard(job.id);
        updateCard(row, job);
        if (panel.children[index] !== row) panel.insertBefore(row, panel.children[index] || null);
    });
}
