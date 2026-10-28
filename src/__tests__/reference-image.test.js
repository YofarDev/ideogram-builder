import { beforeEach, expect, it, vi } from 'vitest'
import { state } from '../state.js'
import { localImageUrl, readReferenceImage } from '../reference-image.js'
import { on, resetAllListeners } from '../events.js'
import { initRecaption } from '../settings-recaption.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

beforeEach(() => {
  resetAllListeners()
  state.imageDataUrl = null
  state.referenceImageUrl = '/output/image.png'
  state.imageRevision = 1
  state.boxes = []
  state.selectedBoxId = null
  vi.restoreAllMocks()
})

it('accepts local output images and rejects remote URLs and encoded traversal', () => {
  expect(localImageUrl('/output/my%20image.png')).toBe('/output/my%20image.png')
  for (const url of ['https://other.test/output/a.png', '//other.test/a.png', '/output/../secret.png', '/output/%2e%2e%2fsecret.png', '/output/file.json', '/output/a.png?x=1']) expect(localImageUrl(url)).toBeNull()
})

it('loads saved images for recaptioning on demand and reuses the data', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['A'], { type: 'image/png' }) }))
  const data = await readReferenceImage()
  expect(data).toBe('data:image/png;base64,QQ==')
  expect(await readReferenceImage()).toBe(data)
  expect(fetch).toHaveBeenCalledTimes(1)
  vi.unstubAllGlobals()
})

it('rejects an image fetch that finishes after the reference has changed', async () => {
  let finish
  vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finish = resolve })))
  const result = readReferenceImage()
  state.imageRevision++
  finish({ ok: true, blob: async () => new Blob(['A'], { type: 'image/png' }) })
  await expect(result).rejects.toThrow('Reference image changed')
  expect(state.imageDataUrl).toBeNull()
  vi.unstubAllGlobals()
})

async function recaptionSetup() {
  document.body.innerHTML = '<div id="recaption-group"></div><select id="recaption-model"><option value="local">Local</option></select><button id="btn-recaption">Recaption</button><textarea id="json-output">{}</textarea><input id="recaption-instructions"><textarea id="box-desc"></textarea><input id="box-text">'
  const box = { id: 'box_0', x: 0, y: 0, w: 500, h: 500, desc: 'Old description', text: '' }
  state.boxes = [box]
  state.selectedBoxId = box.id
  state.imageDataUrl = 'data:image/png;base64,QQ=='
  let finish
  vi.stubGlobal('fetch', vi.fn(url => url === '/api/config' ? Promise.resolve({ ok: true, json: async () => ({}) })
    : new Promise(resolve => { finish = resolve })))
  initRecaption()
  document.getElementById('btn-recaption').click()
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/recaption-element', expect.anything()))
  return { box, finish: data => finish({ ok: true, json: async () => data }) }
}

it('does not apply a response over a newer manual description', async () => {
  const { box, finish } = await recaptionSetup()
  const changed = vi.fn()
  on('state:changed', changed)
  box.desc = 'New manual description'
  finish({ desc: 'Outdated model response' })
  await vi.waitFor(() => expect(document.getElementById('btn-recaption').disabled).toBe(false))
  expect(box.desc).toBe('New manual description')
  expect(changed).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

it('updates the requested layer without overwriting another layer’s form', async () => {
  const { box, finish } = await recaptionSetup()
  state.selectedBoxId = 'box_1'
  document.getElementById('box-desc').value = 'Other layer'
  finish({ desc: 'New description', has_text: true, visible_text: 'Title' })
  await vi.waitFor(() => expect(document.getElementById('btn-recaption').disabled).toBe(false))
  expect(box.desc).toBe('New description')
  expect(box.text).toBe('Title')
  expect(document.getElementById('box-desc').value).toBe('Other layer')
  vi.unstubAllGlobals()
})
