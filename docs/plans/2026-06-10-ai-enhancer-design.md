# AI Prompt Enhancer — Design Document

## Overview

Add an AI-powered feature to Ideogram Builder that transforms natural language prompts into complete Ideogram JSON prompts — populating form fields, generating bounding boxes on canvas, and setting color palettes.

## Architecture

### New Module: `src/ai-enhancer.js`

Imports from `state.js`, `events.js`, and browser APIs only (per architecture rules).

Responsibilities:
- Prompt textarea DOM management
- DeepSeek API call via OpenAI-compatible chat completions endpoint
- JSON response parsing and app state population
- API key localStorage persistence
- Loading/error state UI

### UI Addition

New section between the canvas container and the action buttons in `index.html`:

- Prompt textarea (3 rows, resizable, placeholder text)
- "✨ AI Enhance" button (primary amber style)
- API key input (small, inline, masked, auto-saved to localStorage)
- Inline error/success messages

### Wiring in `src/app.js`

- Import `initAIEnhancer` from `ai-enhancer.js`
- Call `initAIEnhancer()` after other init functions

## API Integration

- **Provider:** DeepSeek (`deepseek-v4-flash`)
- **Endpoint:** `POST https://api.deepseek.com/v1/chat/completions`
- **Auth:** `Authorization: Bearer <key>` header, key from localStorage
- **Format:** `response_format: { type: "json_object" }`
- **System prompt:** Instructs model to output exact Ideogram JSON structure
- **User prompt:** The natural language description from the textarea

## Data Flow

1. User types prompt, clicks "✨ AI Enhance"
2. Button: disabled + "Enhancing..." text, textarea disabled
3. `fetch()` POST to DeepSeek with 30s timeout
4. Parse response JSON
5. `emit('state:loaded', { json })` → canvas rebuilds boxes, palette loads colors, settings fills form
6. Populate JSON textarea
7. Restore button state

## Error Handling

- Network error / bad key → inline error message "API error: [detail]"
- Invalid JSON response → "Unexpected response format"
- Timeout (30s) → "Request timed out. Check your API key."
- All errors shown in a small status line below the prompt section

## Prompt Engineering

System prompt (full version in implementation):

```
You are an expert prompt engineer for Ideogram AI...
Given a description, output valid JSON with:
- high_level_description
- style_description (aesthetics, lighting, medium, art_style/photo, color_palette)
- compositional_deconstruction (background + elements with bbox, desc, colors)

Rules: bbox 0-1000 normalized, 3-6 elements, harmonious colors
```

## Files Changed

| File | Change |
|------|--------|
| `index.html` | Add prompt section HTML + CSS |
| `src/ai-enhancer.js` | **New** — API call, response handling, UI |
| `src/app.js` | Import + init `ai-enhancer` |
