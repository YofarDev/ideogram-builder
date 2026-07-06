// audit.js — image+JSON critique: fetch suggestions, render panel, apply accepts.
// Pure helpers (this task) + UI orchestration (Task 6).

const ALLOWED_FIELDS = new Set([
  'background',
  'high_level_description',
  'style.medium',
  'style.aesthetics',
  'style.lighting',
  'style.photo_or_art',
])

function isValidBbox(b) {
  return Array.isArray(b) && b.length === 4 && b.every(n => typeof n === 'number' && Number.isFinite(n))
}

export function validateSuggestion(raw) {
  if (!raw || typeof raw !== 'object') return null
  const { type, reason } = raw
  if (typeof reason !== 'string') return null
  if (type === 'add_element') {
    const el = raw.element
    if (!el || typeof el !== 'object') return null
    if (typeof el.name !== 'string' || typeof el.desc !== 'string') return null
    if (!isValidBbox(el.bbox)) return null
    return { type, reason: String(reason), element: { ...el, has_text: !!el.has_text, visible_text: el.visible_text ?? null } }
  }
  if (type === 'update_element') {
    if (!Number.isInteger(raw.index) || raw.index < 0) return null
    if (!raw.patch || typeof raw.patch !== 'object') return null
    return { type, reason: String(reason), index: raw.index, patch: { ...raw.patch } }
  }
  if (type === 'update_field') {
    if (!ALLOWED_FIELDS.has(raw.field)) return null
    if (typeof raw.value !== 'string') return null
    return { type, reason: String(reason), field: raw.field, value: raw.value }
  }
  return null
}

export function applyAddElement(json, suggestion) {
  json.compositional_deconstruction ||= { elements: [] }
  json.compositional_deconstruction.elements ||= []
  json.compositional_deconstruction.elements.push(suggestion.element)
}

export function applyUpdateElement(json, suggestion) {
  const els = json?.compositional_deconstruction?.elements
  if (!Array.isArray(els) || suggestion.index >= els.length) {
    throw new Error('stale: element index out of range; re-run audit')
  }
  Object.assign(els[suggestion.index], suggestion.patch)
}

export function applyUpdateField(json, suggestion) {
  const path = suggestion.field.split('.')
  let cursor = json
  for (let i = 0; i < path.length - 1; i++) {
    if (typeof cursor[path[i]] !== 'object' || cursor[path[i]] === null) {
      throw new Error(`stale: field path ${suggestion.field} missing; re-run audit`)
    }
    cursor = cursor[path[i]]
  }
  const leaf = path[path.length - 1]
  if (!(leaf in cursor)) {
    throw new Error(`stale: field path ${suggestion.field} missing; re-run audit`)
  }
  cursor[leaf] = suggestion.value
}
