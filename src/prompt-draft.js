// Keep manual prompt edits separate from the latest canvas-generated prompt.
import { emit } from './events.js';

const records = new WeakMap();
function context() {
  const output = document.getElementById('json-output');
  if (!output) return null;
  if (!records.has(output)) records.set(output, { generated: output.value, label: '', draft: false });
  return { output, record: records.get(output) };
}

function update() {
  const value = context();
  if (!value) return;
  const { record } = value;
  const notice = document.getElementById('prompt-draft-notice');
  if (notice) notice.hidden = !record.draft;
  document.getElementById('json-section')?.classList.toggle('has-draft', record.draft);
  const chip = document.getElementById('json-format-chip');
  if (chip) {
    const label = record.draft ? 'Draft · not applied' : record.label;
    if (label && chip.textContent !== label) chip.textContent = chip.title = label;
  }
}

export function publishPrompt(text, label) {
  const value = context();
  if (!value) return;
  value.record.generated = text;
  value.record.label = label;
  if (!value.record.draft) value.output.value = text;
  update();
}

export function acceptPromptValue() {
  const value = context();
  if (!value) return;
  value.record.generated = value.output.value;
  value.record.draft = false;
  update();
}

export function capturePromptDraft() {
  const value = context();
  return value?.record.draft ? { text: value.output.value, editorContent: value.record.generated } : null;
}

export function restorePromptDraft(text) {
  const value = context();
  if (!value || typeof text !== 'string') return;
  value.output.value = text;
  value.record.draft = text !== value.record.generated;
  update();
  emit('prompt:draft-changed');
}

export function initPromptDraft() {
  const value = context();
  if (!value) return;
  value.output.addEventListener('input', () => {
    value.record.draft = value.output.value !== value.record.generated;
    update();
    emit('prompt:draft-changed');
  });
  document.getElementById('btn-use-editor-prompt')?.addEventListener('click', () => {
    value.record.draft = false;
    value.output.value = value.record.generated;
    value.output.focus();
    update();
    emit('prompt:draft-changed');
  });
  update();
}
