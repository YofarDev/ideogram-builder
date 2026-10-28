import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const caps = { presets: [{ id: 'Fast' }, { id: 'Rapid', max_area_mp: 1 }] };
const response = body => ({ ok: true, json: async () => body });
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem('ideogram_backend', 'modal');
  document.body.innerHTML = `<button id="btn-generate-image"></button>
    <textarea id="json-output">{}</textarea><div id="queue-panel"></div>
    <div id="generate-status"></div><div id="toast-container"></div>`;
});
afterEach(() => vi.unstubAllGlobals());

async function queuedPair() {
  const first = deferred();
  const runJob = vi.fn()
    .mockImplementationOnce(() => first.promise)
    .mockResolvedValue({ dataUrl: 'data:image/png;base64,AA', imageUrl: 'blob:result' });
  vi.doMock('../backend.js', () => ({ runJob }));
  const { state } = await import('../state.js');
  const presets = await import('../moss-presets.js');
  const queue = await import('../queue.js');
  queue.initQueue();
  state.model = 'moss';
  state.moss = { preset: 'Fast', promptMode: 'layout' };
  state.canvas = { width: 1024, height: 1024 };
  state.loras = [];
  presets.setCapabilities(caps, 'modal');
  queue.enqueue();
  state.moss.preset = 'Rapid';
  queue.enqueue();
  return { first, runJob, presets, queue };
}

it('retains a queued Rapid request during a real deferred refresh and resumes it', async () => {
  const { first, runJob } = await queuedPair();
  const refresh = deferred();
  vi.stubGlobal('fetch', vi.fn(url => url === '/api/config'
    ? Promise.resolve(response({ modal: { endpoint_url: 'https://test.invalid/generate' } }))
    : refresh.promise));
  const { applyPresetCapabilities } = await import('../settings-moss.js');
  const pending = applyPresetCapabilities();
  first.resolve({ dataUrl: 'data:image/png;base64,AA', imageUrl: 'blob:first' });
  await vi.waitFor(() => expect(document.querySelector('.queue-blocked')).not.toBeNull());
  expect(document.querySelectorAll('.queue-card')).toHaveLength(2);
  expect(runJob).toHaveBeenCalledTimes(1);
  refresh.resolve(response(caps));
  await pending;
  await vi.waitFor(() => expect(document.querySelectorAll('.queue-done')).toHaveLength(2));
  expect(runJob.mock.calls[1][0].preset).toBe('Rapid');
});

it('retains the request after a failed refresh and resumes only when metadata returns', async () => {
  const { first, runJob, presets } = await queuedPair();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const { applyPresetCapabilities } = await import('../settings-moss.js');
  await applyPresetCapabilities();
  first.resolve({ dataUrl: 'data:image/png;base64,AA', imageUrl: 'blob:first' });
  await vi.waitFor(() => expect(document.querySelector('.queue-blocked')).not.toBeNull());
  expect(runJob).toHaveBeenCalledTimes(1);
  presets.setCapabilities(null, 'modal');
  expect(runJob).toHaveBeenCalledTimes(1);
  presets.setCapabilities(caps, 'modal');
  await vi.waitFor(() => expect(document.querySelectorAll('.queue-done')).toHaveLength(2));
});

it('shows an explicit withdrawal as a failed card without deleting the recipe', async () => {
  const { first, runJob, presets } = await queuedPair();
  presets.setCapabilities({ presets: [{ id: 'Fast' }] }, 'modal');
  first.resolve({ dataUrl: 'data:image/png;base64,AA', imageUrl: 'blob:first' });
  await vi.waitFor(() => expect(document.querySelector('.queue-failed')).not.toBeNull());
  expect(document.querySelectorAll('.queue-card')).toHaveLength(2);
  expect(document.querySelector('.queue-failed').title).toContain('Rapid β');
  expect(runJob).toHaveBeenCalledTimes(1);
});

it('does not resurrect a blocked job removed by the user', async () => {
  const { first, runJob, presets, queue } = await queuedPair();
  presets.setCapabilities(null, 'modal');
  first.resolve({ dataUrl: 'data:image/png;base64,AA', imageUrl: 'blob:first' });
  await vi.waitFor(() => expect(document.querySelector('.queue-blocked')).not.toBeNull());
  queue.removeJob(Number(document.querySelector('.queue-blocked').dataset.id));
  presets.setCapabilities(caps, 'modal');
  expect(document.querySelectorAll('.queue-card')).toHaveLength(1);
  expect(runJob).toHaveBeenCalledTimes(1);
});
