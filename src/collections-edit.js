import { getActive, detectModel, inferModel, save, setEditingId } from './collections-data.js';
import { clearDraft } from './collections-drafts.js';
import { detectPromptFormat } from './prompt-convert.js';
import { emit } from './events.js';
import { showToast } from './toast.js';

function editorFor(id) {
  return document.querySelector(`.coll-card[data-card="${id}"] .coll-edit-textarea`);
}

function invalid(textarea, message) {
  textarea.setAttribute('aria-invalid', 'true');
  const error = textarea.closest('.coll-edit').querySelector('.coll-edit-error');
  if (error) { error.textContent = message; error.hidden = false; }
  textarea.focus({ preventScroll: true });
  return false;
}

export function saveEdit(id) {
  const item = getActive()?.items.find(item => item.id === id);
  const textarea = editorFor(id);
  if (!item || !textarea) return false;
  const value = textarea.value;
  const format = detectPromptFormat(value);
  if (format === 'empty') return invalid(textarea, 'Enter a prompt before saving.');
  if (format === 'caption' && (detectModel(item) !== 'moss' || /^\s*[\[{]/.test(value))) {
    return invalid(textarea, 'Invalid JSON. Fix its syntax before saving.');
  }
  const previous = { importJson: item.importJson, model: item.model };
  item.importJson = value;
  item.model = inferModel(value);
  try { save(); }
  catch {
    Object.assign(item, previous);
    return invalid(textarea, 'Could not save this prompt. Browser storage may be full or unavailable. Your draft is still here.');
  }
  clearDraft(item);
  setEditingId(null);
  emit('collection:data-changed');
  document.querySelector(`.coll-card[data-card="${id}"] [data-act="edit"]`)?.focus({ preventScroll: true });
  showToast('Prompt updated.', 'success');
  return true;
}

export function cancelEdit(id) {
  const item = getActive()?.items.find(item => item.id === id);
  if (item) clearDraft(item);
  setEditingId(null);
  emit('collection:data-changed');
  document.querySelector(`.coll-card[data-card="${id}"] [data-act="edit"]`)?.focus({ preventScroll: true });
}

export function bindCollectionRename() {
  const title = document.getElementById('collection-title');
  const input = document.getElementById('collection-title-edit');
  if (!title || !input) return;
  let collection = null;
  const finish = (commit, returnFocus = false) => {
    if (!collection) return;
    const name = input.value.trim();
    const previous = collection.name;
    if (commit && name && name !== previous) {
      collection.name = name.slice(0, 60);
      try { save(); }
      catch {
        collection.name = previous;
        showToast('Collection name could not be saved. Your original name is unchanged.', 'error');
        input.focus();
        return;
      }
    }
    collection = null; // Hiding the focused field can fire blur synchronously.
    input.hidden = true;
    title.hidden = false;
    emit('collection:data-changed');
    if (returnFocus) (title.querySelector('button') || title).focus();
  };
  title.addEventListener('click', () => {
    collection = getActive();
    if (!collection) return;
    input.value = collection.name;
    title.hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
  });
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      finish(event.key === 'Enter', true);
    }
  });
  input.addEventListener('blur', () => finish(true));
}
