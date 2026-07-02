import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { state, MODE_PHOTO, MODE_ARTSTYLE } from '../state.js'
import { emit, resetAllListeners } from '../events.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

let session

beforeEach(async () => {
  localStorage.clear()
  session = await import('../session.js?fresh=' + Date.now())
})

describe('loadSession / writeSession', () => {
  it('loadSession returns null when nothing stored', () => {
    expect(session.loadSession()).toBeNull()
  })

  it('writeSession then loadSession round-trips a blob', () => {
    const blob = {
      version: 1,
      content: '{"high_level_description":"x"}',
      config: { size: '2', steps: 'Quality', mode: 'photo', seed: 42, aspectRatio: '1024x1024', aiModel: 'deepseek::m', visionModel: '', recaptionModel: '' },
      ui: { tab: 'gallery', preview: false },
    }
    session.writeSession(blob)
    expect(session.loadSession()).toEqual(blob)
  })

  it('loadSession returns null on corrupt JSON', () => {
    localStorage.setItem('ideogram_session', '{not json')
    expect(session.loadSession()).toBeNull()
  })

  it('writeSession swallows quota errors', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    expect(() => session.writeSession({ version: 1, content: null, config: {}, ui: {} })).not.toThrow()
    vi.restoreAllMocks()
  })

  it('writeSession stamps the current VERSION', () => {
    session.writeSession({ version: 999, content: null, config: {}, ui: {} })
    expect(session.loadSession().version).toBe(1)
  })
})

const SNAPSHOT_DOM = `
  <textarea id="json-output">{"high_level_description":"hi"}</textarea>
  <select id="aspect-ratio"><option value="768x1152" selected>2:3</option><option value="1024x1024">1:1</option></select>
  <button class="size-btn" data-size="1">1M</button>
  <button class="size-btn active" data-size="2">2M</button>
  <input type="radio" name="steps" data-preset="Turbo">
  <input type="radio" name="steps" data-preset="Quality" checked>
  <input type="radio" id="mode_photo" name="art_mode" value="photo" checked>
  <input type="radio" id="mode_artstyle" name="art_mode" value="art_style">
  <input type="number" id="seed-input" value="12345">
  <select id="ai-model"><option value="deepseek::deepseek-chat">d</option></select>
  <select id="vision-model"><option value="local">local</option></select>
  <select id="recaption-model"><option value="">None</option></select>
  <button class="tab-btn" data-tab="prompt">Prompt</button>
  <button class="tab-btn active" data-tab="gallery">Gallery</button>
  <div class="main-content"><button id="btn-preview" class="active"></button></div>
`

describe('captureSnapshot', () => {
  beforeEach(() => {
    document.body.innerHTML = SNAPSHOT_DOM
  })

  it('reads content, config, and ui from the DOM', () => {
    const snap = session.captureSnapshot()
    expect(snap.content).toBe('{"high_level_description":"hi"}')
    expect(snap.config).toEqual({
      size: '2',
      steps: 'Quality',
      mode: 'photo',
      seed: 12345,
      aspectRatio: '768x1152',
      aiModel: 'deepseek::deepseek-chat',
      visionModel: 'local',
      recaptionModel: '',
    })
    expect(snap.ui).toEqual({ tab: 'gallery', preview: true })
  })

  it('content is null when json-output is empty', () => {
    document.getElementById('json-output').value = '   '
    expect(session.captureSnapshot().content).toBeNull()
  })

  it('falls back to defaults when controls are absent', () => {
    document.body.innerHTML = ''
    const snap = session.captureSnapshot()
    expect(snap.content).toBeNull()
    expect(snap.config.size).toBe('1')
    expect(snap.config.steps).toBe('Default')
    expect(snap.config.mode).toBe('art_style')
    expect(snap.ui.tab).toBe('editor')
  })
})

const RESTORE_DOM = `
  <textarea id="json-output"></textarea>
  <select id="aspect-ratio">
    <option value="768x1152" selected>2:3</option>
    <option value="1024x1024">1:1</option>
  </select>
  <button class="size-btn active" data-size="1">1M</button>
  <button class="size-btn" data-size="2">2M</button>
  <div class="main-content"><div class="canvas-container"><div id="canvas-wrapper"></div></div></div>
  <img id="canvas-overlay">
`

describe('restore — dimensions + content', () => {
  let canvasModule

  beforeEach(async () => {
    document.body.innerHTML = RESTORE_DOM
    state.boxes = []
    state.selectedBoxId = null
    state.boxCounter = 0
    state.canvas = { width: 768, height: 1152, scale: 1, maxDisplayHeight: 800 }
    resetAllListeners()
    canvasModule = await import('../canvas.js?fresh=' + Date.now())
    canvasModule.initCanvas()
    canvasModule.initCanvasEvents()
    localStorage.clear()
  })

  it('restore is a no-op when no blob is stored', () => {
    session.restore()
    expect(document.getElementById('json-output').value).toBe('')
    expect(state.boxes.length).toBe(0)
  })

  it('sets aspect-ratio value + dispatches change', () => {
    session.writeSession({ version: 1, content: null, config: { aspectRatio: '1024x1024', size: '1' }, ui: {} })
    let changed = false
    document.getElementById('aspect-ratio').addEventListener('change', () => { changed = true })
    session.restore()
    expect(document.getElementById('aspect-ratio').value).toBe('1024x1024')
    expect(changed).toBe(true)
  })

  it('sets the size-btn active state from config.size', () => {
    session.writeSession({ version: 1, content: null, config: { aspectRatio: '1024x1024', size: '2' }, ui: {} })
    session.restore()
    const active = document.querySelector('.size-btn.active')
    expect(active?.dataset.size).toBe('2')
  })

  it('restores content: sets json-output and rebuilds boxes via state:loaded', () => {
    const content = JSON.stringify({
      high_level_description: 'scene',
      compositional_deconstruction: {
        background: 'sky',
        elements: [
          { type: 'obj', bbox: [0, 0, 500, 500], desc: 'cat' },
        ],
      },
    })
    session.writeSession({ version: 1, content, config: { aspectRatio: '1024x1024', size: '1' }, ui: {} })
    session.restore()
    expect(document.getElementById('json-output').value).toBe(content)
    expect(state.boxes.length).toBe(1)
  })

  it('ignores corrupt stored content', () => {
    session.writeSession({ version: 1, content: 'not json', config: { aspectRatio: '1024x1024', size: '1' }, ui: {} })
    expect(() => session.restore()).not.toThrow()
    expect(state.boxes.length).toBe(0)
  })
})

describe('restore — config + model selects + UI', () => {
  beforeEach(() => {
    document.body.innerHTML = RESTORE_DOM + `
      <input type="radio" id="mode_photo" name="art_mode" value="photo">
      <input type="radio" id="mode_artstyle" name="art_mode" value="art_style" checked>
      <input type="number" id="seed-input" value="-1">
      <select id="ai-model"></select>
      <button class="tab-btn active" data-tab="editor">Editor</button>
      <button class="tab-btn" data-tab="prompt">Prompt</button>
      <button id="btn-preview"></button>
    `
    resetAllListeners()
    localStorage.clear()
  })

  it('sets the mode radio checked state', () => {
    session.writeSession({ version: 1, content: null, config: { mode: 'photo' }, ui: {} })
    session.restore()
    expect(document.getElementById('mode_photo').checked).toBe(true)
    expect(document.getElementById('mode_artstyle').checked).toBe(false)
  })

  it('sets seed input value', () => {
    session.writeSession({ version: 1, content: null, config: { seed: 999 }, ui: {} })
    session.restore()
    expect(document.getElementById('seed-input').value).toBe('999')
  })

  it('applies model select value immediately when option exists', () => {
    const sel = document.getElementById('ai-model')
    sel.innerHTML = '<option value="deepseek::m">m</option>'
    session.writeSession({ version: 1, content: null, config: { aiModel: 'deepseek::m' }, ui: {} })
    session.restore()
    expect(sel.value).toBe('deepseek::m')
  })

  it('applies model select value via observer when option added later', async () => {
    const sel = document.getElementById('ai-model')
    session.writeSession({ version: 1, content: null, config: { aiModel: 'google::gemini' }, ui: {} })
    session.restore()
    expect(sel.value).toBe('')
    // Simulate async population from /api/config
    const opt = document.createElement('option')
    opt.value = 'google::gemini'
    sel.appendChild(opt)
    await new Promise((r) => setTimeout(r, 50))
    expect(sel.value).toBe('google::gemini')
  })

  it('clicks the saved tab button', () => {
    session.writeSession({ version: 1, content: null, config: {}, ui: { tab: 'prompt' } })
    const promptBtn = document.querySelector('.tab-btn[data-tab="prompt"]')
    const spy = vi.spyOn(promptBtn, 'click')
    session.restore()
    expect(spy).toHaveBeenCalled()
  })

  it('clicks the preview button when saved true', () => {
    session.writeSession({ version: 1, content: null, config: {}, ui: { preview: true } })
    const pvSpy = vi.spyOn(document.getElementById('btn-preview'), 'click')
    session.restore()
    expect(pvSpy).toHaveBeenCalled()
  })

  it('does not click preview when saved false', () => {
    session.writeSession({ version: 1, content: null, config: {}, ui: { preview: false } })
    const pvSpy = vi.spyOn(document.getElementById('btn-preview'), 'click')
    session.restore()
    expect(pvSpy).not.toHaveBeenCalled()
  })
})

describe('restore — state sync via settings handlers', () => {
  // Minimal DOM containing every element settings.initSettings() touches at
  // registration time (top-level getElementById calls) plus the controls the
  // mode/seed/steps handlers mutate. Loaded fresh so real handlers register.
  const STATE_SYNC_DOM = `
    <textarea id="json-output"></textarea>
    <select id="aspect-ratio"><option value="768x1152">2:3</option></select>
    <input type="radio" id="mode_photo" name="art_mode" value="photo">
    <input type="radio" id="mode_artstyle" name="art_mode" value="art_style" checked>
    <span id="mode_label">Art Style</span>
    <input id="box-mode" value="obj">
    <input id="box-text" value="">
    <textarea id="box-desc"></textarea>
    <input id="high_level_description" value="">
    <input id="aesthetics" value="">
    <input id="lighting" value="">
    <input id="medium" value="illustration">
    <input id="art_style" value="">
    <input id="background" value="">
    <input type="radio" name="steps" data-preset="Turbo">
    <input type="radio" name="steps" data-preset="Default" checked>
    <input type="radio" name="steps" data-preset="Quality">
    <input id="turbo-strength" type="range" value="0.8">
    <input id="seed-input" value="-1">
    <button id="btn-random-seed">Random</button>
    <input id="box-x" value="0">
    <input id="box-y" value="0">
    <input id="box-w" value="0">
    <input id="box-h" value="0">
    <button id="btn-reroll-color">Reroll</button>
  `

  beforeAll(() => {
    if (!AbortSignal.timeout) {
      AbortSignal.timeout = () => new AbortController().signal
    }
  })

  beforeEach(async () => {
    document.body.innerHTML = STATE_SYNC_DOM
    state.boxes = []
    state.selectedBoxId = null
    state.boxCounter = 0
    state.seed = -1
    state.preset = 'Default'
    state.photoArtMode = MODE_ARTSTYLE
    resetAllListeners()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    const settings = await import('../settings.js?fresh=' + Date.now())
    settings.initSettings()
  })

  it('syncs seed, steps preset, and photoArtMode to state via settings handlers', () => {
    // content:null is the exact I1 scenario (photoArtMode must not stay ARTSTYLE).
    session.writeSession({
      version: 1,
      content: null,
      config: { mode: 'photo', seed: 999, steps: 'Quality' },
      ui: {},
    })
    session.restore()
    expect(state.seed).toBe(999)
    expect(state.preset).toBe('Quality')
    expect(state.photoArtMode).toBe(MODE_PHOTO)
  })

  it('restores art_style mode + Default preset defaults', () => {
    session.writeSession({
      version: 1,
      content: null,
      config: { mode: 'art_style', seed: 42, steps: 'Default' },
      ui: {},
    })
    session.restore()
    expect(state.seed).toBe(42)
    expect(state.preset).toBe('Default')
    expect(state.photoArtMode).toBe(MODE_ARTSTYLE)
  })
})

describe('wipeContent (reset)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('nulls content while preserving config + ui', () => {
    session.writeSession({
      version: 1,
      content: '{"x":1}',
      config: { size: '2', steps: 'Quality' },
      ui: { tab: 'gallery' },
    })
    session.wipeContent()
    const blob = session.loadSession()
    expect(blob.content).toBeNull()
    expect(blob.config).toEqual({ size: '2', steps: 'Quality' })
    expect(blob.ui).toEqual({ tab: 'gallery' })
  })

  it('is a no-op when no blob exists', () => {
    expect(() => session.wipeContent()).not.toThrow()
    expect(session.loadSession()).toBeNull()
  })
})

describe('initSession wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = `
      <textarea id="json-output">{"a":1}</textarea>
      <select id="aspect-ratio"><option value="768x1152" selected>2:3</option></select>
      <button class="size-btn active" data-size="1">1M</button>
      <div class="main-content"></div>
      <button class="tab-btn active" data-tab="editor">Editor</button>
    `
    resetAllListeners()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces save on state:changed (400ms)', () => {
    session.initSession()
    emit('state:changed')
    expect(session.loadSession()).toBeNull() // not yet
    vi.advanceTimersByTime(400)
    expect(session.loadSession().content).toBe('{"a":1}')
  })

  it('coalesces rapid state:changed into one save', () => {
    session.initSession()
    emit('state:changed')
    vi.advanceTimersByTime(200)
    emit('state:changed')
    vi.advanceTimersByTime(200)
    // first emit's 400ms hasn't fully elapsed when second reset the clock;
    // only one write happens after the full debounce window
    emit('state:changed')
    vi.advanceTimersByTime(400)
    expect(session.loadSession().content).toBe('{"a":1}')
  })

  it('flushes immediately on pagehide', () => {
    session.initSession()
    emit('state:changed')
    window.dispatchEvent(new Event('pagehide'))
    expect(session.loadSession().content).toBe('{"a":1}')
  })

  it('flushes on visibilitychange to hidden', () => {
    session.initSession()
    emit('state:changed')
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(session.loadSession().content).toBe('{"a":1}')
  })

  it('canvas:reset wipes content only after restore armed the guard', () => {
    session.writeSession({ version: 1, content: '{"keep":1}', config: {}, ui: {} })
    session.initSession() // restore runs → armed = true
    emit('canvas:reset')
    expect(session.loadSession().content).toBeNull()
    expect(session.loadSession().config).toEqual({})
  })

  it('canvas:reset before initSession does not wipe (startup guard)', () => {
    session.writeSession({ version: 1, content: '{"keep":1}', config: {}, ui: {} })
    // initCanvas() emits canvas:reset at startup, BEFORE initSession registers the listener.
    // Simulate: emit canvas:reset with no listener yet.
    emit('canvas:reset')
    session.initSession()
    expect(session.loadSession().content).toBe('{"keep":1}')
  })
})
