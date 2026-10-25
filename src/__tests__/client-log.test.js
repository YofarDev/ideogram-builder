import { describe, it, expect, vi, afterEach } from 'vitest'
import { logError } from '../client-log.js'

afterEach(() => vi.unstubAllGlobals())

describe('logError', () => {
  it('POSTs level/message/context to /api/log', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    logError('Generation failed: boom', { model: 'moss' })
    expect(fetchMock).toHaveBeenCalledWith('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'error', message: 'Generation failed: boom', context: { model: 'moss' } }),
    })
  })

  it('never throws when the log POST fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await logError('boom')
    await new Promise(r => setTimeout(r, 0)) // let the rejected promise settle
  })
})
