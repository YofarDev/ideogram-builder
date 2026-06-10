# UI Tweaks & Gallery Feature Design

## Goal

Move AI prompt to top, load all LLM providers, add gallery/history tab, persist aspect ratio.

## Changes

### 1. Move AI Prompt to top

Reorder HTML: `.ai-section` moves above `.canvas-container` in left-col.

### 2. Load all models from all providers

- `ai-enhancer.js`: iterate all LLM providers from `/api/config` (deepseek, google, openrouter, mimo)
- Group models in `<select>` using `<optgroup>` per provider
- Store provider config (base_url, api_key) per model in a Map
- On enhance: look up the selected model's provider, use its base_url + api_key

### 3. Gallery tab with history

- Tab bar above left-col content: "Editor" | "Gallery"
- Editor tab: current layout
- Gallery tab: grid of saved generations
- Each item: `{ id, timestamp, thumbnail (JPEG ~200px), prompt_json, aspect_ratio, provider, model }`
- Stored in `localStorage` key `ideogram_history`, max 30 items
- New module: `src/gallery.js` — manages tab switching, rendering grid, save/delete/reload
- Thumbnail: offscreen canvas resize to ~200px wide, `toDataURL('image/jpeg', 0.7)`
- Save on `image:ready` event (after successful generation)
- Click card → load prompt + aspect ratio into editor, switch to Editor tab

### 4. Persist last aspect ratio

- Save to `localStorage` key `ideogram_aspect_ratio` on change
- Restore on page load in `settings.js`
