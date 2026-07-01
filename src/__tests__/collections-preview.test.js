import { describe, it, expect } from 'vitest'
import { elementsToRects } from '../collections-preview.js'

describe('elementsToRects', () => {
  it('returns empty array for non-array input', () => {
    expect(elementsToRects(null)).toEqual([])
    expect(elementsToRects(undefined)).toEqual([])
    expect(elementsToRects({})).toEqual([])
  })

  it('returns empty array for empty elements', () => {
    expect(elementsToRects([])).toEqual([])
  })

  it('drops elements without bbox', () => {
    expect(elementsToRects([{ desc: 'x' }])).toEqual([])
  })

  it('drops elements with short bbox', () => {
    expect(elementsToRects([{ bbox: [1, 2, 3] }])).toEqual([])
  })

  it('scales a normal bbox to the given size', () => {
    const el = { type: 'obj', desc: 'a cat', bbox: [100, 150, 700, 500], color_palette: ['#aaa'] }
    const rects = elementsToRects([el], 200)
    expect(rects).toHaveLength(1)
    expect(rects[0].x).toBe(30)   // 150/1000*200
    expect(rects[0].y).toBe(20)   // 100/1000*200
    expect(rects[0].w).toBe(70)   // (500-150)/1000*200
    expect(rects[0].h).toBe(120)  // (700-100)/1000*200
    expect(rects[0].idx).toBe(0)
    expect(rects[0].type).toBe('obj')
    expect(rects[0].desc).toBe('a cat')
    expect(rects[0].colors).toEqual(['#aaa'])
  })

  it('defaults size to 1000', () => {
    const el = { bbox: [0, 0, 500, 500] }
    const rects = elementsToRects([el])
    expect(rects[0].w).toBe(500)
    expect(rects[0].h).toBe(500)
  })

  it('normalizes inverted bbox (x2 < x1, y2 < y1)', () => {
    const el = { bbox: [700, 500, 100, 150] }
    const rects = elementsToRects([el], 1000)
    expect(rects[0].x).toBe(150)
    expect(rects[0].y).toBe(100)
    expect(rects[0].w).toBe(350)
    expect(rects[0].h).toBe(600)
  })

  it('carries text fields for text elements', () => {
    const el = { type: 'text', text: 'Hello', bbox: [0, 0, 100, 200] }
    const rects = elementsToRects([el], 1000)
    expect(rects[0].text).toBe('Hello')
    expect(rects[0].type).toBe('text')
  })

  it('handles elements with no color_palette', () => {
    const el = { bbox: [0, 0, 100, 100] }
    const rects = elementsToRects([el])
    expect(rects[0].colors).toEqual([])
  })
})
