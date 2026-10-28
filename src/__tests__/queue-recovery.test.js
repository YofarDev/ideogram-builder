import { beforeEach, expect, it, vi } from 'vitest';

function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
const result = { dataUrl: 'data:image/png;base64,AA', imageUrl: '/output/result.png' };

beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = `<button id="btn-generate-image">Generate</button>
        <button id="btn-queue">Queue</button><div id="queue-badge"></div>
        <textarea id="json-output">{"high_level_description":"original prompt"}</textarea>
        <div id="generate-status"></div><div id="queue-panel"></div>`;
});

async function setup(runJob) {
    const emit = vi.fn(), showToast = vi.fn();
    vi.doMock('../backend.js', () => ({ runJob }));
    vi.doMock('../events.js', () => ({ emit, on: vi.fn() }));
    vi.doMock('../toast.js', () => ({ showToast }));
    vi.doMock('../client-log.js', () => ({ logError: vi.fn() }));
    const queue = await import('../queue.js');
    const { state } = await import('../state.js');
    state.model = 'ideogram';
    state.seed = 42;
    state.preset = 'Quality';
    state.canvas = { width: 768, height: 1152 };
    state.loras = [{ filename: 'test.safetensors', strengths: { positive: 0.7, unconditional: 0.4 } }];
    queue.initQueue();
    return { queue, state, emit, showToast };
}

it('keeps the focused cancel control and row mounted through progress updates', async () => {
    const pending = deferred();
    const runJob = vi.fn(() => pending.promise);
    const { queue } = await setup(runJob);
    queue.enqueue();
    const row = document.querySelector('.queue-card');
    const cancel = row.querySelector('.queue-remove');
    cancel.focus();
    for (let elapsed = 1; elapsed <= 60; elapsed++) runJob.mock.calls[0][1].onStatus(elapsed);
    expect(document.querySelector('.queue-card')).toBe(row);
    expect(document.activeElement).toBe(cancel);
    expect(cancel.getAttribute('aria-label')).toBe('Cancel job 1');
    expect(row.querySelector('.queue-status').textContent).toContain('60s');
    pending.resolve(result);
    await vi.waitFor(() => expect(row.classList.contains('queue-done')).toBe(true));
    const status = document.getElementById('generate-status').textContent;
    runJob.mock.calls[0][1].onStatus(99);
    expect(document.getElementById('generate-status').textContent).toBe(status);
});

it('shows the complete failure as text, stops the spinner and retries the saved recipe once', async () => {
    const pending = deferred();
    const runJob = vi.fn().mockRejectedValueOnce(new Error('GPU failed <offline> "please retry"')).mockImplementationOnce(() => pending.promise);
    const { queue, state } = await setup(runJob);
    queue.enqueue();
    await vi.waitFor(() => expect(document.querySelector('.queue-failed')).not.toBeNull());
    const card = document.querySelector('.queue-card');
    expect(card.querySelector('.queue-error').textContent).toBe('GPU failed <offline> "please retry"');
    expect(card.querySelector('.queue-error').hidden).toBe(false);
    expect(card.querySelector('.queue-spinner').hidden).toBe(true);
    const original = runJob.mock.calls[0][0];
    const originalSignal = runJob.mock.calls[0][1].signal;
    state.seed = 999;
    state.preset = 'Default';
    state.loras[0].strengths.positive = 1.9;
    document.getElementById('json-output').value = 'a different draft';
    const retry = card.querySelector('.queue-retry');
    retry.focus();
    retry.click();
    retry.click(); // A repeated activation while running cannot duplicate submission.
    expect(runJob).toHaveBeenCalledTimes(2);
    expect(runJob.mock.calls[1][0]).toEqual(original);
    expect(original.loras[0].strengths.positive).toBe(0.7);
    expect(original.seed).toBe(42);
    expect(original.importJson).toContain('original prompt');
    expect(runJob.mock.calls[1][1].signal).not.toBe(originalSignal);
    expect(document.activeElement).toBe(card.querySelector('.queue-remove'));
    expect(retry.hidden).toBe(true);
    pending.resolve(result);
    await vi.waitFor(() => expect(document.querySelectorAll('.queue-done')).toHaveLength(1));
});

it('rechecks the failed recipe instead of using the current editor preset on retry', async () => {
    const runJob = vi.fn().mockRejectedValue(new Error('offline'));
    const { queue, state, showToast } = await setup(runJob);
    const presets = await import('../moss-presets.js');
    state.model = 'moss';
    state.moss = { preset: 'Rapid', promptMode: 'layout' };
    state.canvas = { width: 768, height: 1024 };
    presets.setCapabilities({ presets: [{ id: 'Rapid' }] }, 'runpod');
    queue.enqueue();
    await vi.waitFor(() => expect(document.querySelector('.queue-failed')).not.toBeNull());
    state.moss.preset = 'Fast';
    presets.setCapabilities({ presets: [{ id: 'Fast' }] }, 'runpod');
    queue.retryJob(1);
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenLastCalledWith(expect.stringContaining('Rapid'), 'error', 5000);
    expect(document.querySelector('.queue-failed')).not.toBeNull();
});

it('ignores a late success after cancellation and continues with the next request', async () => {
    const pending = deferred();
    const runJob = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValueOnce(result);
    const { queue, emit } = await setup(runJob);
    queue.enqueue();
    queue.enqueueImportJson('{"high_level_description":"next prompt"}');
    document.querySelector('[data-id="1"] .queue-remove').click();
    expect(runJob.mock.calls[0][1].signal.aborted).toBe(true);
    pending.resolve({ ...result, imageUrl: '/output/canceled.png' });
    await vi.waitFor(() => expect(document.querySelector('.queue-done')).not.toBeNull());
    const images = emit.mock.calls.filter(([event]) => event === 'image:ready');
    expect(images).toHaveLength(1);
    expect(images[0][1].importJson).toContain('next prompt');
    expect(document.querySelectorAll('.queue-card')).toHaveLength(1);
});

it('does not toast or log a late failure for a canceled request', async () => {
    const pending = deferred();
    const runJob = vi.fn(() => pending.promise);
    const { queue, showToast, emit } = await setup(runJob);
    queue.enqueue();
    queue.removeJob(1);
    pending.reject(new Error('request completed after cancellation'));
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith('runpod:done'));
    expect(showToast).not.toHaveBeenCalled();
    expect(document.querySelector('.queue-card')).toBeNull();
});

it('moves keyboard focus to a neighbouring control when removing a job', async () => {
    const runJob = vi.fn().mockResolvedValue(result);
    const { queue } = await setup(runJob);
    queue.enqueue();
    queue.enqueue();
    await vi.waitFor(() => expect(document.querySelectorAll('.queue-done')).toHaveLength(2));
    const remove = document.querySelector('[data-id="2"] .queue-remove');
    remove.focus();
    remove.click();
    expect(document.activeElement).toBe(document.querySelector('[data-id="1"] .queue-remove'));
    document.activeElement.click();
    expect(document.activeElement).toBe(document.getElementById('btn-queue'));
});
