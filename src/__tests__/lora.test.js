import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state } from '../state.js'
import { emit } from '../events.js'

const DOM_HTML = `
  <div id="lora-list"></div>
  <button id="lora-toggle"><span class="lora-header-icon">▼</span></button>
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
