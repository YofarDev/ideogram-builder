import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state } from '../state.js'
import { emit } from '../events.js'

const DOM_HTML = `
  <div id="lora-list"></div>
  <button id="lora-toggle"><span class="lora-header-icon">▼</span></button>
  <div id="toast-container"></div>
`

let loraModule

beforeEach(async () => {
  document.body.innerHTML = DOM_HTML
  state.loras = []
  localStorage.clear()
  loraModule = await import('../lora.js')
  loraModule.initLora()
})

function cardEl() {
  return document.querySelector('.lora-card')
}

function cardEls() {
  return document.querySelectorAll('.lora-card')
}

describe('lora', () => {
  it('renders LORA cards on init', () => {
    const list = document.getElementById('lora-list')
    expect(list.children.length).toBeGreaterThan(0)
    expect(cardEl()).toBeTruthy()
  })

  it('clicking a card toggles active state via re-queried DOM', () => {
    cardEl().click()
    expect(state.loras.length).toBe(1)
    cardEl().click()
    expect(state.loras.length).toBe(0)
  })

  it('active LoRA is reflected in state.loras', () => {
    cardEl().click()
    expect(state.loras.length).toBe(1)
    expect(state.loras[0].filename).toBeTruthy()
  })

  it('toggling a second LoRA adds to state.loras', () => {
    cardEl().click()
    expect(state.loras.length).toBe(1)
    document.getElementById('lora-toggle').click()
    const cards = cardEls()
    cards[1].click()
    expect(state.loras.length).toBe(2)
  })

  it('deselecting removes from state.loras', () => {
    cardEl().click()
    expect(state.loras.length).toBe(1)
    cardEl().click()
    expect(state.loras.length).toBe(0)
  })

  it('after first toggle list collapses to active-only (1 card)', () => {
    cardEl().click()
    const list = document.getElementById('lora-list')
    expect(list.children.length).toBe(1)
  })

  it('toggling collapse persisted', () => {
    document.getElementById('lora-toggle').click()
    expect(localStorage.getItem('ideogram_lora_collapsed')).toBe('true')
    const icon = document.querySelector('.lora-header-icon')
    expect(icon.textContent).toBe('▶')
  })

  it('canvas:reset clears active LoRAs', () => {
    cardEl().click()
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

  it('moss mode shows only that model entries (built-ins hidden)', () => {
    state.model = 'moss'
    loraModule.initLora()
    const cards = [...document.querySelectorAll('.lora-card')]
    expect(cards.length).toBe(1)
    expect(cards[0].dataset.id).toBe('user-1')
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
    expect(document.querySelectorAll('.lora-card').length).toBe(0)
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
