import { escapeHtml } from './escape-html.js';
import { emit } from './events.js';

export function describeItem(item) {
  let prompt;
  try { prompt = JSON.parse(item.prompt_json); } catch { /* Plain captions are supported too. */ }
  const caption = prompt?.high_level_description || prompt?.summary?.caption
    || prompt?.caption || item.prompt_json || 'No prompt saved';
  const description = typeof caption === 'string' ? caption : 'No prompt saved';
  const model = item.meta?.model || (prompt?.summary || prompt?.items ? 'moss' : 'ideogram');
  return { description, model, vision: prompt?._source === 'vision' };
}

const icon = path => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

export function buildGalleryCard(item, { load, remove }) {
  const { description, model, vision } = describeItem(item);
  const imageUrl = `/output/${encodeURIComponent(item.img)}`;
  const date = new Date(item.mtime * 1000);
  const card = document.createElement('article');
  card.className = 'gallery-card' + (vision ? ' vision-sourced' : '');
  card.innerHTML = `
    <button class="gallery-card-open" type="button" title="Load image and prompt in editor">
      <img src="/api/thumbnail?name=${encodeURIComponent(item.img)}&amp;v=${item.mtime}" alt="" loading="lazy" decoding="async" width="320" height="320">
    </button>
    <div class="gallery-card-info">
      <div class="gallery-card-meta">
        <span class="gallery-card-model">${model === 'moss' ? 'MOSS' : 'Ideogram'}</span>
        <time class="gallery-card-date" datetime="${date.toISOString()}">${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
      </div>
      <div class="gallery-card-prompt">${escapeHtml(description)}</div>
      <div class="gallery-card-actions">
        <button class="gallery-card-btn add-collection" type="button" title="Add prompt to collection" aria-label="Add prompt to collection">${icon('<path d="M12 5v14M5 12h14"/>')}</button>
        <button class="gallery-card-btn download" type="button" title="Download original image" aria-label="Download image">${icon('<path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4"/>')}</button>
        <button class="gallery-card-btn delete" type="button" title="Delete image" aria-label="Delete image">${icon('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>')}</button>
      </div>
    </div>`;

  card.querySelector('.gallery-card-open').setAttribute('aria-label', `Load prompt: ${description.slice(0, 160)}`);
  card.querySelector('.gallery-card-prompt').title = description;
  const image = card.querySelector('img');
  image.addEventListener('error', () => { image.src = imageUrl; }, { once: true });
  card.querySelector('.add-collection').addEventListener('click', event => {
    event.stopPropagation();
    emit('collection:add', { importJson: item.prompt_json || '', imageUrl, model });
  });
  card.querySelector('.download').addEventListener('click', event => {
    event.stopPropagation();
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = item.img;
    link.click();
  });
  card.querySelector('.delete').addEventListener('click', async event => {
    event.stopPropagation();
    const button = event.currentTarget;
    button.disabled = true;
    try { await remove(item.id); } finally { button.disabled = false; }
  });
  card.addEventListener('click', () => load(item));
  return card;
}
