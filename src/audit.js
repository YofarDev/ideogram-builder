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

import { state } from './state.js'
import { emit } from './events.js'
import { showToast } from './toast.js'

let _suggestionsEl, _modelSelect, _runBtn
let _pending = []

export function initAudit() {
  _runBtn = document.getElementById('btn-audit-run')
  _suggestionsEl = document.getElementById('audit-suggestions')
  _modelSelect = document.getElementById('audit-model')
  if (!_runBtn || !_suggestionsEl) return

  _runBtn.addEventListener('click', runAudit)
  document.getElementById('btn-audit-accept-all')?.addEventListener('click', acceptAll)

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

  const body = { image: imageSrc, json: jsonVal, model }
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
  summary.textContent = `${valid.length} suggestion${valid.length !== 1 ? 's' : ''}`
  _suggestionsEl.appendChild(summary)

  const groupLabels = {
    add_element: 'Add element', update_element: 'Update element', update_field: 'Update field',
  }
  let delay = 0
  for (const [key, items] of Object.entries(groups)) {
    if (!items.length) continue
    const header = document.createElement('div')
    header.className = 'audit-group-header'
    header.textContent = groupLabels[key]
    _suggestionsEl.appendChild(header)
    for (const s of items) {
      const card = renderCard(s, currentJson)
      card.cardEl.style.animationDelay = `${delay}ms`
      _suggestionsEl.appendChild(card.cardEl)
      _pending.push(card)
      delay += 40
    }
  }
}

function getOldValue(currentJson, field) {
  const path = field.split('.')
  let cursor = currentJson
  for (const part of path) {
    if (cursor == null || typeof cursor !== 'object') return null
    cursor = cursor[part]
  }
  return cursor
}

function renderCard(s, currentJson) {
  const el = document.createElement('div')
  el.className = 'audit-card'

  let diffHtml = ''
  let codeHtml = ''

  if (s.type === 'add_element') {
    diffHtml = `<div class="audit-card-diff">+ ${s.element.name}</div>`
    codeHtml = `<div class="audit-card-code">${JSON.stringify(s.element, null, 2)}</div>`
  } else if (s.type === 'update_element') {
    const els = currentJson?.compositional_deconstruction?.elements
    const oldEl = els && s.index < els.length ? els[s.index] : null
    const changes = Object.entries(s.patch).map(([k, v]) => {
      const oldVal = oldEl ? JSON.stringify(oldEl[k], null, 0) : '?'
      const newVal = JSON.stringify(v, null, 0)
      return `<span class="diff-old">${oldVal}</span> → <span class="diff-new">${newVal}</span>`
    }).join('\n')
    diffHtml = `<div class="audit-card-diff">#${s.index} ${oldEl?.name || ''}</div>`
    codeHtml = changes ? `<div class="audit-card-code">${changes}</div>` : ''
  } else if (s.type === 'update_field') {
    const oldVal = getOldValue(currentJson, s.field)
    const oldStr = oldVal != null ? JSON.stringify(oldVal, null, 0) : '?'
    diffHtml = `<div class="audit-card-diff">${s.field}</div>`
    codeHtml = `<div class="audit-card-code"><span class="diff-old">${oldStr}</span> → <span class="diff-new">${JSON.stringify(s.value)}</span></div>`
  }

  el.innerHTML = `
    <div class="audit-card-body">
      <div>
        ${diffHtml}
        ${codeHtml}
      </div>
      <div class="audit-card-reason">${s.reason}</div>
    </div>
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
  const actions = cardEl.querySelector('.audit-card-actions')
  if (actions) {
    actions.innerHTML = '<span class="audit-card-badge">&#10003; Applied</span>'
  }
  _pending = _pending.filter(p => p.cardEl !== cardEl)
}

function acceptAll() {
  const snapshot = [..._pending]
  for (const item of snapshot) {
    item.accept()
  }
}
