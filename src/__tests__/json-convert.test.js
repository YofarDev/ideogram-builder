import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state, MODEL_IDEOGRAM, MODEL_MOSS } from '../state.js'
import { resetAllListeners, on, emit } from '../events.js'
import { ideogramToMoss, mossToIdeogram } from '../prompt-convert.js'
import { convertPromptText, initJsonConvert } from '../json-convert.js'
import { showToast } from '../toast.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const IDEOGRAM = {
  high_level_description: 'A travel poster',
  style_description: {
    aesthetics: 'minimal, flat',
    lighting: 'soft daylight',
    medium: 'graphic_design',
    art_style: 'swiss poster',
    color_palette: ['#F3E9D2'],
  },
  compositional_deconstruction: {
    background: 'A cream backdrop.',
    elements: [
      // top-layer-first, as the editor emits them
      { type: 'text', bbox: [94, 125, 219, 875], text: 'EXPLORE', desc: 'Large title' },
      { type: 'obj', bbox: [312, 219, 875, 781], desc: 'Mountains', color_palette: ['#2B4C7E'] },
      { type: 'obj', desc: 'no bbox — dropped' },
    ],
  },
}

beforeEach(() => {
  resetAllListeners()
  vi.mocked(showToast).mockClear()
  state.canvas.width = 1024
  state.canvas.height = 1024
  state.model = MODEL_IDEOGRAM
  document.body.innerHTML = `
    <textarea id="json-output"></textarea>
    <button id="btn-convert-json"></button>`
})

describe('ideogramToMoss', () => {
  it('maps globals, palette and boxes to a centralized yxyx layout', () => {
    const { layout, dropped } = ideogramToMoss(IDEOGRAM, { width: 1024, height: 1024 })
    expect(dropped).toBe(1)
    expect(layout.summary).toEqual({
      meta: ['graphic_design', 'minimal', 'flat', 'soft daylight', 'swiss poster'],
      caption: 'A travel poster A cream backdrop.',
      palette: ['#F3E9D2'],
    })
    expect(layout.bbox_coord_space).toBe('abs_centralized')
    expect(layout.bbox_format).toBe('yxyx')
    // order preserved (top-layer-first)
    expect(layout.items.map(i => i.label)).toEqual(['text', 'object'])
    expect(layout.items[0]).toEqual({
      label: 'text', caption: 'Large title', text: 'EXPLORE',
      bbox: [Math.floor(94 * 1.024) - 512, 128 - 512, Math.ceil(219 * 1.024) - 512, 896 - 512],
    })
    expect(layout.items[1].palette).toEqual(['#2B4C7E'])
  })

  it('un-flips inverted bboxes instead of dropping them', () => {
    const json = { compositional_deconstruction: { elements: [{ type: 'obj', bbox: [0, 1000, 100, 700], desc: 'trunk' }] } }
    const { layout, dropped } = ideogramToMoss(json, { width: 1000, height: 1000 })
    expect(dropped).toBe(0)
    expect(layout.items[0].bbox).toEqual([-500, 200, -400, 500])
  })

  it('uses photo over art_style in photo mode', () => {
    const json = { ...IDEOGRAM, style_description: { medium: 'photograph', photo: '85mm lens' } }
    expect(ideogramToMoss(json, { width: 1024, height: 1024 }).layout.summary.meta).toEqual(['photograph', '85mm lens'])
  })
})

describe('mossToIdeogram', () => {
  it('round-trips boxes within a rounding step and maps character → obj', () => {
    const { layout } = ideogramToMoss(IDEOGRAM, { width: 1024, height: 1024 })
    layout.items[1].label = 'character'
    layout.items[1].tags = ['peak']
    const back = mossToIdeogram(layout, { width: 1024, height: 1024 })
    expect(back.high_level_description).toBe('A travel poster A cream backdrop.')
    expect(back.style_description.medium).toBe('graphic_design')
    expect(back.style_description.aesthetics).toBe('minimal, flat, soft daylight, swiss poster')
    expect(back.style_description.color_palette).toEqual(['#F3E9D2'])
    const [title, peak] = back.compositional_deconstruction.elements
    expect(title).toMatchObject({ type: 'text', text: 'EXPLORE', desc: 'Large title' })
    expect(peak.type).toBe('obj')
    expect(peak.tags).toBeUndefined()
    IDEOGRAM.compositional_deconstruction.elements.slice(0, 2).forEach((el, i) => {
      back.compositional_deconstruction.elements[i].bbox.forEach((v, j) => {
        expect(Math.abs(v - el.bbox[j])).toBeLessThanOrEqual(1)
      })
    })
  })

  it('reads captioner drafts with their own canvas size', () => {
    const draft = {
      width: 512, height: 512, bbox_coord_space: 'abs', bbox_format: 'xyxy',
      summary: { caption: 'Draft' }, items: [{ label: 'object', caption: 'd', bbox: [128, 128, 384, 384] }],
    }
    const back = mossToIdeogram(draft, { width: 1024, height: 1024 })
    expect(back.compositional_deconstruction.elements[0].bbox).toEqual([250, 250, 750, 750])
  })
})

describe('convertPromptText', () => {
  it('Ideogram → MOSS layout text', () => {
    const r = convertPromptText(JSON.stringify(IDEOGRAM))
    expect(r.target).toBe('moss')
    expect(JSON.parse(r.raw).items).toHaveLength(2)
    expect(r.dropped).toBe(1)
  })

  it('MOSS caption → Ideogram description', () => {
    const r = convertPromptText('A red fox in snow')
    expect(r.target).toBe('ideogram')
    expect(JSON.parse(r.raw).high_level_description).toBe('A red fox in snow')
  })

  it('empty pane → error', () => {
    expect(convertPromptText('  ').error).toMatch(/empty/)
  })
})

describe('Convert button', () => {
  it('emits prompt:apply with the converted prompt and toasts', () => {
    initJsonConvert()
    const applied = []
    on('prompt:apply', (payload) => applied.push(payload))
    document.getElementById('json-output').value = JSON.stringify(IDEOGRAM)
    const btn = document.getElementById('btn-convert-json')
    btn.dispatchEvent(new Event('pointerdown'))
    btn.click()
    expect(applied).toHaveLength(1)
    // quiet: the convert toast replaces json-builder's "Switched to …" toast
    expect(applied[0].quiet).toBe(true)
    expect(JSON.parse(applied[0].raw).summary.caption).toBe('A travel poster A cream backdrop.')
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/Converted to MOSS layout/), 'info')
  })

  it('builds the MOSS layout for the canvas size after the model switch (4M → 2M)', () => {
    initJsonConvert()
    state.canvas.width = 2048
    state.canvas.height = 2048
    // Stand-in for model.js + settings.js: switching to MOSS drops the 4M tier
    on('model:set', ({ model }) => {
      state.model = model
      state.canvas.width = 1024
      state.canvas.height = 1024
    })
    const applied = []
    on('prompt:apply', (payload) => applied.push(payload))
    document.getElementById('json-output').value = JSON.stringify(IDEOGRAM)
    const btn = document.getElementById('btn-convert-json')
    btn.dispatchEvent(new Event('pointerdown'))
    btn.click()
    const { layout } = ideogramToMoss(IDEOGRAM, { width: 1024, height: 1024 })
    expect(JSON.parse(applied[0].raw).items.map(i => i.bbox)).toEqual(layout.items.map(i => i.bbox))
  })

  it('title follows the active model', () => {
    initJsonConvert()
    expect(document.getElementById('btn-convert-json').title).toBe('Convert to MOSS layout')
    state.model = MODEL_MOSS
    emit('model:changed', { model: MODEL_MOSS, previous: MODEL_IDEOGRAM })
    expect(document.getElementById('btn-convert-json').title).toBe('Convert to Ideogram JSON')
  })
})
