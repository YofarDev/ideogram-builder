// audit.js — image+JSON critique in the Vision tab

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

// Map the VLM's friendly field names (what json_audit.txt advertises) to their
// real storage paths in the canonical caption. background lives under
// compositional_deconstruction; style.* lives under style_description.
// style.photo_or_art is resolved dynamically (photo vs art_style).
const _FIELD_PATHS = {
  'background': 'compositional_deconstruction.background',
  'high_level_description': 'high_level_description',
  'style.medium': 'style_description.medium',
  'style.aesthetics': 'style_description.aesthetics',
  'style.lighting': 'style_description.lighting',
}

export function applyUpdateField(json, suggestion) {
  const friendly = suggestion.field

  if (friendly === 'style.photo_or_art') {
    const sd = json.style_description
    if (!sd || typeof sd !== 'object') {
      throw new Error('stale: style_description missing; re-run audit')
    }
    const key = 'photo' in sd
      ? 'photo'
      : ('art_style' in sd ? 'art_style' : (sd.medium === 'photograph' ? 'photo' : 'art_style'))
    sd[key] = suggestion.value
    return
  }

  const real = _FIELD_PATHS[friendly]
  if (!real) throw new Error(`unknown field: ${friendly}`)
  const path = real.split('.')
  let cursor = json
  for (let i = 0; i < path.length - 1; i++) {
    if (typeof cursor[path[i]] !== 'object' || cursor[path[i]] === null) {
      throw new Error(`stale: field path ${friendly} missing; re-run audit`)
    }
    cursor = cursor[path[i]]
  }
  const leaf = path[path.length - 1]
  if (!(leaf in cursor)) {
    throw new Error(`stale: field path ${friendly} missing; re-run audit`)
  }
  cursor[leaf] = suggestion.value
}

import { state } from './state.js'
import { emit } from './events.js'
import { showToast } from './toast.js'

let _suggestionsEl, _modelSelect, _runBtn
let _pending = []
let _auditMode = 'full'

function _setAuditMode(mode) {
  if (mode !== 'full' && mode !== 'missing') return
  _auditMode = mode
  localStorage.setItem('audit_mode', mode)
  document.querySelectorAll('.audit-mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode)
  })
}

function _esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

function _trunc(s, n) {
  s = String(s)
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function _cardSubject(s) {
  if (s.type === 'add_element') return s.element?.name || 'element'
  if (s.type === 'update_element') {
    const keys = s.patch ? Object.keys(s.patch).join(', ') : ''
    return `Element #${s.index}${keys ? ' · ' + keys : ''}`
  }
  if (s.type === 'update_field') return s.field
  return ''
}

export function initAudit() {
  _runBtn = document.getElementById('btn-audit-run')
  _suggestionsEl = document.getElementById('audit-suggestions')
  _modelSelect = document.getElementById('audit-model')
  if (!_runBtn || !_suggestionsEl) return

  _runBtn.addEventListener('click', runAudit)

  document.querySelectorAll('.audit-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => _setAuditMode(btn.dataset.mode))
  })
  _setAuditMode(localStorage.getItem('audit_mode') || 'full')

  fetch('/api/config', { signal: AbortSignal.timeout(5000) })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(config => {
      // All vision models from config.vision (no api_key filter — server handles auth)
      const vision = config.vision
      if (vision) {
        Object.entries(vision).forEach(([provider, p]) => {
          if (!p?.models?.length || p.models.every(m => !m)) return
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
      }
      // Also add LLM providers with vision capability (same as main vision dropdown)
      ;['deepseek', 'google', 'openrouter', 'mimo'].forEach(provider => {
        const p = config[provider]
        if (!p?.has_vision || !p?.api_key || !p?.models?.length) return
        if (p.models.every(m => !m)) return
        const group = document.createElement('optgroup')
        group.label = provider.charAt(0).toUpperCase() + provider.slice(1)
        p.models.forEach(m => {
          if (!m) return
          const opt = document.createElement('option')
          opt.value = `${provider}::${m}`
          opt.textContent = m
          group.appendChild(opt)
        })
        _modelSelect.appendChild(group)
      })
    })
    .catch(() => {})
}

async function runAudit() {
  const model = _modelSelect.value
  if (!model) { showToast('Select a vision model for audit', 'error'); return }
  const previewImg = document.getElementById('vision-preview-img')
  const imageSrc = previewImg?.src?.startsWith('data:') ? previewImg.src : state.imageDataUrl
  if (!imageSrc?.startsWith('data:')) {
    showToast('Load an image in the Vision tab first', 'error')
    return
  }
  const jsonVal = (document.getElementById('vision-json')?.value || document.getElementById('json-output').value).trim()
  if (!jsonVal) {
    showToast('No JSON content to audit', 'error')
    return
  }

  _runBtn.disabled = true
  _runBtn.textContent = 'Auditing\u2026'
  _suggestionsEl.innerHTML = '<div class="audit-empty">Auditing\u2026</div>'
  _pending = []

  const body = { image: imageSrc, json: jsonVal, model, mode: _auditMode }
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
      const detail = err?.detail ? `\n${String(err.detail).slice(0, 280)}` : ''
      throw new Error((err?.error || `Server error (${resp.status})`) + detail)
    }
    const data = await resp.json()
    renderSuggestions(data.suggestions || [])
  } catch (err) {
    showToast(err.message, 'error')
    _suggestionsEl.innerHTML = `<div class="audit-empty">Audit failed: ${err.message}</div>`
  } finally {
    _runBtn.disabled = false
    _runBtn.textContent = 'Run Audit'
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

  _suggestionsEl.innerHTML = ''
  _pending = []
  if (valid.length === 0) {
    _suggestionsEl.innerHTML = '<div class="audit-empty">No improvements found.</div>'
    return
  }

  let currentJson = null
  try {
    currentJson = JSON.parse(document.getElementById('vision-json')?.value || document.getElementById('json-output').value)
  } catch {}

  const groups = { add_element: [], update_element: [], update_field: [] }
  for (const s of valid) {
    const key = s.type
    if (groups[key]) groups[key].push(s)
  }

  const summary = document.createElement('div')
  summary.className = 'audit-summary'
  const label = document.createElement('span')
  label.textContent = `${valid.length} suggestion${valid.length !== 1 ? 's' : ''}`
  summary.appendChild(label)
  const acceptAllBtn = document.createElement('button')
  acceptAllBtn.className = 'audit-accept-all'
  acceptAllBtn.type = 'button'
  acceptAllBtn.textContent = 'Accept all'
  acceptAllBtn.addEventListener('click', () => { acceptAll(); acceptAllBtn.remove() })
  summary.appendChild(acceptAllBtn)
  _suggestionsEl.appendChild(summary)

  // Flat list, ordered adds → edits → fields. Type chips on each card carry identity.
  let delay = 0
  for (const key of ['add_element', 'update_element', 'update_field']) {
    for (const s of groups[key]) {
      const card = renderCard(s, currentJson)
      card.cardEl.style.animationDelay = `${delay}ms`
      _suggestionsEl.appendChild(card.cardEl)
      _pending.push(card)
      delay += 30
    }
  }
}

function getOldValue(currentJson, field) {
  if (field === 'style.photo_or_art') {
    const sd = currentJson?.style_description
    if (!sd || typeof sd !== 'object') return null
    return 'photo' in sd ? sd.photo : ('art_style' in sd ? sd.art_style : null)
  }
  const real = _FIELD_PATHS[field] || field
  let cursor = currentJson
  for (const part of real.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return null
    cursor = cursor[part]
  }
  return cursor
}

function renderCard(s, currentJson) {
  const el = document.createElement('div')
  el.className = 'audit-card audit-card--' + s.type

  let typeLabel, detailHtml = ''

  if (s.type === 'add_element') {
    typeLabel = 'ADD'
    const e = s.element
    let inner = ''
    if (e.has_text && e.visible_text) {
      inner += `<span class="audit-text">"${_esc(_trunc(e.visible_text, 60))}"</span> `
    }
    inner += _esc(_trunc(e.desc, 140))
    if (Array.isArray(e.bbox)) {
      inner += ` <span class="audit-bbox">${e.bbox.join(', ')}</span>`
    }
    detailHtml = `<div class="audit-detail">${inner}</div>`
  } else if (s.type === 'update_element') {
    typeLabel = 'EDIT'
    const els = currentJson?.compositional_deconstruction?.elements
    const oldEl = els && s.index < els.length ? els[s.index] : null
    const changes = Object.entries(s.patch).map(([k, v]) => {
      const oldVal = oldEl ? _trunc(JSON.stringify(oldEl[k]), 90) : '—'
      const newVal = _trunc(JSON.stringify(v), 90)
      return `<div class="audit-change"><span class="audit-key">${_esc(k)}</span> <span class="diff-old">${_esc(oldVal)}</span> &rarr; <span class="diff-new">${_esc(newVal)}</span></div>`
    }).join('')
    detailHtml = changes ? `<div class="audit-changes">${changes}</div>` : ''
  } else if (s.type === 'update_field') {
    typeLabel = 'FIELD'
    const oldVal = getOldValue(currentJson, s.field)
    const oldStr = oldVal != null ? _trunc(JSON.stringify(oldVal), 90) : '—'
    const newStr = _trunc(JSON.stringify(s.value), 90)
    detailHtml = `<div class="audit-changes"><div class="audit-change"><span class="diff-old">${_esc(oldStr)}</span> &rarr; <span class="diff-new">${_esc(newStr)}</span></div></div>`
  }

  el.innerHTML = `
    <div class="audit-card-main">
      <div class="audit-card-head">
        <span class="audit-chip">${typeLabel}</span>
        <span class="audit-subject">${_esc(_cardSubject(s))}</span>
      </div>
      ${detailHtml}
      <div class="audit-reason">${_esc(s.reason)}</div>
    </div>
    <div class="audit-card-actions">
      <button class="audit-dismiss" type="button" aria-label="Dismiss suggestion" title="Dismiss">&times;</button>
      <button class="btn btn-primary audit-accept" type="button">Accept</button>
    </div>
  `

  const accept = () => applySuggestion(s, el)
  const reject = () => {
    el.classList.add('dismissing')
    el.addEventListener('animationend', () => {
      el.remove()
      _pending = _pending.filter(p => p.cardEl !== el)
    }, { once: true })
  }
  el.querySelector('.audit-accept').addEventListener('click', accept)
  el.querySelector('.audit-dismiss').addEventListener('click', reject)

  return { suggestion: s, cardEl: el, accept, reject }
}

function applySuggestion(suggestion, cardEl) {
  let json
  try {
    json = JSON.parse(document.getElementById('vision-json')?.value || document.getElementById('json-output').value)
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
  const jsonStr = JSON.stringify(json, null, 2)
  document.getElementById('json-output').value = jsonStr
  const visionJson = document.getElementById('vision-json')
  if (visionJson) visionJson.value = jsonStr
  emit('state:loaded', { json })
  cardEl.classList.add('applied')
  cardEl.innerHTML = `
    <div class="audit-card-applied">
      <span class="audit-applied-check" aria-hidden="true">&check;</span>
      <span class="audit-subject">${_esc(_cardSubject(suggestion))}</span>
      <span class="audit-applied-label">Applied</span>
    </div>
  `
  _pending = _pending.filter(p => p.cardEl !== cardEl)
}

function acceptAll() {
  const snapshot = [..._pending]
  for (const item of snapshot) {
    item.accept()
  }
}
