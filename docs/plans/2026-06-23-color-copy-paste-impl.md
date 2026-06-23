# Color Copy/Paste Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:exuting-plans to implement this plan task-by-task.

**Goal:** Let users right-click any swatch to copy its hex to the system clipboard, and type/paste a hex into a new text field to add colors (with the native picker as fallback).

**Architecture:** Two additions scoped entirely to `src/palette.js` + two new `<input type="text">` elements in `index.html`. No state, events, or other modules change. Reuses existing `addColor` cap/dedup logic and `showToast`. Testable bits extracted as pure helpers (`normalizeHex`, `copyColor`) and covered with vitest+jsdom following the existing `src/__tests__/*.test.js` pattern.

**Tech Stack:** Vanilla ES modules, vitest 4 + jsdom (already configured in `vitest.config.js`).

**Design doc:** `docs/plans/2026-06-23-color-copy-paste-design.md`

---

## Task 1: Add and test `normalizeHex` helper

**Files:**
- Create: `src/__tests__/palette.test.js`
- Modify: `src/palette.js` (add exported `normalizeHex`, no behavior change yet)

**Step 1: Write the failing test**

Create `src/__tests__/palette.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { normalizeHex } from '../palette.js'

describe('normalizeHex', () => {
  it('accepts #RRGGBB and uppercases', () => {
    expect(normalizeHex('#ff00aa')).toBe('#FF00AA')
  })
  it('accepts RRGGBB without #', () => {
    expect(normalizeHex('ff00aa')).toBe('#FF00AA')
  })
  it('accepts already-uppercase #RRGGBB', () => {
    expect(normalizeHex('#FF00AA')).toBe('#FF00AA')
  })
  it('trims whitespace', () => {
    expect(normalizeHex('  #ff00aa  ')).toBe('#FF00AA')
  })
  it('rejects 3-digit shorthand', () => {
    expect(normalizeHex('#f0a')).toBeNull()
  })
  it('rejects non-hex characters', () => {
    expect(normalizeHex('#gg00aa')).toBeNull()
  })
  it('rejects empty string', () => {
    expect(normalizeHex('')).toBeNull()
  })
  it('rejects non-string', () => {
    expect(normalizeHex(null)).toBeNull()
    expect(normalizeHex(undefined)).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/palette.test.js`
Expected: FAIL — `normalizeHex is not a function` (not yet exported).

**Step 3: Write minimal implementation**

Add to the top of `src/palette.js` (after the imports, before `initPalette`):

```js
export function normalizeHex(input) {
  if (typeof input !== 'string') return null
  const trimmed = input.trim().replace(/^#/, '').toUpperCase()
  return /^[0-9A-F]{6}$/.test(trimmed) ? '#' + trimmed : null
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/palette.test.js`
Expected: PASS (8 tests).

**Step 5: Commit**

```bash
git add src/palette.js src/__tests__/palette.test.js
git commit -m "feat(palette): add normalizeHex helper with tests"
```

---

## Task 2: Make `addColor` read the hex text field first

**Files:**
- Modify: `src/palette.js` (the `addColor` function, currently lines 22-43)
- Modify: `src/__tests__/palette.test.js` (add `resolveColorInput` tests)

**Step 1: Write the failing tests**

Append to `src/__tests__/palette.test.js` (add `beforeEach` + `vi` import at top, plus a new describe block):

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { normalizeHex, resolveColorInput } from '../palette.js'

// ... existing normalizeHex describe block ...

describe('resolveColorInput', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('uses hex field value when non-empty and valid', () => {
    document.body.innerHTML = `
      <input id="global-hex-input" value="#aabbcc">
      <input id="global-color-picker" value="#000000">
    `
    expect(resolveColorInput('global')).toBe('#AABBCC')
  })

  it('normalizes hex field without #', () => {
    document.body.innerHTML = `
      <input id="global-hex-input" value="aabbcc">
      <input id="global-color-picker" value="#000000">
    `
    expect(resolveColorInput('global')).toBe('#AABBCC')
  })

  it('returns null when hex field has invalid text', () => {
    document.body.innerHTML = `
      <input id="global-hex-input" value="nope">
      <input id="global-color-picker" value="#000000">
    `
    expect(resolveColorInput('global')).toBeNull()
  })

  it('falls back to picker when hex field is empty', () => {
    document.body.innerHTML = `
      <input id="global-hex-input" value="">
      <input id="global-color-picker" value="#ff0000">
    `
    expect(resolveColorInput('global')).toBe('#FF0000')
  })

  it('falls back to picker when hex field is whitespace', () => {
    document.body.innerHTML = `
      <input id="global-hex-input" value="   ">
      <input id="global-color-picker" value="#00ff00">
    `
    expect(resolveColorInput('global')).toBe('#00FF00')
  })

  it('works for box type', () => {
    document.body.innerHTML = `
      <input id="box-hex-input" value="#123456">
      <input id="box-color-picker" value="#000000">
    `
    expect(resolveColorInput('box')).toBe('#123456')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/palette.test.js`
Expected: FAIL — `resolveColorInput is not a function`.

**Step 3: Write minimal implementation**

Add `resolveColorInput` to `src/palette.js` (exported):

```js
export function resolveColorInput(type) {
  const hexInput = document.getElementById(type + '-hex-input')
  if (hexInput && hexInput.value.trim()) {
    return normalizeHex(hexInput.value)
  }
  const picker = document.getElementById(type + '-color-picker')
  return picker ? picker.value.toUpperCase() : null
}
```

Then update `addColor` to use it. Replace the body of `addColor(type)` (currently lines 22-43 of `src/palette.js`):

```js
function addColor(type) {
  const hex = resolveColorInput(type)
  if (!hex) return showToast('Invalid hex', 'error')

  if (type === 'global') {
    if (state.globalPalette.length >= 16) return showToast('Maximum 16 colors allowed.', 'error')
    if (!state.globalPalette.includes(hex)) {
      state.globalPalette.push(hex)
      const hexInput = document.getElementById('global-hex-input')
      if (hexInput) hexInput.value = ''
      renderColors('global')
      emit('state:changed')
    }
  } else if (type === 'box' && state.selectedBoxId !== null) {
    const box = state.boxes.find(b => b.id === state.selectedBoxId)
    if (!box) return
    if (box.colors.length >= 5) return showToast('Maximum 5 colors per box.', 'error')
    if (!box.colors.includes(hex)) {
      box.colors.push(hex)
      const hexInput = document.getElementById('box-hex-input')
      if (hexInput) hexInput.value = ''
      renderColors('box')
      emit('state:changed')
    }
  }
}
```

(Note the two new lines that clear the hex field after a successful add — improves repeated-add UX. `removeColor` is unchanged.)

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/palette.test.js`
Expected: PASS (all normalizeHex + resolveColorInput tests).

**Step 5: Commit**

```bash
git add src/palette.js src/__tests__/palette.test.js
git commit -m "feat(palette): addColor reads hex text field first, picker as fallback"
```

---

## Task 3: Add `copyColor` and wire `contextmenu` on swatches

**Files:**
- Modify: `src/palette.js` (add `copyColor`; attach handler in `renderColors`)
- Modify: `src/__tests__/palette.test.js` (add `copyColor` tests)

**Step 1: Write the failing tests**

Append to `src/__tests__/palette.test.js`:

```js
import { normalizeHex, resolveColorInput, copyColor } from '../palette.js'

// ... existing describes ...

describe('copyColor', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.resetAllMocks()
  })

  it('writes hex to clipboard and resolves', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText }, configurable: true,
    })
    await expect(copyColor('#FF00AA')).resolves.toBeUndefined()
    expect(writeText).toHaveBeenCalledWith('#FF00AA')
  })

  it('returns false when clipboard API is missing', async () => {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: undefined, configurable: true,
    })
    await expect(copyColor('#FF00AA')).resolves.toBe(false)
  })

  it('returns false when writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText }, configurable: true,
    })
    await expect(copyColor('#FF00AA')).resolves.toBe(false)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/palette.test.js`
Expected: FAIL — `copyColor is not a function`.

**Step 3: Write minimal implementation**

Add `copyColor` to `src/palette.js` (exported, async):

```js
export async function copyColor(hex) {
  if (!navigator.clipboard?.writeText) return false
  try {
    await navigator.clipboard.writeText(hex)
    showToast('Copied ' + hex)
    return true
  } catch {
    return false
  }
}
```

Then in `renderColors` (currently lines 59-77 of `src/palette.js`), attach a `contextmenu` handler on each swatch. The swatch creation block becomes:

```js
list.forEach((hex) => {
  const swatch = document.createElement('div')
  swatch.className = 'swatch'
  swatch.style.backgroundColor = hex
  swatch.setAttribute('aria-label', `Color ${hex}; right-click to copy, click to remove`)
  swatch.setAttribute('role', 'button')
  swatch.setAttribute('tabindex', '0')
  swatch.innerHTML = '×'
  swatch.onclick = () => removeColor(type, hex)
  swatch.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    copyColor(hex)
  })
  swatch.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); removeColor(type, hex) } }
  container.appendChild(swatch)
})
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/palette.test.js`
Expected: PASS (all tests).

**Step 5: Commit**

```bash
git add src/palette.js src/__tests__/palette.test.js
git commit -m "feat(palette): right-click swatch copies hex to clipboard"
```

---

## Task 4: Add hex text inputs to the HTML

**Files:**
- Modify: `index.html` (two `.color-input-row` blocks: global at line ~2373-2377, box at line ~2615-2619)

This task is DOM markup only — covered by manual verification (no unit test).

**Step 1: Add global hex input**

In `index.html`, find this block (around line 2373):

```html
<div class="color-input-row">
    <label class="sr-only" for="global-color-picker">Global palette color</label>
    <input type="color" id="global-color-picker" value="#d4a853" aria-labelledby="global-palette-label">
    <button id="btn-add-global-color" class="btn btn-ghost" style="padding:7px 12px;font-size:11px;">Add Color</button>
</div>
```

Replace with:

```html
<div class="color-input-row">
    <label class="sr-only" for="global-color-picker">Global palette color</label>
    <input type="color" id="global-color-picker" value="#d4a853" aria-labelledby="global-palette-label">
    <label class="sr-only" for="global-hex-input">Global palette hex</label>
    <input type="text" id="global-hex-input" placeholder="#RRGGBB" maxlength="7" style="width:84px;font-family:var(--font-mono);font-size:11px;text-transform:uppercase;">
    <button id="btn-add-global-color" class="btn btn-ghost" style="padding:7px 12px;font-size:11px;">Add Color</button>
</div>
```

**Step 2: Add box hex input**

Find the matching block around line 2615:

```html
<div class="color-input-row">
    <label class="sr-only" for="box-color-picker">Box palette color</label>
    <input type="color" id="box-color-picker" value="#d4a853" aria-labelledby="box-palette-label">
    <button id="btn-add-box-color" class="btn btn-ghost" style="padding:7px 12px;font-size:11px;">Add Color</button>
</div>
```

Replace with:

```html
<div class="color-input-row">
    <label class="sr-only" for="box-color-picker">Box palette color</label>
    <input type="color" id="box-color-picker" value="#d4a853" aria-labelledby="box-palette-label">
    <label class="sr-only" for="box-hex-input">Box palette hex</label>
    <input type="text" id="box-hex-input" placeholder="#RRGGBB" maxlength="7" style="width:84px;font-family:var(--font-mono);font-size:11px;text-transform:uppercase;">
    <button id="btn-add-box-color" class="btn btn-ghost" style="padding:7px 12px;font-size:11px;">Add Color</button>
</div>
```

**Step 3: Verify `--font-mono` exists**

Run: `rg "\-\-font-mono" index.html DESIGN.md`
Expected: at least one match defining or using `--font-mono`. If absent, replace `var(--font-mono)` with `monospace` in both inputs above.

**Step 4: Manual smoke test**

1. Restart or hard-reload the app in the browser.
2. Global palette: type `#a1b2c3` in the new hex field → click Add Color → swatch appears.
3. Type `nope` → click Add Color → toast `Invalid hex`, no swatch added.
4. Box palette: select a box, type `ff00aa` (no `#`) in the box hex field → Add Color → swatch appears as `#FF00AA`.
5. Right-click any swatch → toast `Copied #XXXXXX` → paste into the hex field (Cmd+V) → Add Color → color re-added on the target.
6. Right-click a swatch, then paste outside the app (e.g. a text editor) → confirms system clipboard works.
7. Existing flows unaffected: clicking a swatch still removes it; native picker still works for users where it functions.

**Step 5: Commit**

```bash
git add index.html
git commit -m "feat(palette): add hex text inputs for global and box palettes"
```

---

## Task 5: Full test-suite verification

**Step 1: Run the whole suite**

Run: `npx vitest run`
Expected: all pre-existing tests (`ai-enhancer`, `events`, `json-builder`, `png-import`, `runpod`, `state`) AND the new `palette` tests pass.

**Step 2: Lint / typecheck**

This is a vanilla-JS project with no build step and no configured linter — nothing to run. (Confirm with `cat package.json | grep -E 'lint|typecheck'` — expect no matches.)

**Step 3: Final commit (only if anything changed)**

Only commit if steps 1-2 surfaced edits. Otherwise done.
