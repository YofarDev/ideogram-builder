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

// UI orchestration (Task 6)
import { state } from './state.js'
import { emit, on } from './events.js'
import { showToast } from './toast.js'

let _panel, _list, _modelSelect, _btn, _closeBtn, _acceptAllBtn
let _pending = []  // [{suggestion, cardEl, accept, reject}]

export function initAudit() {
  _btn = document.getElementById('btn-audit')
  _panel = document.getElementById('audit-panel')
  _list = document.getElementById('audit-suggestions')
  _modelSelect = document.getElementById('audit-model')
  _closeBtn = document.getElementById('btn-audit-close')
  _acceptAllBtn = document.getElementById('btn-audit-accept-all')
  if (!_btn || !_panel) return

  // Enable the button only when an image is loaded
  const updateBtnState = () => {
    _btn.disabled = !state.imageDataUrl
  }
  updateBtnState()
  on('image:ready', updateBtnState)

  _btn.addEventListener('click', runAudit)
  _closeBtn?.addEventListener('click', () => { _panel.hidden = true })
  _acceptAllBtn?.addEventListener('click', acceptAll)

  // Populate model select (mirrors recaption pattern)
  fetch('/api/config', { signal: AbortSignal.timeout(5000) })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(config => {
      const vision = config.vision
      if (!vision) return
      Object.entries(vision).forEach(([provider, p]) => {
        if (!p?.models?.length || p.models.every(m => !m)) return
        if (provider !== 'local' && !p?.api_key) return
        const group = document.createElement('optgroup')
        group.label = provider === 'local' ? 'Local' : provider.charAt(0).toUpperCase() + provider.slice(1)
        p.models.forEach(m => {
          if (!m) return
          const opt = document.createElement('option')
          opt.value = provider === 'local' ? 'local' : `${provider}::${m}`
          opt.textContent = m
          group.appendChild(opt)
        })
        _modelSelect.appendChild(group)
      })
    })
    .catch(() => {})
}

async function runAudit() {
  if (!state.imageDataUrl) return
  const model = _modelSelect.value
  if (!model) { showToast('Select a vision model for audit', 'error'); return }

  _btn.disabled = true
  _btn.textContent = 'Auditing\u2026'
  _list.innerHTML = '<div class="audit-empty">Auditing\u2026</div>'
  _panel.hidden = false
  _pending = []

  const body = { image: state.imageDataUrl, json: document.getElementById('json-output').value, model }
  if (model === 'local') {
    body.local_model = _modelSelect.options[_modelSelect.selectedIndex].textContent
  }

  try {
    const resp = await fetch('/api/audit-json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const err = await resp.json().catch(() => null)
      throw new Error(err?.error || `Server error (${resp.status})`)
    }
    const data = await resp.json()
    renderSuggestions(data.suggestions || [])
  } catch (err) {
    showToast(err.message, 'error')
    _list.innerHTML = `<div class="audit-empty">Audit failed: ${err.message}</div>`
  } finally {
    _btn.disabled = false
    _btn.textContent = 'Audit JSON'
  }
}

function renderSuggestions(rawList) {
  const valid = []
  let dropped = 0
  for (const raw of rawList) {
    const s = validateSuggestion(raw)
    if (s) valid.push(s)
    else dropped += 1
  }
  if (dropped > 0) showToast(`${dropped} suggestion${dropped === 1 ? '' : 's'} skipped as malformed`, 'warning')

  _list.innerHTML = ''
  _pending = []
  if (valid.length === 0) {
    _list.innerHTML = '<div class="audit-empty">No improvements found.</div>'
    return
  }
  for (const s of valid) {
    const card = renderCard(s)
    _list.appendChild(card.cardEl)
    _pending.push(card)
  }
}

function renderCard(s) {
  const el = document.createElement('div')
  el.className = 'audit-card'

  const typeLabel = s.type === 'add_element' ? 'Add element'
    : s.type === 'update_element' ? `Update element #${s.index}`
    : `Update ${s.field}`

  let diffHtml = ''
  if (s.type === 'add_element') {
    diffHtml = `<div class="audit-card-diff"><strong>${s.element.name}</strong> — ${s.element.desc}</div>`
  } else if (s.type === 'update_element') {
    diffHtml = `<div class="audit-card-diff">→ ${s.patch.desc || JSON.stringify(s.patch)}</div>`
  } else {
    diffHtml = `<div class="audit-card-diff">→ ${s.value}</div>`
  }

  el.innerHTML = `
    <div class="audit-card-type">${typeLabel}</div>
    <div class="audit-card-reason">${s.reason}</div>
    ${diffHtml}
    <div class="audit-card-actions">
      <button class="btn audit-card-accept" type="button">Accept</button>
      <button class="btn audit-card-reject" type="button">Reject</button>
    </div>
  `

  const accept = () => applySuggestion(s, el)
  const reject = () => {
    el.remove()
    _pending = _pending.filter(p => p.cardEl !== el)
  }
  el.querySelector('.audit-card-accept').addEventListener('click', accept)
  el.querySelector('.audit-card-reject').addEventListener('click', reject)

  return { suggestion: s, cardEl: el, accept, reject }
}

function applySuggestion(suggestion, cardEl) {
  let json
  try {
    json = JSON.parse(document.getElementById('json-output').value)
  } catch (e) {
    showToast('Current JSON is invalid; cannot apply', 'error')
    return
  }
  try {
    if (suggestion.type === 'add_element') applyAddElement(json, suggestion)
    else if (suggestion.type === 'update_element') applyUpdateElement(json, suggestion)
    else if (suggestion.type === 'update_field') applyUpdateField(json, suggestion)
  } catch (e) {
    const errEl = document.createElement('div')
    errEl.className = 'audit-card-error'
    errEl.textContent = e.message
    cardEl.appendChild(errEl)
    return
  }
  document.getElementById('json-output').value = JSON.stringify(json, null, 2)
  emit('state:loaded', { json })
  cardEl.classList.add('applied')
  const actions = cardEl.querySelector('.audit-card-actions')
  if (actions) actions.remove()
  _pending = _pending.filter(p => p.cardEl !== cardEl)
}

function acceptAll() {
  // ponytail: iterate over a snapshot — accept mutates _pending
  const snapshot = [..._pending]
  for (const item of snapshot) {
    item.accept()
  }
}
