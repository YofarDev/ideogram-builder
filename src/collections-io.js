// Collection file transport: validate completely, then add in one saved change.
import { showToast } from './toast.js';
import { createCollection, uid } from './collections-data.js';
import { parseCollectionFile } from './collections-records.js';

export function exportActive(getActive) {
  const c = getActive();
  if (!c || c.items.length === 0) return;
  const payload = {
    name: c.name,
    exportedAt: new Date().toISOString(),
    items: c.items.map(item => ({
      importJson: item.importJson,
      model: item.model,
      ...(item.tokenValues ? { tokenValues: { ...item.tokenValues } } : {}),
      ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection') + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Allow the browser to start the download before releasing its object URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function importCollection(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    const fail = message => { showToast(message, 'error', 6000); resolve(null); };
    reader.onload = () => {
      let data;
      try { data = parseCollectionFile(reader.result, uid); }
      catch (error) { fail(error.message); return; }
      const collection = createCollection(data.name, data.items);
      if (collection) showToast(`Imported “${collection.name}” (${collection.items.length} prompt${collection.items.length === 1 ? '' : 's'}).`, 'success');
      resolve(collection);
    };
    reader.onerror = () => fail('This file could not be read. Check that it is available on this device, then try again.');
    reader.onabort = () => fail('Import was canceled. Your existing collections are unchanged.');
    try { reader.readAsText(file); }
    catch { fail('Choose a readable collection JSON file, then try again.'); }
  });
}

export function bindCollectionFiles(getActive) {
  document.getElementById('btn-collection-export')?.addEventListener('click', () => exportActive(getActive));
  const importInput = document.getElementById('collection-import-input');
  document.getElementById('btn-collection-import')?.addEventListener('click', () => importInput?.click());
  importInput?.addEventListener('change', async () => {
    const file = importInput.files[0];
    if (!file) return;
    const trigger = document.getElementById('btn-collection-import');
    if (trigger) { trigger.disabled = true; trigger.setAttribute('aria-busy', 'true'); }
    try { await importCollection(file); }
    finally {
      importInput.value = '';
      if (trigger) { trigger.disabled = false; trigger.removeAttribute('aria-busy'); }
    }
  });

}
