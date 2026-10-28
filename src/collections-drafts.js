// Drafts belong to the live item, without changing its saved or queued prompt.
const drafts = new WeakMap();
export const draftFor = item => drafts.get(item) ?? item.importJson;
export const hasDraft = item => drafts.has(item) && drafts.get(item) !== item.importJson;
export function setDraft(item, value) {
  if (value === item.importJson) drafts.delete(item);
  else drafts.set(item, value);
}
export const clearDraft = item => drafts.delete(item);
