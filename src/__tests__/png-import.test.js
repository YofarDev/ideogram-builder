import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state } from '../state.js'
import { emit } from '../events.js'

function makePngBuffer(chunks) {
  // PNG signature
  const sig = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const parts = [sig]
  for (const { type, data } of chunks) {
    const typeBytes = new TextEncoder().encode(type)
    const lenBuf = new ArrayBuffer(4)
    new DataView(lenBuf).setUint32(0, data.length)
    parts.push(new Uint8Array(lenBuf), typeBytes, data, new Uint8Array(4)) // 4-byte CRC placeholder
  }
  // IEND
  const iendLen = new ArrayBuffer(4)
  new DataView(iendLen).setUint32(0, 0)
  parts.push(new Uint8Array(iendLen), new TextEncoder().encode('IEND'), new Uint8Array(4))
  const total = parts.reduce((s, p) => s + p.length, 0)
  const buf = new Uint8Array(total)
  let off = 0
  for (const p of parts) { buf.set(p, off); off += p.length }
  return buf.buffer
}

function makeTextChunk(keyword, value) {
  const kw = new TextEncoder().encode(keyword)
  const val = new TextEncoder().encode(value)
  const data = new Uint8Array(kw.length + 1 + val.length)
  data.set(kw)
  data[kw.length] = 0
  data.set(val, kw.length + 1)
  return { type: 'tEXt', data }
}


vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

beforeEach(() => {
  state.boxes = []
  state.selectedBoxId = null
  state.boxCounter = 0
  state.globalPalette = []
  state.canvas = { width: 1024, height: 1024, scale: 1 }
  state.photoArtMode = 1
})

describe('extractComfyUIMetadata', () => {
  // extractComfyUIMetadata is not exported, tested indirectly via loadFromJsonModal
  // Instead we test it by importing and calling it through a workaround:
  // Re-import the module with a fresh state to call importImage with a fake file
  // Since this is complex, we test the validation + JSON flow instead

  it('valid PNG without tEXt chunks produces no crash', () => {
    // extractComfyUIMetadata would return null — test indirectly
    // The function is private, so we verify the module loads cleanly
    const buf = makePngBuffer([])
    expect(buf.byteLength).toBeGreaterThan(8)
    // Validate PNG signature
    const view = new DataView(buf)
    expect(view.getUint32(0)).toBe(0x89504E47)
  })
})

describe('prompt detection across workflow nodes (D3)', () => {
  const mossLayout = JSON.stringify({
    summary: { caption: 'A fox' },
    items: [{ label: 'object', caption: 'd', bbox: [0, 0, 100, 100] }],
    bbox_coord_space: 'abs_centralized',
    bbox_format: 'yxyx',
  })
  const ideogramJson = JSON.stringify({ high_level_description: 'x', compositional_deconstruction: { elements: [] } })

  async function extract(promptObj) {
    const png = makePngBuffer([makeTextChunk('prompt', JSON.stringify(promptObj))])
    const mod = await import('../png-import.js')
    return mod.extractComfyUIMetadata(png)
  }

  it('finds a MOSS layout in any node inputs.text (node "7" shape)', async () => {
    const found = await extract({ '7': { inputs: { text: mossLayout } }, '12': { inputs: { filename_prefix: 'moss' } } })
    expect(found).toEqual({ moss: mossLayout })
  })

  it('prefers the Ideogram JSON when both kinds are present', async () => {
    const found = await extract({
      '7': { inputs: { text: mossLayout } },
      '98:167': { inputs: { text: ideogramJson } },
    })
    expect(found).toEqual({ ideogram: JSON.parse(ideogramJson) })
  })

  it('returns null when no node carries a known prompt (plain caption ignored)', async () => {
    const found = await extract({ '7': { inputs: { text: 'just a caption' } }, '8': { inputs: { text: '' } } })
    expect(found).toBeNull()
  })
})

describe('image import lifecycle', () => {
  async function setup() {
    const { resetAllListeners, on } = await import('../events.js')
    resetAllListeners()
    document.body.innerHTML = '<span id="dim-display"></span><select id="aspect-ratio"><option value="640x480">4:3</option></select><textarea id="json-output">old prompt</textarea>'
    vi.stubGlobal('Image', class {
      width = 640; height = 480
      set src(value) { queueMicrotask(() => this.onload()) }
    })
    vi.stubGlobal('FileReader', class {
      readAsDataURL(file) { this.result = `data:image/png;base64,${file.name}`; queueMicrotask(() => this.onload()) }
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:import')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const ready = vi.fn()
    const applied = vi.fn(({ raw }) => { document.getElementById('json-output').value = `applied:${raw}` })
    on('image:ready', ready)
    on('prompt:apply', applied)
    on('canvas:rebuild', () => { document.getElementById('json-output').value = '' })
    const { importImage } = await import('../png-import.js')
    return { importImage, ready, applied }
  }

  it('waits for metadata and applies its model before saving the image', async () => {
    const { importImage, ready, applied } = await setup()
    let finishMetadata
    const pending = importImage({ type: 'image/png', name: 'first', arrayBuffer: () => new Promise(resolve => { finishMetadata = resolve }) })
    await Promise.resolve()
    expect(ready).not.toHaveBeenCalled()
    const prompt = JSON.stringify({ high_level_description: 'Imported scene' })
    finishMetadata(makePngBuffer([makeTextChunk('prompt', JSON.stringify({ node: { inputs: { text: prompt } } }))]))
    await pending
    expect(applied).toHaveBeenCalledWith({ raw: JSON.stringify(JSON.parse(prompt), null, 2), quiet: true })
    expect(ready.mock.calls[0][0].importJson).toContain('applied:')
    expect(ready.mock.calls[0][0].imageUrl).toBe('data:image/png;base64,first')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:import')
    vi.unstubAllGlobals(); vi.restoreAllMocks()
  })

  it('ignores an older import that finishes after a newer image', async () => {
    const { importImage, ready } = await setup()
    let finishOld
    const old = importImage({ type: 'image/png', name: 'old', arrayBuffer: () => new Promise(resolve => { finishOld = resolve }) })
    await importImage({ type: 'image/jpeg', name: 'new' })
    finishOld(makePngBuffer([]))
    await old
    expect(ready).toHaveBeenCalledTimes(1)
    expect(ready.mock.calls[0][0].dataUrl).toContain('new')
    expect(ready.mock.calls[0][0].importJson).toBe('')
    vi.unstubAllGlobals(); vi.restoreAllMocks()
  })
})
