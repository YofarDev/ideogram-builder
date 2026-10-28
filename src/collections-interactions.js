import { emit } from './events.js';
import { collections, expandedId, getActive, setActive, createCollection, setExpandedId, setEditingId, setTokenValue, duplicateItem, removeItem } from './collections-data.js';
import { setDraft, hasDraft } from './collections-drafts.js';

const cardFor = id => document.querySelector(`.coll-card[data-card="${id}"]`);
const focusCard = id => cardFor(id)?.querySelector('[data-toggle]')?.focus({ preventScroll: true });

export function bindCollectionInteractions(root, actions) {
  root.addEventListener('focusin', event => {
    const footer = root.querySelector('.coll-footer');
    if (!footer || footer.contains(event.target)) return;
    const bounds = event.target.getBoundingClientRect();
    const fixed = footer.getBoundingClientRect();
    if (fixed.top < window.innerHeight && bounds.bottom > fixed.top && bounds.top < fixed.bottom) {
      event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  });
  root.addEventListener('input', event => {
    const card = event.target.closest('[data-card]');
    const item = getActive()?.items.find(item => item.id === card?.dataset.card);
    if (!item) return;
    if (event.target.matches('.coll-token-input')) setTokenValue(item.id, event.target.dataset.token, event.target.value);
    if (event.target.matches('.coll-edit-textarea')) {
      setDraft(item, event.target.value);
      event.target.removeAttribute('aria-invalid');
      const error = card.querySelector('.coll-edit-error');
      if (error) { error.hidden = true; error.textContent = ''; }
      const status = card.querySelector('.coll-edit-status');
      if (status) status.textContent = hasDraft(item) ? 'Unsaved changes' : 'Matches saved prompt';
      card.querySelector('.coll-draft-flag').hidden = !hasDraft(item);
    }
  });

  root.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.target.matches('.coll-edit-textarea')) {
      const id = event.target.dataset.edit;
      if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
        event.preventDefault();
        if (event.key === 'Escape') actions.cancelEdit(id);
        else actions.saveEdit(id);
      }
      return;
    }
    const chip = event.target.closest('[data-chip]');
    if (!chip || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = collections.findIndex(c => c.id === chip.dataset.chip);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? collections.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + collections.length) % collections.length;
    setActive(collections[next].id);
    root.querySelector(`[data-chip="${collections[next].id}"]`)?.focus({ preventScroll: true });
  });

  root.addEventListener('click', event => {
    const chip = event.target.closest('[data-chip]');
    if (chip) {
      setActive(chip.dataset.chip);
      root.querySelector(`[data-chip="${chip.dataset.chip}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (event.target.closest('#coll-chip-new')) {
      const collection = createCollection('Collection ' + (collections.length + 1));
      if (collection) root.querySelector(`[data-chip="${collection.id}"]`)?.focus({ preventScroll: true });
      return;
    }
    const action = event.target.closest('[data-act]');
    if (action) {
      const id = action.dataset.id;
      switch (action.dataset.act) {
        case 'generate': actions.generateItem(id); break;
        case 'load': actions.loadItemToEditor(id); break;
        case 'edit':
          setEditingId(id);
          emit('collection:data-changed');
          cardFor(id)?.querySelector('.coll-edit-textarea')?.focus({ preventScroll: true });
          break;
        case 'save': actions.saveEdit(id); break;
        case 'cancel': actions.cancelEdit(id); break;
        case 'dup':
          duplicateItem(id);
          cardFor(id)?.querySelector('[data-act="dup"]')?.focus({ preventScroll: true });
          break;
        case 'remove': {
          const items = getActive().items;
          const index = items.findIndex(item => item.id === id);
          removeItem(id);
          const next = getActive().items[Math.min(index, getActive().items.length - 1)];
          if (next) focusCard(next.id);
          else document.getElementById('collection-paste')?.focus();
          break;
        }
      }
      return;
    }
    const card = event.target.closest('[data-card]');
    if (!card || event.target.closest('.coll-detail') || event.target.closest('input, textarea, a')) return;
    const expanding = expandedId !== card.dataset.card;
    setExpandedId(expanding ? card.dataset.card : null);
    emit('collection:data-changed');
    focusCard(card.dataset.card);
  });
}
