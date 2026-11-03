import { beforeEach, expect, it, vi } from 'vitest'
import { state } from '../state.js'
import { setCapabilities } from '../moss-presets.js'
import { captureMossConfig, restoreMoss } from '../session-moss.js'
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

it.each([undefined, false, true])('restores saved enhancement %s instead of inheriting it', saved => {
  document.body.innerHTML = '<input type="checkbox" id="moss-enhance-caption" checked>'
  state.moss.enhanceCaption = true
  restoreMoss({ model: 'moss', moss: { enhance: saved } })
  expect(state.moss.enhanceCaption).toBe(saved === true)
  expect(document.getElementById('moss-enhance-caption').checked).toBe(saved === true)
})

it('captures the custom cfg in the session config', () => {
  document.body.dataset.model = 'moss'
  state.moss.cfg = 4.2
  expect(captureMossConfig().mossCfg).toBe(4.2)
  state.moss.cfg = null
  expect(captureMossConfig().mossCfg).toBe(null)
})

it('restores a saved custom cfg into state, input and localStorage', () => {
  document.body.innerHTML = '<input type="number" id="moss-cfg">'
  restoreMoss({ model: 'moss', mossPreset: 'Fast', mossCfg: 3.2 })
  expect(state.moss.cfg).toBe(3.2)
  expect(document.getElementById('moss-cfg').value).toBe('3.2')
  expect(localStorage.getItem('ideogram_moss_cfg')).toBe('3.2')
})

it('clearing the saved cfg resets to the preset default', () => {
  document.body.innerHTML = '<input type="number" id="moss-cfg" value="3.2">'
  state.moss.cfg = 3.2
  localStorage.setItem('ideogram_moss_cfg', '3.2')
  restoreMoss({ model: 'moss', mossPreset: 'Fast', mossCfg: null })
  expect(state.moss.cfg).toBe(null)
  expect(document.getElementById('moss-cfg').value).toBe('')
  expect(localStorage.getItem('ideogram_moss_cfg')).toBe('')
})
