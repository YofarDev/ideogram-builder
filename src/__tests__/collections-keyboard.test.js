import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.innerHTML = readFileSync('index.html', 'utf8').match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.doUnmock('../events.js');
});

async function setup() {
  const showToast = vi.fn();
  vi.doMock('../toast.js', () => ({ showToast }));
  const collections = await import('../collections.js');
  const data = await import('../collections-data.js');
  const { emit } = await import('../events.js');
  collections.initCollections();
  const first = collections.createCollection('First');
  collections.addItem('Saved caption');
  collections.addItem('Another caption');
  const second = collections.createCollection('Second');
  collections.addItem('Second collection caption');
  collections.setActive(first.id);
  return { collections, data, emit, first, second, showToast };
}
const card = id => document.querySelector(`[data-card="${id}"]`);
const press = (node, key, modifiers = {}) => node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }));
function edit(id) {
  card(id).querySelector('[data-toggle]').click();
  card(id).querySelector('[data-act="edit"]').click();
  return card(id).querySelector('.coll-edit-textarea');
}
function type(textarea, value) {
  textarea.value = value;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

it('keeps focus on the disclosure and announces its expanded state', async () => {
  const { first } = await setup();
  const id = first.items[0].id;
  const toggle = card(id).querySelector('[data-toggle]');
  toggle.focus();
  toggle.click();
  let current = card(id).querySelector('[data-toggle]');
  expect(document.activeElement).toBe(current);
  expect(current.getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById(current.getAttribute('aria-controls'))).not.toBeNull();
  current.click();
  current = card(id).querySelector('[data-toggle]');
  expect(current.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(current);
});

it('navigates collection tabs with arrows, Home and End while retaining focus', async () => {
  const { collections, first, second } = await setup();
  const chip = id => document.querySelector(`[data-chip="${id}"]`);
  chip(first.id).focus();
  expect(chip(second.id).tabIndex).toBe(-1);
  press(chip(first.id), 'ArrowRight');
  expect(collections.getActive().id).toBe(second.id);
  expect(document.activeElement).toBe(chip(second.id));
  expect(chip(second.id).tabIndex).toBe(0);
  expect(document.getElementById('collection-panel').getAttribute('aria-labelledby')).toBe(chip(second.id).id);
  press(chip(second.id), 'End');
  expect(document.activeElement).toBe(chip(first.id));
  press(chip(first.id), 'Home');
  expect(document.activeElement).toBe(chip(second.id));
  press(chip(second.id), 'ArrowLeft');
  expect(document.activeElement).toBe(chip(first.id));
});

it('cancels a rename with Escape even when hiding the input fires blur', async () => {
  const { collections, first } = await setup();
  const rename = document.querySelector('.coll-rename-trigger');
  rename.focus();
  rename.click();
  const input = document.getElementById('collection-title-edit');
  input.value = 'Do not save this';
  press(input, 'Escape');
  input.dispatchEvent(new FocusEvent('blur'));
  expect(collections.getActive().name).toBe('First');
  expect(JSON.parse(localStorage.getItem('ideogram_collections')).find(c => c.id === first.id).name).toBe('First');
  expect(document.activeElement).toBe(rename);
  expect(input.hidden).toBe(true);
});

it('commits a rename once with Enter and returns focus to its button', async () => {
  const { collections } = await setup();
  document.querySelector('.coll-rename-trigger').click();
  const input = document.getElementById('collection-title-edit');
  input.value = 'Renamed';
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  press(input, 'Enter');
  input.dispatchEvent(new FocusEvent('blur'));
  expect(collections.getActive().name).toBe('Renamed');
  expect(writes.mock.calls.filter(([key]) => key === 'ideogram_collections')).toHaveLength(1);
  expect(document.activeElement).toBe(document.querySelector('.coll-rename-trigger'));
});

it('keeps a prompt draft and its cursor through unrelated rendering and collection switches', async () => {
  const { collections, first, second, emit } = await setup();
  const id = first.items[0].id;
  const textarea = edit(id);
  expect(document.activeElement).toBe(textarea);
  type(textarea, 'Unfinished caption in progress');
  textarea.setSelectionRange(4, 9);
  emit('collection:data-changed');
  let current = card(id).querySelector('.coll-edit-textarea');
  expect(current.value).toBe('Unfinished caption in progress');
  expect(document.activeElement).toBe(current);
  expect([current.selectionStart, current.selectionEnd]).toEqual([4, 9]);
  expect(first.items[0].importJson).toBe('Saved caption');
  collections.setActive(second.id);
  collections.setActive(first.id);
  card(id).querySelector('[data-toggle]').click();
  current = card(id).querySelector('.coll-edit-textarea');
  expect(current.value).toBe('Unfinished caption in progress');
  expect(card(id).querySelector('.coll-draft-flag').hidden).toBe(false);
});

it.each(['ctrlKey', 'metaKey'])('saves a prompt with %s+Enter and restores the Edit control', async modifier => {
  const { first } = await setup();
  const id = first.items[0].id;
  const textarea = edit(id);
  type(textarea, 'Updated caption');
  press(textarea, 'Enter', { [modifier]: true });
  expect(first.items[0].importJson).toBe('Updated caption');
  expect(card(id).querySelector('.coll-edit-textarea')).toBeNull();
  expect(card(id).querySelector('.coll-draft-flag').hidden).toBe(true);
  expect(document.activeElement).toBe(card(id).querySelector('[data-act="edit"]'));
});

it('cancels an edited prompt with Escape and discards its draft', async () => {
  const { first } = await setup();
  const id = first.items[0].id;
  const textarea = edit(id);
  type(textarea, 'Discard this');
  press(textarea, 'Escape');
  expect(first.items[0].importJson).toBe('Saved caption');
  expect(document.activeElement).toBe(card(id).querySelector('[data-act="edit"]'));
  card(id).querySelector('[data-act="edit"]').click();
  expect(card(id).querySelector('.coll-edit-textarea').value).toBe('Saved caption');
});

it('keeps invalid JSON editable and points to an inline error', async () => {
  const { first } = await setup();
  const id = first.items[0].id;
  const textarea = edit(id);
  type(textarea, '{unfinished');
  card(id).querySelector('[data-act="save"]').click();
  expect(document.activeElement).toBe(textarea);
  expect(textarea.value).toBe('{unfinished');
  expect(textarea.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(textarea.getAttribute('aria-errormessage')).textContent).toContain('Invalid JSON');
  expect(first.items[0].importJson).toBe('Saved caption');
});

it('keeps the saved recipe and editable draft intact when storage rejects Save', async () => {
  const { first } = await setup();
  const id = first.items[0].id;
  const textarea = edit(id);
  type(textarea, 'Keep this draft');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
  card(id).querySelector('[data-act="save"]').click();
  expect(first.items[0].importJson).toBe('Saved caption');
  expect(document.activeElement).toBe(textarea);
  expect(textarea.value).toBe('Keep this draft');
  expect(card(id).querySelector('.coll-edit-error').textContent).toContain('Your draft is still here');
});

it('moves focus to the next prompt after removal and never collapses on detail text clicks', async () => {
  const { first } = await setup();
  const [one, two] = first.items;
  card(one.id).querySelector('[data-toggle]').click();
  card(one.id).querySelector('.coll-detail').click();
  expect(card(one.id).classList.contains('expanded')).toBe(true);
  card(one.id).querySelector('[data-act="remove"]').click();
  expect(card(one.id)).toBeNull();
  expect(document.activeElement).toBe(card(two.id).querySelector('[data-toggle]'));
});
