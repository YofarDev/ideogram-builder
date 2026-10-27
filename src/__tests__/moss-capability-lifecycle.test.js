import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { emit, resetAllListeners } from '../events.js';
import { state } from '../state.js';
import { initSettingsMoss, applyPresetCapabilities } from '../settings-moss.js';
import { availablePresets, ensurePresetUsable, setCapabilities } from '../moss-presets.js';

const response = data => ({ ok: true, json: async () => data });
const caps = { presets: [{ id: 'Fast' }, { id: 'Rapid' }] };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

beforeEach(() => {
  resetAllListeners();
  localStorage.clear();
  state.model = 'moss';
  state.moss = { preset: 'Fast', promptMode: 'layout' };
  setCapabilities(null);
  document.body.innerHTML = `<div id="toast-container"></div><div id="moss-preset-toggle">
    <input name="moss_preset" id="fast" value="Fast"><label for="fast">Fast</label>
    <input name="moss_preset" id="quality" value="Quality"><label for="quality">Quality</label>
    <input name="moss_preset" id="rapid" value="Rapid" data-candidate disabled><label for="rapid" data-candidate hidden>Rapid</label>
  </div>`;
  vi.stubGlobal('fetch', vi.fn(async url => url === '/api/config'
    ? response({ modal: { endpoint_url: 'https://test.invalid/generate' } }) : response(caps)));
});
afterEach(() => vi.unstubAllGlobals());

async function selectBackend(backend) {
  localStorage.setItem('ideogram_backend', backend);
  emit('backend:changed', { backend });
  await vi.waitFor(() => expect(availablePresets()).toContain(backend === 'modal' ? 'Rapid' : 'Quality'));
}

describe('capabilities across real settings events', () => {
  it('refreshes after switching to Modal and clears controls and queue gate on RunPod', async () => {
    initSettingsMoss();
    expect(fetch).not.toHaveBeenCalled();
    await selectBackend('modal');
    expect(availablePresets()).toEqual(['Fast', 'Rapid']);
    expect(document.getElementById('quality').disabled).toBe(true);
    expect(document.querySelector('label[for="quality"]').hidden).toBe(true);
    expect(document.getElementById('rapid').disabled).toBe(false);
    state.moss.preset = 'Rapid';
    expect(ensurePresetUsable()).toBe(true);
    await selectBackend('runpod');
    expect(availablePresets()).toEqual(['Fast','Quality','Turbo']);
    expect(document.querySelector('label[for="rapid"]').hidden).toBe(true);
    expect(document.getElementById('rapid').disabled).toBe(true);
    expect(ensurePresetUsable()).toBe(false);
    expect(state.moss.preset).toBe('Rapid');
  });

  it('clears previous capabilities on a failed configuration refresh', async () => {
    localStorage.setItem('ideogram_backend','modal');
    await applyPresetCapabilities();
    expect(availablePresets()).toContain('Rapid');
    fetch.mockRejectedValue(new Error('offline'));
    await applyPresetCapabilities();
    expect(availablePresets()).toEqual(['Fast','Quality','Turbo']);
    expect(document.getElementById('rapid').disabled).toBe(true);
  });

  it('ignores a late Modal response after a switch to RunPod', async () => {
    const slow = deferred();
    fetch.mockImplementation(url => url === '/api/config'
      ? Promise.resolve(response({ modal: { endpoint_url:'https://old.invalid/generate' } })) : slow.promise);
    localStorage.setItem('ideogram_backend','modal');
    const pending = applyPresetCapabilities();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    localStorage.setItem('ideogram_backend','runpod');
    await applyPresetCapabilities();
    slow.resolve(response(caps));
    await pending;
    expect(availablePresets()).not.toContain('Rapid');
    expect(document.getElementById('rapid').disabled).toBe(true);
  });

  it('ignores an older endpoint response after the new endpoint resolves', async () => {
    localStorage.setItem('ideogram_backend','modal');
    const slow = deferred();
    fetch.mockImplementation(url => url === '/api/config'
      ? Promise.resolve(response({ modal:{ endpoint_url:'https://old.invalid/generate' } })) : slow.promise);
    const old = applyPresetCapabilities();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    fetch.mockImplementation(async url => url === '/api/config'
      ? response({ modal:{ endpoint_url:'https://new.invalid/generate' } }) : response({ presets:[{id:'Fast'}] }));
    await applyPresetCapabilities();
    slow.resolve(response(caps));
    await old;
    expect(availablePresets()).toEqual(['Fast']);
  });

  it('uses the refreshed endpoint on config:changed', async () => {
    initSettingsMoss();
    await selectBackend('modal');
    fetch.mockClear();
    fetch.mockImplementation(async url => url === '/api/config'
      ? response({ modal:{ endpoint_url:'https://new.invalid/generate' } }) : response({ presets:[{id:'Fast'}] }));
    emit('config:changed');
    await vi.waitFor(() => expect(availablePresets()).toEqual(['Fast']));
    expect(fetch).toHaveBeenCalledWith('https://new.invalid/capabilities', expect.anything());
  });
});
