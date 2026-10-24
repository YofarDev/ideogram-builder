import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const DOM_HTML = `
  <div>
    <div id="lora-toggle"><span class="lora-header-icon">▼</span><button id="btn-lora-add">+ Add</button></div>
    <div id="lora-add-form" hidden>
      <input type="text" id="lora-add-label">
      <select id="lora-add-model">
        <option value="ideogram">Ideogram 4</option>
        <option value="moss">MOSS</option>
      </select>
      <input type="radio" id="lora_add_url" name="lora_add_source" value="url" checked>
      <input type="radio" id="lora_add_file" name="lora_add_source" value="file">
      <input type="text" id="lora-add-url">
      <input type="file" id="lora-add-file">
      <div id="lora-add-hint"></div>
      <button id="btn-lora-add-confirm">Add</button>
    </div>
    <div id="lora-list"></div>
  </div>
`

// vi.resetModules() below hands the module under test fresh state/events/toast
// instances — capture them dynamically so the tests talk to the same objects.
let state, emit, on, showToast

beforeEach(async () => {
  document.body.innerHTML = DOM_HTML
  localStorage.clear()
  global.fetch = vi.fn(async () => ({ json: async () => ({ modal: true, hf: true }) }))
  vi.resetModules()
  const events = await import('../events.js')
  events.resetAllListeners()
  emit = events.emit
  on = events.on
  state = (await import('../state.js')).state
  state.model = 'moss'
  showToast = (await import('../toast.js')).showToast
  showToast.mockClear()
  const mod = await import('../lora-add.js')
  mod.initLoraAdd()
})

describe('lora-add form', () => {
  it('opens with the current model preselected', () => {
    document.getElementById('btn-lora-add').click()
    expect(document.getElementById('lora-add-form').hidden).toBe(false)
    expect(document.getElementById('lora-add-model').value).toBe('moss')
  })

  it('file input is disabled with a hint when no upload target is configured', async () => {
    global.fetch = vi.fn(async () => ({ json: async () => ({ modal: false, hf: false }) }))
    document.getElementById('btn-lora-add').click()
    await vi.waitFor(() => {
      expect(document.getElementById('lora-add-file').disabled).toBe(true)
    })
    expect(document.getElementById('lora-add-hint').textContent).toContain('No upload target')
  })

  it('URL add emits lora:added with a handler-compatible filename', () => {
    const added = []
    on('lora:added', ({ entry }) => added.push(entry))
    document.getElementById('btn-lora-add').click()
    document.getElementById('lora-add-label').value = 'My style'
    document.getElementById('lora-add-url').value =
      'https://huggingface.co/user/repo/blob/main/my style!.safetensors'
    document.getElementById('btn-lora-add-confirm').click()

    expect(added.length).toBe(1)
    expect(added[0].label).toBe('My style')
    expect(added[0].model).toBe('moss')
    expect(added[0].filename).toBe('my_style_.safetensors')
    // blob viewer URL converted to the direct resolve URL
    expect(added[0].source_url).toBe('https://huggingface.co/user/repo/resolve/main/my style!.safetensors')
    expect(document.getElementById('lora-add-form').hidden).toBe(true)
  })

  it('file upload posts to /api/lora/upload and emits the server filename', () => {
    const added = []
    on('lora:added', ({ entry }) => added.push(entry))

    class FakeXHR {
      constructor() { FakeXHR.last = this; this.upload = { addEventListener() {} }; }
      open(method, url) { this.url = url; }
      addEventListener(type, cb) { this.listeners = this.listeners || {}; this.listeners[type] = cb; }
      send(file) {
        this.file = file
        this.status = 200
        this.responseText = JSON.stringify({
          filename: 'user/moss/uploaded.safetensors',
          source_url: 'https://huggingface.co/x/y/resolve/main/moss/uploaded.safetensors',
          targets: ['modal', 'hf'],
        })
        this.listeners.load()
      }
    }
    global.XMLHttpRequest = FakeXHR

    document.getElementById('btn-lora-add').click()
    document.querySelector('input[name="lora_add_source"][value="file"]').checked = true
    document.querySelector('input[name="lora_add_source"][value="file"]').dispatchEvent(new Event('change'))
    const fileInput = document.getElementById('lora-add-file')
    Object.defineProperty(fileInput, 'files', { value: [new File([new Uint8Array(4)], 'my lora.safetensors')] })
    document.getElementById('btn-lora-add-confirm').click()

    expect(FakeXHR.last.url).toContain('/api/lora/upload?name=my%20lora.safetensors&model=moss')
    expect(added.length).toBe(1)
    expect(added[0].filename).toBe('user/moss/uploaded.safetensors')
    expect(added[0].source_url).toContain('resolve/main/moss/uploaded.safetensors')
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Uploaded'), expect.anything())
  })

  it('model:changed keeps an open form in sync', () => {
    document.getElementById('btn-lora-add').click()
    state.model = 'ideogram'  // model.js updates state before emitting
    emit('model:changed', { model: 'ideogram', previous: 'moss' })
    expect(document.getElementById('lora-add-model').value).toBe('ideogram')
  })
})
