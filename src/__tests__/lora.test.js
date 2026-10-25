import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state } from '../state.js'
import { emit } from '../events.js'
import { BUILTIN_LORAS } from '../lora-library.js'

const DOM_HTML = `
  <button id="btn-lora" aria-expanded="false">LoRA<span id="lora-badge" hidden>0</span></button>
  <div id="lora-panel" hidden>
    <input type="search" id="lora-search">
    <div id="lora-active"></div>
    <span id="lora-library-count"></span>
    <div id="lora-list"></div>
  </div>
  <div id="outside"></div>
  <div id="toast-container"></div>
`

let loraModule

beforeEach(async () => {
  document.body.innerHTML = DOM_HTML
  state.loras = []
  state.model = 'ideogram'
  localStorage.clear()
  loraModule = await import('../lora.js')
  loraModule.initLora()
})

function libraryCards() {
  return document.querySelectorAll('#lora-list .lora-card')
}

function activeCards() {
  return document.querySelectorAll('#lora-active .lora-card')
}

describe('lora', () => {
  it('renders library cards on init, none active', () => {
    expect(libraryCards().length).toBeGreaterThan(0)
    expect(activeCards().length).toBe(0)
    expect(document.getElementById('lora-badge').hidden).toBe(true)
  })

  it('clicking a library card activates it and moves it to the active stack', () => {
    const id = libraryCards()[0].dataset.id
    libraryCards()[0].click()
    expect(state.loras.length).toBe(1)
    expect(activeCards()[0].dataset.id).toBe(id)
    expect(document.querySelector(`#lora-list .lora-card[data-id="${id}"]`)).toBeNull()
  })

  it('clicking an active card deactivates it', () => {
    libraryCards()[0].click()
    activeCards()[0].click()
    expect(state.loras.length).toBe(0)
    expect(activeCards().length).toBe(0)
  })

  it('stacks LoRAs in click order and badges the count', () => {
    const first = libraryCards()[1].dataset.id
    libraryCards()[1].click()
    const second = libraryCards()[0].dataset.id
    libraryCards()[0].click()
    expect(state.loras.length).toBe(2)
    expect([...activeCards()].map(c => c.dataset.id)).toEqual([first, second])
    const badge = document.getElementById('lora-badge')
    expect(badge.hidden).toBe(false)
    expect(badge.textContent).toBe('2')
  })

  it('strength slider updates the active entry in state.loras', () => {
    libraryCards()[0].click()
    const range = document.querySelector('#lora-active .lora-strength-range')
    range.value = '0.65'
    range.dispatchEvent(new Event('input', { bubbles: true }))
    expect(state.loras[0].strengths.positive).toBe(0.65)
    expect(activeCards().length).toBe(1)
  })

  it('search filters the library; Enter activates the first match', () => {
    const target = BUILTIN_LORAS.find(b => b.model === 'ideogram')
    const search = document.getElementById('lora-search')
    search.value = target.label.slice(0, 6)
    search.dispatchEvent(new Event('input'))
    const shown = [...libraryCards()].map(c => c.dataset.id)
    expect(shown).toContain(target.id)
    expect(shown.length).toBeLessThan(BUILTIN_LORAS.filter(b => b.model === 'ideogram').length)
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(activeCards()[0].dataset.id).toBe(shown[0])
    expect(search.value).toBe('')
  })

  it('button toggles the panel; outside click closes it, inside click does not', () => {
    const panel = document.getElementById('lora-panel')
    document.getElementById('btn-lora').click()
    expect(panel.hidden).toBe(false)
    libraryCards()[0].click()
    expect(panel.hidden).toBe(false)
    document.getElementById('outside').click()
    expect(panel.hidden).toBe(true)
  })

  it('canvas:reset clears active LoRAs', () => {
    libraryCards()[0].click()
    expect(state.loras.length).toBe(1)
    emit('canvas:reset')
    expect(state.loras.length).toBe(0)
  })
})

describe('per-model library', () => {
  const mossEntry = {
    id: 'user-1',
    label: 'My Moss LoRA',
    model: 'moss',
    filename: 'user/moss/mine.safetensors',
    source_url: null,
    strengths: { positive: 1.0, unconditional: 0.5 },
  }

  beforeEach(() => {
    localStorage.setItem('ideogram_loras_user', JSON.stringify([mossEntry]))
  })

  it('moss mode shows only that model entries (ideogram built-ins hidden)', () => {
    state.model = 'moss'
    loraModule.initLora()
    const ids = [...document.querySelectorAll('.lora-card')].map(c => c.dataset.id)
    const builtinIds = BUILTIN_LORAS.filter(b => b.model === 'moss').map(b => b.id)
    expect(ids).toEqual([...builtinIds, 'user-1'])
  })

  it('ideogram mode hides moss entries', () => {
    state.model = 'ideogram'
    loraModule.initLora()
    const ids = [...document.querySelectorAll('.lora-card')].map(c => c.dataset.id)
    expect(ids).not.toContain('user-1')
    expect(ids.length).toBeGreaterThan(0)
  })

  it('user entries serialize into state.loras on activation', () => {
    state.model = 'moss'
    loraModule.initLora()
    document.querySelector('.lora-card[data-id="user-1"]').click()
    expect(state.loras).toEqual([{
      filename: 'user/moss/mine.safetensors',
      source_url: null,
      strengths: { positive: 1.0, unconditional: 0.5 },
    }])
  })

  it('delete removes a user entry from localStorage and the panel', () => {
    state.model = 'moss'
    loraModule.initLora()
    document.querySelector('.lora-card-delete[data-id="user-1"]').click()
    expect(localStorage.getItem('ideogram_loras_user')).toBe('[]')
    const ids = [...document.querySelectorAll('.lora-card')].map(c => c.dataset.id)
    const builtinIds = BUILTIN_LORAS.filter(b => b.model === 'moss').map(b => b.id)
    expect(ids).toEqual(builtinIds)
  })

  it('model:changed drops active LoRAs of the other model', () => {
    state.model = 'ideogram'
    loraModule.initLora()
    document.querySelector('.lora-card').click()
    expect(state.loras.length).toBe(1)
    emit('model:changed', { model: 'moss', previous: 'ideogram' })
    expect(state.loras).toEqual([])
  })

  it('restoreLorasFromMeta finds user entries by filename', () => {
    state.model = 'moss'
    loraModule.initLora()
    loraModule.restoreLorasFromMeta([{
      filename: 'user/moss/mine.safetensors',
      strengths: { positive: 0.7, unconditional: 0.4 },
    }])
    expect(state.loras[0].strengths.positive).toBe(0.7)
    const card = document.querySelector('.lora-card[data-id="user-1"]')
    expect(card.classList.contains('active')).toBe(true)
  })
})
