# DESIGN.md

The canonical design language for the Helio frontend. This is the visual/UX
counterpart to `CONTRIBUTING.md`: **binding** for any agent or contributor
touching `frontend/`. Reviewers (and the Skeptic gate) judge UI changes against
this document — "consistent with existing patterns" means _consistent with what
is written here_, not inferred from scattered code.

> **Status:** v2 — the "curated instrument" redesign (2026-07-02). Supersedes
> the v1 draft; the former OPEN DECISIONS (intent tokens, weight tokens,
> breakpoints, overlay token, focus offset) are now ratified and encoded in
> `theme.css`. Verified against source at time of writing.

---

## How to use this doc

- **Before** writing or reviewing frontend code, read this file.
- Rules are tagged **[mechanical]** (deterministically checkable — greppable or
  lintable) or **[judgment]** (requires looking at the rendered result — the
  Skeptic's domain).
- When a rule and a deadline conflict, follow the rule or escalate the conflict.
  Never silently diverge.

---

## 0. The design idea (read this first)

Helio's language is a **curated instrument**: warm neutral structure, one
deliberate voice of color, serif brand moments, mono annotations.

1. **Structure is neutral.** Backgrounds, surfaces, and borders come from warm
   neutral ramps ("stone" in dark, "paper" in light) — never from the accent.
2. **Surfaces are opaque.** Cards, popovers, modals, and menus never let the
   page bleed through. Translucency exists only where the user explicitly opts
   in (the panel transparency slider). This is the invariant that keeps custom
   dashboard backgrounds from tinting the whole UI.
3. **The accent is scarce and solid.** The user-selected accent appears as:
   solid primary buttons (with `--app-accent-ink` text), the active nav
   indicator, selection/checked states (`--app-accent-dim` washes), focus
   rings, and the OrbitMark. It is **never** used for structural borders,
   hover washes on neutral controls, table headers, or atmosphere.
   **[judgment]** If a screen looks "tinted", accent discipline has broken.
4. **Type is a trio.** Fraunces (display serif) for brand/headline moments;
   Schibsted Grotesk for all UI; JetBrains Mono for data, code, and labels.
5. **Details are gallery-grade.** Hairline borders, soft layered shadows,
   mono uppercase eyebrows, tabular numerals, one entrance animation per
   surface — nothing gratuitous.

## 1. Styling approach

- Styling is **plain CSS, organized as co-located CSS Modules** (one `.css` file
  per component, e.g. `Modal.tsx` + `Modal.css`). Design tokens live centrally in
  `frontend/src/theme/theme.css`. No Tailwind, styled-components, CSS-in-JS, or
  SCSS. Do not introduce a new styling system.
- Apply styles via `className`. **[mechanical]** Inline `style={{}}` is allowed
  **only** for genuinely dynamic values that can't live in CSS — portal/popover
  positioning and user-driven appearance overrides.
- Class naming is BEM-ish (`.panel-card`, `.panel-card__header`,
  `.panel-card--dragging`). Follow it for new styles.

## 2. Theme system

- Light/dark is driven by `ThemeProvider` (`src/theme/ThemeProvider.tsx`), which
  sets `data-theme` on `<html>` and persists choice to `localStorage`.
- Tokens are CSS custom properties in `src/theme/theme.css`, split into
  `:root[data-theme="dark"]` and `:root[data-theme="light"]` blocks.
- **Accent is user-customizable** (8 presets in `src/theme/theme.ts`). At
  runtime `applyAccentTokens()` writes exactly **two** properties:
  `--app-accent` and `--app-accent-ink` (readable text on solid accent).
  Every other accent token is **derived in CSS** with `color-mix`.
  **[mechanical]** Never hardcode the accent; never write additional accent
  tokens from JS; never derive borders/backgrounds from the accent.

## 3. Tokens are the source of truth

All visual values come from the custom properties in `theme.css`. **Never
hardcode a value a token exists for.** **[mechanical]**

### Color (themed; tokens are `--app-*`)

| Purpose           | Tokens                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text              | `--app-text`, `--app-text-muted`                                                                                                                                                       |
| Canvas / surfaces | `--app-bg` (canvas) → `--app-surface-soft` (recessed wells/inputs) → `--app-surface` (cards/chrome) → `--app-surface-raised` (hover) → `--app-surface-strong` (modals/popovers/toasts) |
| Accent (user-set) | `--app-accent`, `--app-accent-ink`, `--app-accent-strong` (hover), `--app-accent-surface` / `--app-accent-dim` (selection washes), `--app-accent-mid` (selection borders)              |
| Border            | `--app-border-subtle` (default hairline), `--app-border-strong` (hover/emphasis) — **neutral, never accent-tinted**                                                                    |
| Intent            | `--app-success`, `--app-warning`, `--app-error` (+ `--app-*-surface` washes), `--app-info` (→ accent). `--app-danger` aliases error.                                                   |
| Overlay / texture | `--app-overlay` (modal backdrop), `--canvas-dot` (neutral dot field)                                                                                                                   |

- **[mechanical]** No hardcoded hex/rgb/rgba in component CSS or TSX where a
  token applies. Intent colors always come from the intent tokens.
- **Documented exception:** accent _preset swatches_ (`AccentPicker`),
  dashboard appearance presets, and chart series palettes are **data**, not
  styling — literal colors are fine there.

### Surfaces & the opacity invariant

- `--app-surface*` are **opaque**. `buildPanelSurface()` returns alpha 1.0 at
  `transparency: 0`; the dashboard grid override resolves opaque.
  **[mechanical]** Do not add translucent surfaces or `backdrop-filter`
  glass effects to structural chrome.
- The dot-grid texture is painted only on canvas areas (`.app-content`,
  auth pages) via `--canvas-dot`, derived from the text color — never the
  accent, never as an overlay above interactive chrome.

### Spacing (theme-invariant; 4px base)

`--space-1` 4px … `--space-10` 64px (unchanged scale).
**[mechanical]** All margin/padding/gap use a `--space-*` token (small optical
tweaks ≤ 4px may be literal).

### Control metrics

Every button, input, and select uses a control-height token:
`--control-sm` 28px (bar/compact controls) · `--control-md` 32px (default
inputs & buttons) · `--control-lg` 40px (auth/hero). Inline mini icon-buttons
inside dense rows may be 24px. **[mechanical]** No other control heights.

### Typography

- Families: `--font-sans` = **Schibsted Grotesk** (all UI), `--font-display` =
  **Fraunces** (brand/headline moments only), `--font-mono` =
  **JetBrains Mono** (data, code, eyebrows/labels). **[mechanical]** No ad-hoc
  `font-family`.
- Type scale: `--text-micro` 10px, `--text-xs` 12px, `--text-sm` 14px (body
  default), `--text-base` 16px, `--text-lg` 18px, `--text-xl` 20px,
  `--text-2xl` 24px, `--text-3xl` 30px.
  **[mechanical]** Every `font-size` uses a token — no literal px/rem.
- Weights: `--weight-regular/medium/semibold/bold` (400/500/600/700).
  **[mechanical]** No numeric `font-weight` literals.
- **Where Fraunces goes** [judgment]: the wordmark, auth headlines, main
  empty-state titles. It never sets body copy, controls, or data.
- **Eyebrows** (section labels): mono, `--text-micro`, uppercase, tracked
  `--eyebrow-tracking`. Use the `.eyebrow` utility or copy its recipe.
- `.mono` utility for tabular numerals; metric values are mono.

### Radius / Shadow / Motion

- Radius: `--app-radius-sm` 6px (controls), `--app-radius-md` 9px (menus,
  small cards), `--app-radius-lg` 14px (cards, modals), `--app-radius-pill`.
- Shadow: `--app-shadow-card` (resting cards), `--app-shadow-soft`
  (overlays/hover-lift). Borders do the separating; shadows stay soft.
- Motion: `--app-transition` (0.16s, hover/color), `--transition-slow`
  (0.28s, entrances). Modals/popovers/auth card animate in once (fade +
  4–10px rise). `prefers-reduced-motion` is respected globally.
  **[judgment]** No scattered micro-animations; one entrance per surface.

## 4. Breakpoints

Canonical set, shared with React Grid Layout (`panelGridConfig.ts`):
**1440 / 1100 / 768**. CSS media queries use these values only. Container
queries on `panel-card` handle panel-internal density and are the right tool
for that job. **[mechanical]**

## 5. Buttons

Until a shared `Button` component exists, every button follows one of these
recipes (match metrics exactly; see `Modal.css` / `App.css` for reference):

- **Primary** — solid `--app-accent`, text `--app-accent-ink`, hover
  `--app-accent-strong`, no border. One primary per view/section.
- **Secondary** — transparent bg, `--app-border-subtle` hairline, muted text;
  hover: `--app-border-strong` + `--app-surface-raised` + full text.
- **Ghost** — borderless, muted text; hover `--app-surface-raised`.
- **Danger** — hairline `color-mix(error 60%)`, error text; hover
  `--app-error-surface`. Solid error only for final confirm actions.

All at `--control-sm/md` height, `--app-radius-sm`, `--weight-medium`,
`--text-xs/sm`. **[judgment]** A new button style is a defect, not a variant.

## 6. Shared components — reuse, don't reinvent

Canonical primitives in `frontend/src/shared/ui/`: **Modal** (sizes sm/md/lg,
native `<dialog>`, `--app-overlay` backdrop), **TextField**, **Textarea**,
**Select** (portal-based), **EmptyState** (variants `main`/`sidebar`; `main`
titles are Fraunces), **Toast** (intents info/success/warning/error),
**DataGrid** (table-shaped data primitive; variants `preview`/`full`, cell
density `condensed`/`normal`/`spacious` — see below).
Chrome in `frontend/src/shared/chrome/`: **Popover** (opaque
`--app-surface-strong`), **ActionsMenu**, **SidebarItemList**,
**StatusMessage**, **InlineError**, **SaveStateIndicator**, **AccentPicker**.

Use these; do not hand-roll equivalents. **[mechanical]** (raw-element
detection) **+ [judgment]**

### DataGrid cell density

`DataGrid` (`frontend/src/shared/ui/DataGrid.tsx`) exposes a `density` prop —
`"condensed" | "normal" | "spacious"` — controlling cell padding and font
size (line-height scales proportionally with the font-size token):

| Density     | Padding                   | Font size     |
| ----------- | ------------------------- | ------------- |
| `condensed` | `--space-1` / `--space-2` | `--text-xs`   |
| `normal`    | `--space-2` / `--space-3` | `--text-sm`   |
| `spacious`  | `--space-3` / `--space-4` | `--text-base` |

Density defaults from the grid's `variant` when omitted: `preview` →
`condensed`, `full` → `normal`. Consumers should rely on this default rather
than pass an explicit `density`, unless the surface has a documented reason to
diverge. **[mechanical]**

## 7. UI state patterns (loading / empty / error)

Every data-backed view handles all three, **consistently**:

- **Loading:** the established spinner pattern (border-spinner in accent) or a
  skeleton — never a flash of empty content.
- **Empty:** render `EmptyState` — never render nothing.
- **Error:** visible, human-readable, intent-error styled — **never swallow a
  failed fetch.** **[judgment]**
- **Toasts** are transient feedback (bottom-right, auto-dismiss ~4s) — not a
  substitute for inline error/empty states.

## 8. Accessibility baseline

- Interactive elements have accessible names (ARIA/text). **[mechanical]**
- Focus: the global rule is `outline: 2px solid var(--app-accent)` at
  `outline-offset: 2px`; use `-2px` inset only where the ring would clip
  (flush list items). Inputs replace the ring with an accent border +
  `--app-accent-dim` halo. **[mechanical]**
- `--app-accent-ink` is contrast-computed per accent; never place raw white
  text on the accent. Color is never the sole carrier of meaning.
- Keyboard operable; dialogs handle Enter/Escape.
