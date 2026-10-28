import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const storedKey = 'ideogram_collections';
const prompt = '{"high_level_description":"A {{subject}} in snow"}';
const payload = { name: 'Winter studies', items: [
  { importJson: prompt, model: 'ideogram', imageUrl: '/output/fox.png', tokenValues: { subject: 'fox "A"\nnext line' } },
  { importJson: 'A snowy cabin', model: 'moss' },
] };
const file = value => new File([JSON.stringify(value)], 'collection.json', { type: 'application/json' });
const readBlob = blob => new Promise(resolve => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.readAsText(blob);
});

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '<div id="toast-container"></div>';
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function setup() {
  const emit = vi.fn(), showToast = vi.fn();
  vi.doMock('../events.js', () => ({ emit, on: vi.fn() }));
  vi.doMock('../toast.js', () => ({ showToast }));
  const data = await import('../collections-data.js');
  const io = await import('../collections-io.js');
  return { data, io, emit, showToast };
}

it('exports and imports prompt text, models, saved variables and local image references', async () => {
  const { data, io } = await setup();
  const first = await io.importCollection(file(payload));
  let exported;
  vi.stubGlobal('URL', { createObjectURL: vi.fn(blob => { exported = blob; return 'blob:export'; }), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  io.exportActive(data.getActive);
  const transport = JSON.parse(await readBlob(exported));
  expect(transport.items).toEqual(payload.items);
  const imported = await io.importCollection(file(transport));
  expect(imported.id).not.toBe(first.id);
  expect(imported.items.map(item => item.id)).not.toEqual(first.items.map(item => item.id));
  expect(imported.items[0].tokenValues.subject).toBe(payload.items[0].tokenValues.subject);
  expect(imported.items[0].importJson).toBe(prompt);
  expect(data.getAll()).toHaveLength(2);
});

it.each([null, [], { items: {} }, { items: [] }, { items: [null] }, { items: [{ importJson: 4 }] }, { items: [{ importJson: ' ' }] }])
('rejects an invalid collection without changing existing data (%j)', async invalid => {
  const { data, io, showToast, emit } = await setup();
  const previous = data.createCollection('Keep this');
  data.addItem('My caption');
  const before = localStorage.getItem(storedKey);
  emit.mockClear();
  expect(await io.importCollection(file(invalid))).toBeNull();
  expect(data.getActive()).toBe(previous);
  expect(localStorage.getItem(storedKey)).toBe(before);
  expect(emit).not.toHaveBeenCalledWith('collection:data-changed');
  expect(showToast).toHaveBeenLastCalledWith(expect.any(String), 'error', 6000);
});

it('rejects the whole file when a later item is invalid', async () => {
  const { io, data, showToast } = await setup();
  expect(await io.importCollection(file({ items: [{ importJson: 'Ready' }, { importJson: false }] }))).toBeNull();
  expect(data.getAll()).toHaveLength(0);
  expect(showToast).toHaveBeenLastCalledWith(expect.stringContaining('Prompt 2'), 'error', 6000);
});

it('saves the complete imported collection once, without an intermediate empty collection', async () => {
  const { io, emit } = await setup();
  const set = vi.spyOn(Storage.prototype, 'setItem');
  await io.importCollection(file(payload));
  const writes = set.mock.calls.filter(([key]) => key === storedKey);
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0][1])[0].items).toHaveLength(2);
  expect(emit.mock.calls.filter(([event]) => event === 'collection:data-changed')).toHaveLength(1);
});

it('keeps the active collection and stored data intact when import exceeds storage space', async () => {
  const { io, data, emit, showToast } = await setup();
  const previous = data.createCollection('Original');
  data.addItem('Original caption');
  const before = localStorage.getItem(storedKey);
  const originalSet = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(key, value) {
    if (key === storedKey) throw new DOMException('Storage full', 'QuotaExceededError');
    return originalSet.call(this, key, value);
  });
  emit.mockClear();
  expect(await io.importCollection(file(payload))).toBeNull();
  expect(data.getActive()).toBe(previous);
  expect(localStorage.getItem(storedKey)).toBe(before);
  expect(emit).not.toHaveBeenCalledWith('collection:data-changed');
  expect(showToast).toHaveBeenLastCalledWith(expect.stringContaining('storage'), 'error', 7000);
});

it('treats a failed selection preference as a successful collection save', async () => {
  const { io, data } = await setup();
  const originalSet = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(key, value) {
    if (key === 'ideogram_active_collection') throw new Error('Preference unavailable');
    return originalSet.call(this, key, value);
  });
  const imported = await io.importCollection(file(payload));
  expect(data.getActive()).toBe(imported);
  expect(JSON.parse(localStorage.getItem(storedKey))[0].items).toHaveLength(2);
});

it.each(['error', 'abort'])('reports a file reader %s without creating a collection', async event => {
  const { io, data, showToast } = await setup();
  vi.stubGlobal('FileReader', class { readAsText() { queueMicrotask(() => this[`on${event}`]()); } });
  expect(await io.importCollection(file(payload))).toBeNull();
  expect(data.getAll()).toHaveLength(0);
  expect(showToast).toHaveBeenLastCalledWith(expect.stringMatching(/could not be read|canceled/), 'error', 6000);
});

it('keeps download URLs alive long enough to start the download', async () => {
  const { data, io } = await setup();
  data.createCollection('Export');
  data.addItem('Caption');
  vi.useFakeTimers();
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:export', revokeObjectURL });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  io.exportActive(data.getActive);
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:export');
});
