import { describe, it, expect, beforeEach } from 'vitest'
import { state, getBox, nextBoxId, MODE_PHOTO, MODE_ARTSTYLE } from '../state.js'

beforeEach(() => {
  state.boxes = []
  state.selectedBoxId = null
  state.boxCounter = 0
})

describe('state', () => {
  it('starts with default canvas dimensions', () => {
    expect(state.canvas).toEqual({ width: 1024, height: 1024, scale: 1, maxDisplayHeight: 800 })
  })

  it('starts with empty boxes and palette', () => {
    expect(state.boxes).toEqual([])
    expect(state.globalPalette).toEqual([])
  })

  it('defaults to artstyle mode', () => {
    expect(state.photoArtMode).toBe(MODE_ARTSTYLE)
  })
})

describe('getBox', () => {
  it('returns a box by id', () => {
    const box = { id: 'box_0', label: 'test' }
    state.boxes.push(box)
    expect(getBox('box_0')).toBe(box)
  })

  it('returns undefined for missing box', () => {
    expect(getBox('nonexistent')).toBeUndefined()
  })
})

describe('nextBoxId', () => {
  it('returns sequential ids', () => {
    expect(nextBoxId()).toBe('box_0')
    expect(nextBoxId()).toBe('box_1')
    expect(nextBoxId()).toBe('box_2')
  })

  it('increments boxCounter', () => {
    nextBoxId()
    expect(state.boxCounter).toBe(1)
  })
})
