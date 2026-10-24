import { describe, it, expect } from 'vitest'
import { buildMossLayout, compileMoss, parseMoss, isMossJson, isMossDraft } from '../prompt-moss.js'

// The EXPLORE poster from the MOSS-Image docs — the canonical layout example.
const EXPLORE = {
  summary: {
    meta: ['poster'],
    canvas: 'single',
    caption: 'A minimalist travel poster of a flat blue mountain range on a warm cream background.',
    palette: ['#F3E9D2'],
  },
  items: [
    { label: 'text', caption: 'Large dark-blue title centered at the top.', text: 'EXPLORE', bbox: [-416, -384, -288, 384] },
    { label: 'object', caption: 'A flat blue mountain illustration.', bbox: [-192, -288, 384, 288], palette: ['#2B4C7E'] },
  ],
  bbox_coord_space: 'abs_centralized',
  bbox_format: 'yxyx',
}

// Editor boxes (0–1000 x/y/w/h, bottom→top) reverse-derived from EXPLORE's
// centralized coords at 1024×1024: editor = (centralized + half) / size * 1000.
const EXPLORE_BOXES = [
  { mode: 'obj', x: 218.75, y: 312.5, w: 562.5, h: 562.5, desc: 'A flat blue mountain illustration.', text: '', colors: ['#2B4C7E'], tags: [] },
  { mode: 'text', x: 125, y: 93.75, w: 750, h: 125, desc: 'Large dark-blue title centered at the top.', text: 'EXPLORE', colors: [], tags: [] },
]

// The same layout in captioner draft form (abs, xyxy, top-left pixels).
const EXPLORE_DRAFT = {
  width: 1024,
  height: 1024,
  bbox_coord_space: 'abs',
  bbox_format: 'xyxy',
  summary: EXPLORE.summary,
  items: [
    { label: 'text', caption: 'Large dark-blue title centered at the top.', text: 'EXPLORE', bbox: [128, 96, 896, 224] },
    { label: 'object', caption: 'A flat blue mountain illustration.', bbox: [224, 320, 800, 896], palette: ['#2B4C7E'] },
  ],
}

// view elements (top-first) → editor boxes (bottom→top)
function viewToBoxes(view) {
  return [...view.compositional_deconstruction.elements].reverse().map((el) => ({
    mode: el.type,
    x: el.bbox[1],
    y: el.bbox[0],
    w: el.bbox[3] - el.bbox[1],
    h: el.bbox[2] - el.bbox[0],
    desc: el.desc,
    text: el.text ?? '',
    colors: el.color_palette ?? [],
    tags: el.tags ?? [],
  }))
}

describe('buildMossLayout', () => {
  it('reproduces the EXPLORE layout exactly at 1024×1024 (keys and coords)', () => {
    const { layout, dropped } = buildMossLayout({
      caption: EXPLORE.summary.caption,
      meta: ['poster'],
      canvas: 'single',
      palette: ['#F3E9D2'],
      boxes: EXPLORE_BOXES,
      width: 1024,
      height: 1024,
    })
    expect(dropped).toBe(0)
    expect(JSON.stringify(layout)).toBe(JSON.stringify(EXPLORE))
  })

  it('emits items top-layer-first with the specified key order', () => {
    const { layout } = buildMossLayout({
      caption: 'c',
      meta: [],
      canvas: '',
      palette: [],
      width: 1024,
      height: 1024,
      boxes: [
        { mode: 'obj', x: 0, y: 0, w: 500, h: 500, desc: 'bottom', text: '', colors: [], tags: [] },
        { mode: 'character', x: 0, y: 0, w: 500, h: 500, desc: 'top', text: '', colors: ['#111'], tags: ['hero', 'swordsman'] },
      ],
    })
    expect(layout.items[0].label).toBe('character')
    expect(Object.keys(layout.items[0]).join(',')).toBe('label,caption,bbox,tags,palette')
    expect(layout.items[0].tags).toEqual(['hero', 'swordsman'])
    expect(layout.items[1].label).toBe('object')
  })

  it('full-canvas box → [-hh, -hw, hh, hw], nothing dropped', () => {
    const { layout, dropped } = buildMossLayout({
      caption: 'c', meta: [], canvas: '', palette: [],
      boxes: [{ mode: 'obj', x: 0, y: 0, w: 1000, h: 1000, desc: 'd', text: '', colors: [], tags: [] }],
      width: 1024, height: 1024,
    })
    expect(dropped).toBe(0)
    expect(layout.items[0].bbox).toEqual([-512, -512, 512, 512])
  })

  it('zero-width box is dropped and counted', () => {
    const { layout, dropped } = buildMossLayout({
      caption: 'c', meta: [], canvas: '', palette: [],
      boxes: [{ mode: 'obj', x: 0, y: 0, w: 0, h: 500, desc: 'd', text: '', colors: [], tags: [] }],
      width: 1024, height: 1024,
    })
    expect(dropped).toBe(1)
    expect(layout.items).toEqual([])
  })

  it('text box with undefined text still emits the required text key', () => {
    const { layout } = buildMossLayout({
      caption: 'c', meta: [], canvas: '', palette: [],
      boxes: [{ mode: 'text', x: 0, y: 0, w: 500, h: 500, desc: 'a title' }],
      width: 1024, height: 1024,
    })
    expect(layout.items[0].text).toBe('')
  })

  it('clamps past-canvas boxes to the canvas half-extent', () => {
    const { layout, dropped } = buildMossLayout({
      caption: 'c', meta: [], canvas: '', palette: [],
      boxes: [{ mode: 'obj', x: 990, y: 0, w: 100, h: 100, desc: 'd', text: '', colors: [], tags: [] }],
      width: 1024, height: 1024,
    })
    expect(dropped).toBe(0)
    expect(layout.items[0].bbox[3]).toBe(512)
  })

  it('zero items in Layout mode still emit the JSON (summary only)', () => {
    const { layout } = buildMossLayout({
      caption: 'just a caption', meta: [], canvas: '', palette: [],
      boxes: [], width: 1024, height: 1024,
    })
    expect(layout.items).toEqual([])
    expect(layout.summary).toEqual({ caption: 'just a caption' })
  })
})

describe('compileMoss', () => {
  it('produces minified one-line JSON', () => {
    const out = compileMoss(EXPLORE)
    expect(out).toBe(JSON.stringify(EXPLORE))
    expect(out).not.toContain('\n')
  })
})

describe('parseMoss', () => {
  it('compiled form → view with normalized yxyx bboxes and moss globals', () => {
    const { view, moss, dims } = parseMoss(EXPLORE, { width: 1024, height: 1024 })
    expect(dims).toBeNull()
    expect(moss).toEqual({
      caption: EXPLORE.summary.caption,
      meta: ['poster'],
      canvas: 'single',
      palette: ['#F3E9D2'],
    })
    expect(view.high_level_description).toBe(EXPLORE.summary.caption)
    expect(view.style_description.color_palette).toEqual(['#F3E9D2'])
    expect(view.style_description.medium).toBe('')
    expect(view.compositional_deconstruction.background).toBe('')
    // text item: [-416,-384,-288,384] → editor 0–1000 (exact fractional inverse)
    const text = view.compositional_deconstruction.elements[0]
    expect(text.type).toBe('text')
    expect(text.text).toBe('EXPLORE')
    expect(text.desc).toBe('Large dark-blue title centered at the top.')
    expect(text.bbox).toEqual([93.75, 125, 218.75, 875])
    // object item: [-192,-288,384,288] → editor 0–1000
    const object = view.compositional_deconstruction.elements[1]
    expect(object.type).toBe('obj')
    expect(object.bbox).toEqual([312.5, 218.75, 875, 781.25])
    expect(object.color_palette).toEqual(['#2B4C7E'])
  })

  it('draft parses to the same view as its compiled form and carries dims', () => {
    const fromDraft = parseMoss(EXPLORE_DRAFT, { width: 1024, height: 1024 })
    const fromCompiled = parseMoss(EXPLORE, { width: 1024, height: 1024 })
    expect(fromDraft.dims).toEqual({ width: 1024, height: 1024 })
    expect(fromDraft.view).toEqual(fromCompiled.view)
    expect(fromDraft.moss).toEqual(fromCompiled.moss)
  })

  it('character label maps to character type; tags survive the round trip', () => {
    const { view } = parseMoss({
      summary: { caption: 'c' },
      items: [{ label: 'character', caption: 'a hero', bbox: [0, 0, 100, 100], tags: ['hero'] }],
      bbox_coord_space: 'abs_centralized',
      bbox_format: 'yxyx',
    }, { width: 1024, height: 1024 })
    const el = view.compositional_deconstruction.elements[0]
    expect(el.type).toBe('character')
    expect(el.tags).toEqual(['hero'])
  })

  it('compile → parse → compile is stable on non-square 768×1152', () => {
    const opts = { width: 768, height: 1152 }
    const boxes = [
      { mode: 'obj', x: 100.5, y: 200.25, w: 550.75, h: 300.5, desc: 'd1', text: '', colors: [], tags: [] },
      { mode: 'text', x: 50, y: 10, w: 400, h: 120, desc: 't1', text: 'HI', colors: [], tags: [] },
    ]
    const round = (bs) => compileMoss(buildMossLayout({
      caption: 'cap', meta: ['poster'], canvas: 'single', palette: [],
      boxes: bs, width: opts.width, height: opts.height,
    }).layout)

    const c1 = round(boxes)
    const view1 = parseMoss(JSON.parse(c1), opts).view
    const c2 = round(viewToBoxes(view1))
    const view2 = parseMoss(JSON.parse(c2), opts).view
    const c3 = round(viewToBoxes(view2))
    expect(c2).toBe(c1)  // exact inverse — stable from the first round
    expect(c3).toBe(c2)
  })

  it('clamps centralized coords outside the canvas to 0–1000', () => {
    const { view } = parseMoss({
      summary: { caption: 'c' },
      items: [{ label: 'object', caption: 'd', bbox: [-512, -512, 512, 512] }],
      bbox_coord_space: 'abs_centralized',
      bbox_format: 'yxyx',
    }, { width: 1024, height: 1024 })
    expect(view.compositional_deconstruction.elements[0].bbox).toEqual([0, 0, 1000, 1000])
  })
})

describe('predicates', () => {
  it('isMossJson accepts summary+items, rejects Ideogram and junk', () => {
    expect(isMossJson(EXPLORE)).toBe(true)
    expect(isMossJson({ high_level_description: 'x' })).toBe(false)
    expect(isMossJson({ summary: { caption: 'x' } })).toBe(false) // no items
    expect(isMossJson(null)).toBe(false)
    expect(isMossJson('string')).toBe(false)
  })

  it('isMossDraft requires bbox_coord_space abs', () => {
    expect(isMossDraft(EXPLORE_DRAFT)).toBe(true)
    expect(isMossDraft(EXPLORE)).toBe(false)
  })
})
