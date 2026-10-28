import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

it.each([null, '{"unexpected":"object"}', '[null,{"name":"Broken","items":false}]'])
('initializes the editor and queue even with malformed saved collection data (%s)', async saved => {
    vi.resetModules();
    localStorage.clear();
    if (saved) localStorage.setItem('ideogram_collections', saved);
    const html = readFileSync('index.html', 'utf8');
    document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    await import('../app.js');
    expect(document.querySelector('[aria-label="Add color"]')).not.toBeNull();
    const trigger = document.getElementById('btn-queue');
    trigger.click();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('queue-panel').hidden).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('queue-panel').hidden).toBe(true);
    vi.unstubAllGlobals();
});
