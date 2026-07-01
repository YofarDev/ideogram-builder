import { describe, it, expect, vi, beforeEach } from 'vitest'
import { currentBackend } from '../backend.js'

beforeEach(() => {
  localStorage.clear()
})

describe('currentBackend', () => {
  it('defaults to runpod', () => {
    expect(currentBackend()).toBe('runpod')
  })

  it('returns modal when localStorage key is set', () => {
    localStorage.setItem('ideogram_backend', 'modal')
    expect(currentBackend()).toBe('modal')
  })

  it('returns runpod for unknown values', () => {
    localStorage.setItem('ideogram_backend', 'something-else')
    expect(currentBackend()).toBe('runpod')
  })
})

describe('runJob', () => {
  it('delegates to runpod by default', async () => {
    vi.resetModules()
    vi.doMock('../runpod.js', () => ({
      runJob: vi.fn(async () => ({ dataUrl: 'data:png', imageUrl: 'blob:x' })),
    }))
    vi.doMock('../modal.js', () => ({
      runJob: vi.fn(),
    }))
    const { runJob } = await import('../backend.js')
    const result = await runJob({ importJson: '{}', width: 1024, height: 1024 })
    expect(result.dataUrl).toBe('data:png')
  })

  it('delegates to modal when backend is modal', async () => {
    localStorage.setItem('ideogram_backend', 'modal')
    vi.resetModules()
    vi.doMock('../runpod.js', () => ({
      runJob: vi.fn(),
    }))
    vi.doMock('../modal.js', () => ({
      runJob: vi.fn(async () => ({ dataUrl: 'data:png;base64,AA', imageUrl: 'blob:y' })),
    }))
    const { runJob } = await import('../backend.js')
    const result = await runJob({ importJson: '{}', width: 1024, height: 1024 })
    expect(result.dataUrl).toBe('data:png;base64,AA')
  })
})
