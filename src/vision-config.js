// vision-config.js — Fetch /api/config and populate vision-related <select> elements.
// Imported by vision.js and settings.js to avoid duplicate config-fetch logic.

let cachedConfig = null;

export function resetConfigCache() {
  cachedConfig = null;
}

export async function fetchConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    const resp = await fetch('/api/config', { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error('Config fetch failed');
    cachedConfig = await resp.json();
    return cachedConfig;
  } catch {
    return null;
  }
}

export function populateModelSelect(select, config, providerKey, keyField = 'api_key') {
  const vision = config.vision;
  if (!vision) return;

  Object.entries(vision).forEach(([provider, p]) => {
    if (!p?.models?.length || p.models.every(m => !m)) return;
    if (provider !== 'local' && !p?.[keyField]) return;

    const group = document.createElement('optgroup');
    group.label = provider === 'local' ? 'Local' : provider.charAt(0).toUpperCase() + provider.slice(1);
    p.models.forEach(m => {
      if (!m) return;
      const opt = document.createElement('option');
      opt.value = provider === 'local' ? 'local' : `${provider}::${m}`;
      opt.textContent = m;
      group.appendChild(opt);
    });
    select.appendChild(group);
  });
}

export function populateLLMVisionModels(select, config) {
  ['deepseek', 'google', 'openrouter', 'mimo'].forEach(provider => {
    const p = config[provider];
    if (!p?.has_vision || !p?.api_key || !p?.models?.length) return;
    if (p.models.every(m => !m)) return;
    const group = document.createElement('optgroup');
    group.label = provider.charAt(0).toUpperCase() + provider.slice(1);
    p.models.forEach(m => {
      if (!m) return;
      const opt = document.createElement('option');
      opt.value = `${provider}::${m}`;
      opt.textContent = m;
      group.appendChild(opt);
    });
    select.appendChild(group);
  });
}
