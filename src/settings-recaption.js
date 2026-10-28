// settings-recaption.js — Vision-model recaptioning for individual boxes.
// Imports by settings.js to keep initSettings focused on form bindings.

import { state } from './state.js';
import { emit } from './events.js';
import { showToast } from './toast.js';
import { hasReferenceImage, readReferenceImage } from './reference-image.js';

export function initRecaption(parentFn) {
  const recaptionGroup = document.getElementById('recaption-group');
  const recaptionSelect = document.getElementById('recaption-model');

  if (recaptionGroup) recaptionGroup.style.display = 'none';

  fetch('/api/config', { signal: AbortSignal.timeout(5000) })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(config => {
      const vision = config.vision;
      if (!vision) return;
      Object.entries(vision).forEach(([provider, p]) => {
        if (!p?.models?.length || p.models.every(m => !m)) return;
        if (provider !== 'local' && !p?.api_key) return;
        const group = document.createElement('optgroup');
        group.label = provider === 'local' ? 'Local' : provider.charAt(0).toUpperCase() + provider.slice(1);
        p.models.forEach(m => {
          if (!m) return;
          const opt = document.createElement('option');
          opt.value = provider === 'local' ? 'local' : `${provider}::${m}`;
          opt.textContent = m;
          group.appendChild(opt);
        });
        recaptionSelect.appendChild(group);
      });
    })
    .catch(() => {});

  document.getElementById('btn-recaption')?.addEventListener('click', async () => {
    if (!state.selectedBoxId || !hasReferenceImage()) return;
    const box = state.boxes.find(b => b.id === state.selectedBoxId);
    if (!box) return;
    const revision = state.imageRevision;
    const geometry = JSON.stringify([box.x, box.y, box.w, box.h]);
    const originalDesc = box.desc, originalText = box.text;
    const unchanged = () => revision === state.imageRevision && state.boxes.includes(box)
      && geometry === JSON.stringify([box.x, box.y, box.w, box.h])
      && box.desc === originalDesc && box.text === originalText;

    const btn = document.getElementById('btn-recaption');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Recaptioning\u2026';

    try {
      const bbox = [box.y, box.x, box.y + box.h, box.x + box.w];
      const existingJson = document.getElementById('json-output').value;
      const instructions = document.getElementById('recaption-instructions').value;
      const model = recaptionSelect.value;

      if (!model) {
        showToast('Select a vision model for recaption', 'error');
        return;
      }

      const image = await readReferenceImage();
      if (!unchanged()) throw new Error('Image or box changed. Try recaptioning again.');

      const resp = await fetch('/api/recaption-element', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image,
          bbox,
          elementIndex: state.boxes.indexOf(box),
          existingJson,
          instructions,
          model,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => null);
        throw new Error(err?.error || `Server error (${resp.status})`);
      }

      const data = await resp.json();
      if (!unchanged()) throw new Error('Image or box changed. The recaption was not applied.');
      if (typeof data.desc !== 'string') throw new Error('The vision model returned no description. Try again.');
      box.desc = data.desc;
      if (data.has_text) {
        box.text = typeof data.visible_text === 'string' ? data.visible_text : box.text;
      }
      if (state.selectedBoxId === box.id) {
        document.getElementById('box-desc').value = box.desc;
        if (data.has_text) document.getElementById('box-text').value = box.text;
      }
      emit('box:desc', { id: box.id });
      emit('state:changed');
      showToast('Element recaptioned', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });
}
