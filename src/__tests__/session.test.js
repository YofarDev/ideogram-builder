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
