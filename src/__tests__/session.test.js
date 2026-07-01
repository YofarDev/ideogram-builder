import { describe, it, expect, beforeEach, vi } from 'vitest'

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
      ui: { tab: 'gallery', fullscreen: true, preview: false },
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
  <div class="main-content draw-fullscreen"><button id="btn-preview" class="active"></button></div>
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
    expect(snap.ui).toEqual({ tab: 'gallery', fullscreen: true, preview: true })
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
