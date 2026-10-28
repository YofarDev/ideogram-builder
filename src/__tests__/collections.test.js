import { describe, it, expect, beforeEach, vi } from 'vitest'

const DOM_HTML = `
  <div id="collection-container">
    <div id="collection-chips"></div>
    <input type="file" id="collection-import-input">
    <button id="btn-collection-import"></button>
    <button id="btn-collection-export"></button>
    <button id="btn-collection-delete"></button>
    <h2 id="collection-title"></h2>
    <input id="collection-title-edit">
    <div id="collection-meta"></div>
    <textarea id="collection-paste"></textarea>
    <button id="btn-collection-paste-add"></button>
    <div id="collection-grid"></div>
    <button id="btn-collection-generate"></button>
  </div>
  <div id="toast-container"></div>
`

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  document.body.innerHTML = DOM_HTML
  localStorage.clear()
})

async function loadCollections(mocks = {}) {
  vi.resetModules()
  vi.doMock('../events.js', () => ({ emit: mocks.emit ?? vi.fn(), on: mocks.on ?? vi.fn() }))
  vi.doMock('../toast.js', () => ({ showToast: mocks.showToast ?? vi.fn() }))
  vi.doMock('../queue.js', () => ({ enqueueImportJson: mocks.enqueueImportJson ?? vi.fn() }))
  return import('../collections.js')
}

describe('collections data layer', () => {
  it('createCollection adds and activates a new collection, persists to localStorage', async () => {
    const mod = await loadCollections()
    const c = mod.createCollection('Portraits')
    expect(c.name).toBe('Portraits')
    expect(mod.getActive().id).toBe(c.id)
    const stored = JSON.parse(localStorage.getItem('ideogram_collections'))
    expect(stored[0].name).toBe('Portraits')
  })

  it('addItem appends to the active collection with a derived label', async () => {
    const mod = await loadCollections()
    mod.createCollection('Set')
    const json = JSON.stringify({ high_level_description: 'A red apple' })
    const c = mod.addItem(json)
    expect(c.items).toHaveLength(1)
    expect(c.items[0].importJson).toBe(json)
    expect(mod.labelFor(json)).toBe('A red apple')
  })

  it('labelFor falls back to first element desc then background then truncation', async () => {
    const mod = await loadCollections()
    expect(mod.labelFor(JSON.stringify({
      compositional_deconstruction: { elements: [{ desc: 'a cat' }] },
    }))).toBe('a cat')
    expect(mod.labelFor(JSON.stringify({
      compositional_deconstruction: { background: 'a field' },
    }))).toBe('a field')
    expect(mod.labelFor('not json at all here')).toBe('not json at all here')
  })

  it('removeItem drops an item by id from the active collection', async () => {
    const mod = await loadCollections()
    mod.createCollection('Set')
    const c = mod.addItem('{"high_level_description":"x"}')
    const id = c.items[0].id
    mod.removeItem(id)
    expect(mod.getActive().items).toHaveLength(0)
  })

  it('load restores collections + active id from localStorage on init', async () => {
    const mod = await loadCollections()
    const c = mod.createCollection('Persisted')
    const reloaded = await loadCollections()
    expect(reloaded.getAll().some(x => x.id === c.id)).toBe(true)
    expect(reloaded.getActive().id).toBe(c.id)
  })

  it('generateCollection emits queue:enqueue for each item and shows error on empty', async () => {
    const emit = vi.fn()
    const showToast = vi.fn()
    const mod = await loadCollections({ emit, showToast })
    mod.createCollection('Batch')
    mod.addItem('{"high_level_description":"one"}')
    mod.addItem('{"high_level_description":"two"}')
    emit.mockClear()
    mod.generateCollection()
    expect(emit).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenCalledWith('queue:enqueue', expect.objectContaining({ importJson: expect.any(String) }))
    mod.createCollection('Empty')
    mod.generateCollection()
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('empty'), 'error')
  })

  it('duplicateItem clones an item with a new id, inserted after the source', async () => {
    const mod = await loadCollections()
    mod.createCollection('Set')
    const c = mod.addItem('{"high_level_description":"x"}')
    const orig = c.items[0].id
    mod.duplicateItem(orig)
    const items = mod.getActive().items
    expect(items).toHaveLength(2)
    expect(items[0].id).toBe(orig)
    expect(items[1].id).not.toBe(orig)
    expect(items[1].importJson).toBe(items[0].importJson)
  })

  it('loadItemToEditor routes Ideogram through shared model-aware apply; errors on non-structured json', async () => {
    const emit = vi.fn()
    const showToast = vi.fn()
    const mod = await loadCollections({ emit, showToast })
    mod.createCollection('Set')
    const c = mod.addItem(JSON.stringify({ high_level_description: 'hi', compositional_deconstruction: { elements: [] } }))
    emit.mockClear()
    mod.loadItemToEditor(c.items.at(-1).id)
    expect(emit).toHaveBeenCalledWith('prompt:apply', { raw: c.items.at(-1).importJson })
    emit.mockClear()
    const c2 = mod.addItem('not json', null, 'ideogram')
    emit.mockClear()
    mod.loadItemToEditor(c2.items.at(-1).id)
    expect(emit).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('loadable'), 'error')
  })
})

describe('per-model items (D2)', () => {
  const MOSS_LAYOUT = JSON.stringify({
    summary: { caption: 'A poster' },
    items: [{ label: 'object', caption: 'd', bbox: [0, 0, 100, 100] }],
    bbox_coord_space: 'abs_centralized',
    bbox_format: 'yxyx',
  })
  const IDEOGRAM_JSON = '{"high_level_description":"hi"}'

  it('addItem infers model: ideogram JSON / moss layout / plain caption → moss', async () => {
    const mod = await loadCollections()
    mod.createCollection('Mix')
    const c = mod.getActive()
    mod.addItem(IDEOGRAM_JSON)
    mod.addItem(MOSS_LAYOUT)
    mod.addItem('A red fox in snow')
    expect(c.items[0].model).toBe('ideogram')
    expect(c.items[1].model).toBe('moss')
    expect(c.items[2].model).toBe('moss')
  })

  it('explicit model wins over inference', async () => {
    const mod = await loadCollections()
    mod.createCollection('X')
    const c = mod.addItem(MOSS_LAYOUT, null, 'ideogram')
    expect(c.items[0].model).toBe('ideogram')
  })

  it('legacy items without model default to ideogram behaviour', async () => {
    const mod = await loadCollections()
    mod.createCollection('Legacy')
    // Simulate a pre-MOSS stored collection: item without a model key
    const colls = JSON.parse(localStorage.getItem('ideogram_collections'))
    colls[0].items.push({ id: 'old1', importJson: IDEOGRAM_JSON, imageUrl: null })
    localStorage.setItem('ideogram_collections', JSON.stringify(colls))

    const emit = vi.fn()
    const mod2 = await loadCollections({ emit })
    const restored = mod2.getActive()
    expect(restored.items[0].model).toBe('ideogram') // legacy format is normalized on read
    emit.mockClear()
    mod2.generateItem(restored.items[0].id)
    expect(emit).toHaveBeenCalledWith('queue:enqueue', expect.objectContaining({ model: 'ideogram' }))
  })

  it('generateItem and generateCollection pass each item own model', async () => {
    const emit = vi.fn()
    const mod = await loadCollections({ emit })
    mod.createCollection('Batch')
    mod.addItem(IDEOGRAM_JSON)
    mod.addItem(MOSS_LAYOUT)
    emit.mockClear()
    mod.generateCollection()
    const models = emit.mock.calls.filter(c => c[0] === 'queue:enqueue').map(c => c[1].model)
    expect(models).toEqual(['ideogram', 'moss'])
  })

  it('loadItemToEditor routes moss items through prompt:apply', async () => {
    const emit = vi.fn()
    const showToast = vi.fn()
    const mod = await loadCollections({ emit, showToast })
    mod.createCollection('M')
    const c = mod.addItem(MOSS_LAYOUT)
    emit.mockClear()
    mod.loadItemToEditor(c.items[0].id)
    expect(emit).toHaveBeenCalledWith('prompt:apply', { raw: MOSS_LAYOUT })
  })

  it('duplicateItem keeps the item model', async () => {
    const mod = await loadCollections()
    mod.createCollection('D')
    const c = mod.addItem(MOSS_LAYOUT)
    mod.duplicateItem(c.items[0].id)
    const items = mod.getActive().items
    expect(items[1].model).toBe('moss')
  })
})

describe('collection workflow regressions', () => {
  it('renders malformed layout metadata without losing the other collection prompts', async () => {
    const mod = await loadCollections()
    mod.createCollection('Recovered prompts')
    const c = mod.addItem('{"compositional_deconstruction":{"elements":"broken"}}')
    mod.addItem('{"compositional_deconstruction":{"elements":[null,{"desc":"Recovered","color_palette":false}]}}')
    const data = await import('../collections-data.js')
    const ui = await import('../collections-ui.js')
    expect(() => ui.render()).not.toThrow()
    expect(document.querySelectorAll('.coll-card')).toHaveLength(2)
    data.setExpandedId(c.items[1].id)
    expect(() => ui.render()).not.toThrow()
    expect(document.querySelector('.coll-detail')).not.toBeNull()
  })
  it('switches to MOSS before applying a saved plain caption', async () => {
    const emit = vi.fn()
    const mod = await loadCollections({ emit })
    mod.createCollection('Captions')
    const c = mod.addItem('A fox in snow')
    emit.mockClear()
    mod.loadItemToEditor(c.items[0].id)
    expect(emit.mock.calls.slice(0, 2)).toEqual([
      ['model:set', { model: 'moss', seed: false }],
      ['prompt:apply', { raw: 'A fox in snow' }],
    ])
  })

  it('uses the structured prompt format when stored model metadata is stale', async () => {
    const emit = vi.fn()
    const mod = await loadCollections({ emit })
    mod.createCollection('Mixed')
    const c = mod.addItem('{"high_level_description":"Ideogram scene"}', null, 'moss')
    mod.generateItem(c.items[0].id)
    expect(emit).toHaveBeenCalledWith('queue:enqueue', { importJson: c.items[0].importJson, model: 'ideogram' })
  })

  it('persists variable input, renders quotes safely, and uses values for collapsed batch cards', async () => {
    const emit = vi.fn()
    const mod = await loadCollections({ emit })
    mod.initCollections()
    mod.createCollection('Variables')
    const data = await import('../collections-data.js')
    const c = mod.addItem('{"high_level_description":"A portrait of {{ subject }}"}')
    const id = c.items[0].id
    data.setExpandedId(id)
    const ui = await import('../collections-ui.js')
    ui.render()
    const input = document.querySelector('.coll-token-input')
    const text = '"quoted" $& and \\slashes'
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(JSON.parse(localStorage.getItem('ideogram_collections'))[0].items[0].tokenValues.subject).toBe(text)
    ui.render()
    expect(document.querySelector('.coll-token-input').value).toBe(text)
    expect(document.querySelectorAll('.coll-token-input')).toHaveLength(1)
    data.setExpandedId(null)
    ui.render()
    emit.mockClear()
    mod.generateCollection()
    const job = emit.mock.calls.find(call => call[0] === 'queue:enqueue')[1]
    expect(JSON.parse(job.importJson).high_level_description).toBe(`A portrait of ${text}`)
    data.setTokenValue(id, 'subject', text + '\nsecond line')
    mod.generateItem(id)
    const latest = emit.mock.calls.filter(call => call[0] === 'queue:enqueue').at(-1)[1]
    expect(JSON.parse(latest.importJson).high_level_description).toBe(`A portrait of ${text}\nsecond line`)
  })

  it('does not queue a partial batch when a variable has not been filled', async () => {
    const emit = vi.fn()
    const showToast = vi.fn()
    const mod = await loadCollections({ emit, showToast })
    mod.createCollection('Variables')
    mod.addItem('{"high_level_description":"Ready"}')
    mod.addItem('{"high_level_description":"{{subject}}"}')
    emit.mockClear()
    mod.generateCollection()
    expect(emit).not.toHaveBeenCalledWith('queue:enqueue', expect.anything())
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('subject'), 'error')
  })

  it('saves edited MOSS captions and refreshes model metadata when a prompt format changes', async () => {
    const mod = await loadCollections()
    mod.initCollections()
    mod.createCollection('Editing')
    const c = mod.addItem('Old caption')
    const data = await import('../collections-data.js')
    data.setExpandedId(c.items[0].id)
    data.setEditingId(c.items[0].id)
    const ui = await import('../collections-ui.js')
    ui.render()
    document.querySelector('.coll-edit-textarea').value = 'New caption'
    document.querySelector('[data-act="save"]').click()
    expect(c.items[0].importJson).toBe('New caption')
    data.setEditingId(c.items[0].id)
    ui.render()
    document.querySelector('.coll-edit-textarea').value = '{"high_level_description":"Now Ideogram"}'
    document.querySelector('[data-act="save"]').click()
    expect(c.items[0].model).toBe('ideogram')
  })
})
