import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { runJob } = vi.hoisted(() => ({ runJob: vi.fn() }));
vi.mock('../backend.js', () => ({ runJob }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('ideogram_model', 'moss');
  const html = readFileSync('index.html', 'utf8');
  document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  runJob.mockReset().mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('generates a restored caption when the saved session has no compiled prompt', async () => {
  localStorage.setItem('ideogram_session', JSON.stringify({
    version: 1,
    content: null,
    config: {
      model: 'moss', mossPromptMode: 'caption', mossPreset: 'Fast',
      moss: { caption: 'A fox in snow', negative: 'watermark' },
    },
  }));
  await import('../app.js');
  document.getElementById('btn-generate-image').click();
  expect(runJob).toHaveBeenCalledWith(expect.objectContaining({
    model: 'moss', importJson: 'A fox in snow', promptFormat: 'caption',
    negativePrompt: 'watermark',
  }), expect.anything());
});

it.each(['size', 'aspect ratio'])('keeps LoRA strengths and a fresh caption when changing %s without boxes', async control => {
  await import('../app.js');
  const { state } = await import('../state.js');
  document.getElementById('moss_prompt_caption').click();
  const caption = document.getElementById('moss-caption');
  caption.value = 'A fox in snow';
  caption.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#lora-list .lora-card').click();
  const strength = document.querySelector('#lora-active .lora-strength-range');
  strength.value = '0.65';
  strength.dispatchEvent(new Event('input', { bubbles: true }));
  const loras = structuredClone(state.loras);
  expect(loras).toHaveLength(1);
  if (control === 'size') {
    document.querySelector('.size-btn[data-size="1.5"]').click();
  } else {
    const aspect = document.getElementById('aspect-ratio');
    aspect.value = '1024x1024';
    aspect.dispatchEvent(new Event('change', { bubbles: true }));
  }
  expect(state.loras).toEqual(loras);
  expect(document.querySelectorAll('#lora-active .lora-card')).toHaveLength(1);
  expect(document.getElementById('json-output').value).toBe('A fox in snow');
  document.getElementById('btn-generate-image').click();
  expect(runJob).toHaveBeenCalledWith(expect.objectContaining({
    importJson: 'A fox in snow', loras,
    width: state.canvas.width, height: state.canvas.height,
  }), expect.anything());
});
