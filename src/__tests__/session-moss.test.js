import { beforeEach, expect, it, vi } from 'vitest'
import { state } from '../state.js'
import { setCapabilities } from '../moss-presets.js'
import { restoreMoss } from '../session-moss.js'
import { resetAllListeners } from '../events.js'
import { showToast } from '../toast.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('ideogram_backend', 'modal')
  document.body.innerHTML = ''
  resetAllListeners()
  vi.clearAllMocks()
  state.moss = { preset: 'Fast', promptMode: 'layout' }
  setCapabilities(null, 'modal')
})

it('restores Rapid on startup without declaring unknown Modal capabilities unavailable', () => {
  expect(restoreMoss({ model: 'moss', mossPreset: 'Rapid' })).toBe(true)
  expect(state.moss.preset).toBe('Rapid')
  expect(showToast).not.toHaveBeenCalled()
})

it('still warns when known Modal capabilities exclude the saved recipe', () => {
  setCapabilities({ presets: [{ id: 'Fast' }] }, 'modal')
  restoreMoss({ model: 'moss', mossPreset: 'Rapid' })
  expect(state.moss.preset).toBe('Rapid')
  expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Rapid'), 'error', 5000)
})
