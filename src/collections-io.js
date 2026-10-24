// collections-io.js — Collection file export/import. Split from collections.js
// (LOC limit). Uses createCollection so module bindings are never assigned.

import { emit } from './events.js';
import { showToast } from './toast.js';
import { createCollection, save, uid, inferModel } from './collections-data.js';

export function exportActive(getActive) {
  const c = getActive();
  if (!c || c.items.length === 0) return;
  const payload = {
    name: c.name,
    exportedAt: new Date().toISOString(),
    items: c.items.map(i => ({ importJson: i.importJson, model: i.model })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection') + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function importCollection(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const items = Array.isArray(data.items)
        ? data.items.filter(i => i.importJson).map(i => ({ id: uid(), importJson: i.importJson, model: inferModel(i.importJson, i.model) }))
        : [];
      if (!items.length) { showToast('No prompts found in file.', 'error'); return; }
      const c = createCollection((data.name || 'Imported').slice(0, 60));
      c.items = items;
      save();
      emit('collection:data-changed');
      showToast(`Imported "${c.name}" (${items.length}).`, 'success');
    } catch { showToast('Could not read that file.', 'error'); }
  };
  reader.readAsText(file);
}
