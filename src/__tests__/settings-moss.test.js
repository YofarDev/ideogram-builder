import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state, MODEL_IDEOGRAM, MODEL_MOSS, MODE_ARTSTYLE, MODE_PHOTO } from '../state.js'
import { resetAllListeners, emit } from '../events.js'
import { showToast } from '../toast.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const DOM_HTML = `
  <div>
    <input id="high_level_description" value="A sunset">
    <input id="background" value="misty pines">
    <input id="medium" value="illustration">
    <input id="art_style" value="watercolor">
    <input id="aesthetics" value="calm">
    <input id="lighting" value="soft light">
    <textarea id="moss-caption"></textarea>
    <input id="moss-meta">
    <select id="moss-canvas"><option value=""></option><option value="single">single</option></select>
    <textarea id="moss-negative">nsfw, worst quality</textarea>
    <input type="radio" name="moss_prompt_mode" value="layout" checked>
    <input type="radio" name="moss_prompt_mode" value="caption">
  </div>
`

beforeEach(() => {
  showToast.mockClear()
  document.body.innerHTML = DOM_HTML
  delete document.body.dataset.mossPrompt
  state.model = MODEL_IDEOGRAM
  state.moss = { promptMode: 'layout', preset: 'Fast' }
  state.photoArtMode = MODE_ARTSTYLE
  localStorage.clear()
  resetAllListeners()
})

async function init() {
  const mod = await import('../settings-moss.js')
  mod.initSettingsMoss()
  return mod
}

describe('settings-moss', () => {
  it('caption-mode radio sets body attribute and state', async () => {
    await init()
    const radio = document.querySelector('input[name="moss_prompt_mode"][value="caption"]')
    radio.checked = true
    radio.dispatchEvent(new Event('change'))
    expect(state.moss.promptMode).toBe('caption')
    expect(document.body.dataset.mossPrompt).toBe('caption')
  })

  it('MOSS inputs emit state:changed', async () => {
    await init()
    let changed = 0
    const { on } = await import('../events.js')
    on('state:changed', () => changed++)
    document.getElementById('moss-caption').dispatchEvent(new Event('input'))
    document.getElementById('moss-meta').dispatchEvent(new Event('input'))
    expect(changed).toBe(2)
  })

  it('seeds MOSS fields from Ideogram on switch when the caption is empty (D4)', async () => {
    await init()
    emit('model:changed', { model: MODEL_MOSS, previous: MODEL_IDEOGRAM })
    expect(document.getElementById('moss-caption').value).toBe('A sunset misty pines')
    expect(document.getElementById('moss-meta').value).toBe('illustration, calm, soft light, watercolor')
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Converted Ideogram fields to MOSS'), expect.anything())
  })

  it('never overwrites a non-empty MOSS caption', async () => {
    await init()
    document.getElementById('moss-caption').value = 'already here'
    emit('model:changed', { model: MODEL_MOSS, previous: MODEL_IDEOGRAM })
    expect(document.getElementById('moss-caption').value).toBe('already here')
    expect(showToast).not.toHaveBeenCalled()
  })

  it('does not seed from empty Ideogram fields', async () => {
    document.getElementById('high_level_description').value = ''
    document.getElementById('background').value = ''
    document.getElementById('medium').value = ''
    document.getElementById('art_style').value = ''
    document.getElementById('aesthetics').value = ''
    document.getElementById('lighting').value = ''
    await init()
    emit('model:changed', { model: MODEL_MOSS, previous: MODEL_IDEOGRAM })
    expect(document.getElementById('moss-caption').value).toBe('')
    expect(showToast).not.toHaveBeenCalled()
  })

  it('seeds empty Ideogram fields from MOSS on the reverse switch', async () => {
    document.getElementById('high_level_description').value = ''
    document.getElementById('medium').value = ''
    document.getElementById('aesthetics').value = ''
    document.getElementById('moss-caption').value = 'A poster'
    document.getElementById('moss-meta').value = 'poster, illustration'
    await init()
    emit('model:changed', { model: MODEL_IDEOGRAM, previous: MODEL_MOSS })
    expect(document.getElementById('high_level_description').value).toBe('A poster')
    expect(document.getElementById('medium').value).toBe('illustration')
    expect(document.getElementById('aesthetics').value).toBe('poster')
  })

  it('never overwrites a non-empty Ideogram description on the reverse switch', async () => {
    document.getElementById('moss-caption').value = 'A poster'
    await init()
    emit('model:changed', { model: MODEL_IDEOGRAM, previous: MODEL_MOSS })
    expect(document.getElementById('high_level_description').value).toBe('A sunset')
    expect(showToast).not.toHaveBeenCalled()
  })

  it('photo mode maps #art_style into the photo slot of the converter', async () => {
    state.photoArtMode = MODE_PHOTO
    document.getElementById('medium').value = 'photograph'
    await init()
    emit('model:changed', { model: MODEL_MOSS, previous: MODEL_IDEOGRAM })
    expect(document.getElementById('moss-meta').value).toBe('photograph, calm, soft light, watercolor')
  })

  it('state:loaded with a moss payload fills the MOSS inputs', async () => {
    await init()
    emit('state:loaded', {
      json: { high_level_description: 'x' },
      moss: { caption: 'A fox', meta: ['poster'], canvas: 'single', palette: ['#FFF'] },
    })
    expect(document.getElementById('moss-caption').value).toBe('A fox')
    expect(document.getElementById('moss-meta').value).toBe('poster')
    expect(document.getElementById('moss-canvas').value).toBe('single')
    expect(document.getElementById('moss-negative').value).toBe('nsfw, worst quality')
  })

  it('state:loaded without a moss payload leaves the inputs alone', async () => {
    await init()
    emit('state:loaded', { json: { high_level_description: 'x' } })
    expect(document.getElementById('moss-caption').value).toBe('')
  })
})
