# Design

Reference for the visual system. Generated from `index.html` `:root` after the impeccable audit pass.

## Register

Product. Design serves the canvas. Controls stay out of the way until they're needed.

## Scene

Darkroom, not cockpit. An image artist working in a dim studio at 2am, multi-monitor, mid-iteration. Ambient light low, attention focused. The interface disappears when the work is flowing; surfaces are quiet, the gold accent earns its presence by carrying focus.

## Strategy

Restrained. Tinted neutrals carry 90% of the surface; one accent (gold) carries focus, selection, and primary actions. Danger (burnt sienna) appears only for destructive affordances. No second accent.

## Color

All values in OKLCH. Neutrals are tinted toward the accent hue (chroma held near zero but never pure gray).

| Token | Value | Role |
|-------|-------|------|
| `--bg` | `oklch(14.5% 0.008 75)` | Page base, deepest ground |
| `--surface` | `oklch(21.5% 0.008 65)` | Panels, toolbars, sections |
| `--surface-2` | `oklch(26% 0.008 70)` | Insets, inputs, wells |
| `--text` | `oklch(90% 0.022 75)` | Body copy |
| `--text-label` | `oklch(70% 0.022 70)` | Field labels |
| `--text-muted` | `oklch(56% 0.022 65)` | Secondary text, 4.7:1 on bg |
| `--text-dim` | `oklch(63% 0.025 70)` | Tertiary text, 5.4:1 on bg (AA-safe) |
| `--text-faint` | `oklch(48% 0.02 70)` | Decorative only, never body copy |
| `--accent` | `oklch(74% 0.115 80)` | Gold. Focus, selection, primary CTA |
| `--accent-hover` | `oklch(78% 0.115 82)` | Brighter hover state |
| `--accent-dim` | `oklch(74% 0.115 80 / 0.12)` | Accent fills at low saturation |
| `--accent-faint` | `oklch(74% 0.115 80 / 0.05)` | Subtle hover tints on rows / dropzones |
| `--accent-glow` | `oklch(74% 0.115 80 / 0.25)` | Selection rings, hover glows |
| `--on-accent` | `oklch(14.5% 0.008 75)` | Text/icon color on gold fills |
| `--danger` | `oklch(56% 0.13 50)` | Destructive actions only |
| `--danger-dim` | `oklch(56% 0.13 50 / 0.15)` | Danger hover backgrounds |
| `--hairline` | `oklch(74% 0.115 80 / 0.10)` | Default 1px borders |
| `--hairline-strong` | `oklch(74% 0.115 80 / 0.20)` | Inputs, dividers |
| `--hairline-hover` | `oklch(74% 0.115 80 / 0.35)` | Hover state on borders |
| `--shadow-weak` | `0 1px 3px oklch(10% 0.008 75 / 0.35)` | Handles, low-elevation chips |
| `--shadow-strong` | `0 4px 20px oklch(10% 0.008 75 / 0.5)` | Toasts, floating overlays |
| `--selection` | `oklch(74% 0.115 80 / 0.3)` | `::selection` background |

Backwards-compatible aliases: `--border = --hairline`, `--border-strong = --hairline-strong`.

### Bans in effect

- No pure `#000` or `#fff`. Neutrals always carry chroma 0.008-0.025 toward the accent hue.
- No gradient text, no side-stripe accents, no decorative glassmorphism.
- Shadows are tinted toward bg, never neutral black.

## Typography

- **Display:** DM Serif Display (italic available for the wordmark). Used for panel titles, tab labels, modal headings. Weight 400 only.
- **Body:** DM Sans. 13px base, 1.5 line-height. Optical sizing 9..40.
- **Mono:** DM Mono. 11.5px for JSON output. Weight 400.

Hierarchy is carried by family swap (display vs body) and weight contrast (400 vs 500/600), not by scale alone.

## Spacing

- Page: 16px padding, 16px gap between major sections.
- Panels: 14-16px header/body padding.
- Inputs: 8-10px padding, 5-6px label-to-input.
- Section gaps: 12px between input-groups, 24px between toolbar sections.

## Radius

- `--radius`: 8px (surfaces, containers).
- `--radius-sm`: 5px (inputs, buttons, pills interior).

## Elevation

Single-step elevation via 1px hairline + `--shadow-strong` on truly floating elements (toasts). No multi-level shadow system; the design is flat by intent.

## Motion

- All transitions 0.15-0.25s, ease-out (no bounce, no elastic).
- `prefers-reduced-motion` zeroes all durations globally.
- Never animate layout properties; transform and opacity only.

## Focus

Gold outline on every interactive control. `:focus-visible` carries the ring; `:focus` is suppressed for mouse users where it would be noisy.

## Components

### Buttons
- `.btn-primary` — gold fill, `--on-accent` text, glow on hover.
- `.btn-secondary` — transparent, hairline border, muted text.
- `.btn-ghost` — transparent, accent text, dimmer hairline.
- `.btn-danger` — transparent, danger text, danger-tinted hover.

### Pills (`.pill-group`)
Radio-backed toggle. Active label takes gold fill + `--on-accent` text. Group has `role="radiogroup"`, labeled by an external span.

### Panels
`.panel` + `.panel-header` + `.panel-body`. Section grouping via `<fieldset class="panel-section">` with `<legend class="panel-section-title">`. No side-stripe accent; the heading family swap carries identity.

### Bounding boxes
1.5px hairline-hover border in default state, dimmed when another box is selected. Selected box gets 2px dashed accent border + glow. Handles: 8px corner indicators (non-interactive), 10px round resize handle with extended `::before` hit area for touch.

### Canvas
Grid-dotted background (`radial-gradient` of `--accent-dim`) when empty; flat `--bg` when populated. CSS `transform: scale()` fits to viewport. `touch-action: none`, `user-select: none`.

### Toasts
Bottom-right stack. 13px body, `--shadow-strong`, hairline-strong border. Three modifiers: default, `.toast-error`, `.toast-success`.

## Accessibility floor

- WCAG AA contrast on all text (`--text-dim` lifted to 5.4:1 on bg).
- All form labels associated via `for`/`id`.
- Icon-only buttons carry `aria-label`.
- Decorative SVGs marked `aria-hidden="true"`.
- Toggle buttons (`size-btn`) expose `aria-pressed`.
- Touch targets ≥24px on all controls (WCAG 2.5.8 AA). Resize handle hit area extended via pseudo-element.
- Status regions use `role="status"` + `aria-live="polite"` (AI status, generate status, vision status, dimension display).
- `prefers-reduced-motion` honored globally.

## Out of scope (intentional)

- No light theme. The darkroom aesthetic is the product.
- No glassmorphism. Surfaces are solid.
- No modal. JSON load is inline.
- No second accent. Gold alone carries emphasis.
