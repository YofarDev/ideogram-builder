# Vision Tab Rework — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the JSON textarea from the right-column audit section to the left column (replacing static info text) once an image loads.

**Architecture:** Pure HTML/CSS layout change + one class toggle in vision.js. The `#vision-json` element moves in the DOM but retains its ID — audit.js and vision.js reference it by ID, so no JS logic changes needed.

**Tech Stack:** Vanilla JS, CSS, HTML

---

### Task 1: Move JSON textarea to left column + add CSS swap

**Files:**
- Modify: `index.html` (HTML structure + CSS)

**Step 1: Add `.vision-left-json` container in left column**

In the left column (`.vision-info`), after `.vision-formats`, add a JSON textarea container that's hidden by default:

```html
<div class="vision-left-json" id="vision-left-json">
    <label class="vision-json-label" for="vision-json">Caption JSON</label>
    <textarea id="vision-json" class="vision-json-input" placeholder="Paste JSON here to audit, or process an image first..." spellcheck="false"></textarea>
</div>
```

**Step 2: Remove `#vision-json` from the audit section**

In `.vision-audit`, remove the `<textarea id="vision-json"...>` line. The audit section now only has controls + suggestions div.

**Step 3: Add CSS classes for visibility swap**

```css
.vision-left-json { display: none; flex-direction: column; flex: 1; }
.vision-body.has-image .vision-info > :not(.vision-options):not(.vision-left-json) { display: none; }
.vision-body.has-image .vision-left-json { display: flex; }
.vision-body.has-image .vision-options { margin-top: auto; padding-top: 12px; border-top: 1px solid var(--border); }
.vision-json-label {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px;
    color: var(--text-muted, #888); margin-bottom: 6px;
}
```

The `.vision-info` stays in the DOM but its children (heading, subtitle, format tags) are hidden; `.vision-left-json` becomes visible; `.vision-options` stays at the bottom.

**Step 4: Adjust audit section CSS**

Remove the border-top and margin from `.vision-audit` since it no longer leads the section — the left-column JSON textarea is now above it.

```css
.vision-audit {
    display: block; margin: 8px 0 0;
    padding-top: 8px; border-top: 1px solid var(--border, #333);
}
```

**Step 5: Run tests**

Run: `npx vitest run`
Expected: 212 passed

**Step 6: Commit**

```bash
git add index.html
git commit -m "feat: move vision JSON textarea to left column, show on image load"
```

---

### Task 2: Toggle `.has-image` class on vision body

**Files:**
- Modify: `src/vision.js`

**Step 1: Add class toggle in `handleFile`**

After the line that sets `preview.classList.add('visible')`, add:

```javascript
document.querySelector('.vision-body').classList.add('has-image');
```

This triggers the CSS swap — hiding the info text and showing the JSON textarea.

**Step 2: Run tests**

Run: `npx vitest run`
Expected: 212 passed

**Step 3: Commit**

```bash
git add src/vision.js
git commit -m "feat: toggle has-image class on vision-body when image loads"
```

---

### Task 3: Remove unused `#vision-json` reference from audit section

**Files:**
- Modify: `index.html` (already done in Task 1 Step 2 — verify)

No JS changes needed — `audit.js` reads `document.getElementById('vision-json')` which now resolves to the left-column textarea. Same for `vision.js` which writes to it.

**Step 1: Verify the element moved but ID is unchanged**

Check that `#vision-json` appears exactly once in index.html:
Run: `grep -c 'id="vision-json"' index.html`
Expected: `1`

**Step 2: Run full test suite**

Run: `npx vitest run`
Expected: 212 passed

**Step 3: Commit (if any remaining)**

```bash
git add -A
git commit -m "feat: vision tab rework — JSON moves to left column on image load"
```
