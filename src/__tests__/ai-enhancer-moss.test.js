import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetAllListeners, on } from '../events.js'
import { mossSystemPrompt, mossUserPrompt, applyMossEnhanceResult } from '../ai-enhancer-moss.js'

const DRAFT = JSON.stringify({
  width: 1024, height: 1024, bbox_coord_space: 'abs', bbox_format: 'xyxy',
  summary: { caption: 'A fox' },
  items: [{ label: 'object', caption: 'd', bbox: [0, 0, 512, 512] }],
})

beforeEach(() => {
  resetAllListeners()
})

describe('mossSystemPrompt', () => {
  it('layout prompt asks for the draft form (abs/xyxy top-left pixels)', () => {
    const p = mossSystemPrompt('layout')
    expect(p).toContain('"bbox_coord_space":"abs"')
    expect(p).toContain('"bbox_format":"xyxy"')
    expect(p).toContain('object|character|text')
    expect(p).toContain('TOP-LEFT')
    expect(p).toContain('multiples of 16')
  })

  it('caption prompt asks for a single prose paragraph', () => {
    const p = mossSystemPrompt('caption')
    expect(p).toContain('single prose paragraph')
    expect(p).not.toContain('bbox_coord_space')
  })
})

describe('mossUserPrompt', () => {
  it('layout carries the pixel canvas size', () => {
    expect(mossUserPrompt('a fox', 'layout', { width: 768, height: 1152 }))
      .toContain('768\u00d71152 pixels')
  })

  it('caption is just the idea', () => {
    expect(mossUserPrompt('a fox', 'caption', { width: 1024, height: 1024 }))
      .toBe('User idea: a fox')
  })
})

describe('applyMossEnhanceResult', () => {
  it('valid draft emits prompt:apply with the raw content', () => {
    const applied = []
    on('prompt:apply', ({ raw }) => applied.push(raw))
    expect(applyMossEnhanceResult(DRAFT, 'layout')).toEqual({ ok: true })
    expect(applied).toEqual([DRAFT])
  })

  it('non-JSON draft is rejected with a clear error', () => {
    expect(applyMossEnhanceResult('not json', 'layout').error).toContain('Invalid JSON')
  })

  it('JSON without MOSS shape is rejected', () => {
    expect(applyMossEnhanceResult('{"foo":1}', 'layout').error).toContain('MOSS summary/items')
  })

  it('caption mode emits the trimmed text', () => {
    const applied = []
    on('prompt:apply', ({ raw }) => applied.push(raw))
    expect(applyMossEnhanceResult('  A red fox in snow.  ', 'caption')).toEqual({ ok: true })
    expect(applied).toEqual(['A red fox in snow.'])
  })

  it('empty caption is rejected', () => {
    expect(applyMossEnhanceResult('   ', 'caption').error).toContain('Empty response')
  })
})
