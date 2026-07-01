import { describe, it, expect, beforeEach, vi } from 'vitest'
import { showToast } from '../toast.js'

beforeEach(() => {
  document.body.innerHTML = '<div id="toast-container"></div>'
})

describe('showToast', () => {
  it('creates a toast element in the container', () => {
    showToast('Hello')
    const container = document.getElementById('toast-container')
    expect(container.children.length).toBe(1)
    expect(container.children[0].textContent).toBe('Hello')
  })

  it('adds toast-type class for non-info types', () => {
    showToast('Error', 'error')
    const toast = document.querySelector('.toast-error')
    expect(toast).toBeTruthy()
    expect(toast.textContent).toBe('Error')
  })

  it('default type info has no extra class', () => {
    showToast('Info')
    const toast = document.querySelector('.toast')
    expect(toast.classList.length).toBe(1)
  })

  it('removes toast after duration + animation', () => {
    vi.useFakeTimers()
    showToast('Temp', 'info', 100)
    const container = document.getElementById('toast-container')
    expect(container.children.length).toBe(1)
    vi.advanceTimersByTime(100)
    const toast = container.children[0]
    expect(toast.classList.contains('toast-out')).toBe(true)
    toast.dispatchEvent(new Event('animationend'))
    expect(container.children.length).toBe(0)
    vi.useRealTimers()
  })
})
