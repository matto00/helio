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
   dashboard backgrounds from tinting the whole UI. **Carve-out (HEL-774):**
   the phone bottom tab bar (`BottomNav`) alone is exempt — it renders as a
   translucent "liquid glass" floating capsule. Because dashboard backgrounds
   are exactly the arbitrary content this bar floats over, the opacity
   invariant is replaced for this one element by a stated, measured contrast
   floor rather than relaxed without a constraint; see "Surfaces & the
   opacity invariant" below for the floor's value and scope. No other
   surface is exempt.
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
  glass effects to structural chrome, **except** the phone bottom tab bar
  (`BottomNav`, see the carve-out below) and the page-behind-overlay scrim
  carve-out immediately following. **Carve-out:** the page-behind-overlay
  scrim (`--app-overlay`, whether painted via a native `<dialog>`'s
  `::backdrop` or a portalled backdrop element) may use `backdrop-filter:
blur(1–2px)` to separate the modal from the page behind it — this blurs
  the page, not the modal, so it doesn't touch the opacity invariant.
  `Modal.css`, `PanelCreationModal.css`, and `PanelDetailModal.css` all do
  this consistently. `RefinementChatDrawer` and `MobileNavSheet`'s backdrops
  intentionally stay flat (no blur) — they're lighter-weight, higher-frequency
  overlays (drawer/sheet, not a native dialog), and matching them is not
  required for consistency. Surface backgrounds (modal/popover/menu bodies)
  remain fully prohibited from translucency.

- **Carve-out (HEL-774): the phone bottom tab bar.** `BottomNav` is a
  floating, translucent "liquid glass" capsule (Apple/Instagram tab-bar
  language) — the one exception to "surfaces are opaque" in the whole app.
  Every other surface — top bar, sidebar, popovers, modals, menus — stays
  fully opaque; this carve-out does not widen. What replaces the invariant
  for this element is a **measured contrast floor**, not an eyeballed
  judgment call:
  - **Material.** A small-radius `backdrop-filter: blur(10–16px)` (with the
    `-webkit-` prefix) over a distinct tint layer of `--app-surface` at
    alpha 0.55, composited between the blur and the glyphs — never a
    translucent `background` on the bar itself. The bar carries no visible
    text (icon-only, D4 of the HEL-774 design), which is what permits a 3:1
    rather than a 4.5:1 floor below.
  - **Glyph floor: >=3:1** (WCAG 1.4.11, non-text contrast) for every icon
    rendered against the translucent material, measured from rendered
    pixels — not computed from source — against a photo backdrop, pure
    white, pure black, and the accent colour, in both themes. This is why
    inactive tabs use full-strength `--app-text` rather than
    `--app-text-muted`: measured worst case, the muted token cannot clear
    even 3:1 over this material at any usable alpha.
  - **Active-lozenge floor: >=3:1.** The active tab is a bordered material
    lozenge nested inside the capsule, not an accent block or an underline.
    Its boundary must reach >=3:1 against the adjacent capsule material,
    measured the same way. The lozenge's hairline uses full-strength
    `var(--app-text)` as its border colour — outside this document's usual
    two-token border vocabulary (`--app-border-subtle`/`-strong`) — because
    it is the only thing that actually carries the lozenge's visibility: a
    `color-mix`-weakened border falls below the floor, and any fill drawn
    from the neutral surface ramp converges to near-invisible against the
    capsule once composited. `--app-accent` still marks the active icon, but
    it is never the sole indicator — the lozenge boundary is.
  - **Accent-on-surface, stated honestly.** Because the lozenge's fill reuses
    `--app-surface`, the active icon's own accent-on-surface contrast moves
    only slightly from today's opaque bar: dark theme drops by at most 0.49
    across the eight shipped presets, with no preset falling below 4.24:1;
    light theme moves by at most 0.18 and remains within a pre-existing
    1.78–3.71:1 shortfall for several presets that this change neither
    introduces nor materially worsens (a separate, pre-existing app-wide
    accent-on-surface gap, tracked as a spinoff). The lozenge boundary, not
    the accent icon, is what this carve-out's contrast guarantee rests on.

  - **Focus-ring exception: `outline-offset: -3px`.** §8's default focus rule
    is `[mechanical]` and sanctions exactly `2px`, or `-2px` "only where the
    ring would clip (flush list items)". The bottom nav's pill-shaped tabs are
    a documented exception to that rule, measured as two distinct effects:
    applying §8's recipe **literally** (`-2px` with no `border-radius` on the
    tab) leaks 455/433 accent pixels outside the capsule at the first/last
    tabs, up to ~5.02px of overhang — the genuine "hard rectangle" case. Once
    the tab itself carries `border-radius: var(--app-radius-pill)`, that
    overhang is gone at `-2px`; the remaining reason for `-3px` is hairline
    clearance, not overhang — at `-2px` the nearest ring pixel sits 1.50px
    inside the capsule boundary, colliding visually with the capsule's own
    `--app-border-strong` hairline, while `-3px` sits 2.50px inside and clears
    it. Verified from rendered pixels: 0 ring pixels fall outside the
    capsule's rounded shape at the first and last tabs, in both themes.

  Verification for all of the above is by rendered/sampled pixels, never by
  reading CSS source — `backdrop-filter` is a compositing operation whose
  result cannot be read off a stylesheet.

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
inside dense rows may be 24px. A fifth, mobile-only value applies at the
430/768 breakpoints: interactive controls reachable on phone (buttons, select
triggers/options, CTAs) get a literal `44px` min-height/min-width tap-target
floor (HEL-308/314/319) — this is intentional, not drift; it does not apply
at desktop widths. Native `input[type="color"]` swatches (accent/appearance
pickers) are also exempt, sized for visual color-swatch clarity rather than
by a control token. For a painted chrome control that must not visually grow
(border/background present, product decision against inflating it — e.g. the
mobile command bar's icon buttons and avatar trigger, HEL-772), the sanctioned
alternative is a sized `::after` hit expander (`width: 44px; height: 44px;
top/left: 50%; transform: translate(-50%, -50%)` on a `position: relative`
control) rather than `min-width`/`min-height`, which would grow the box. The
expander extends `(44 - controlSize) / 2` per side (8px for a 28px control),
so a cluster of expander-based controls needs a gap of at least twice that
(16px for 28px controls), or adjacent hit regions overlap and the
later-painted sibling steals the earlier control's taps in the overlapping
band (HEL-772 measured a real horizontal extent of 35.75px at an 8px gap,
against a `::after` that still computed a full 44px). Neither
`getComputedStyle(el, "::after").width` nor sampling neighbouring painted
boxes for overlap can detect this — the failure is region-vs-region, not
box-vs-box — so verification must bisect each control's real hit extent with
`elementFromPoint`. A correctly tiled, abutting hit region legitimately
bisects to just under 44px (~43.75px at a 0.25px sampling step), so the
assertion threshold needs an epsilon (`>= 44 - samplingStep`, never a literal
`>= 44`); the gap must never be widened past the tiling point to force the
number over 44 — the threshold takes the epsilon, not the gap.
**[mechanical]** No other control heights.

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
  (0.28s, entrances), `--app-skeleton-shimmer` (1.6s, the `Skeleton`
  primitive's shimmer loop). The first two are transition _shorthands_ tuned
  for a single hover or one-shot entrance; a continuous loop needs its own
  duration token rather than reusing either (0.28s repeated indefinitely
  strobes). Modals/popovers/auth card animate in once (fade + 4–10px rise).
  `prefers-reduced-motion` is respected globally — but see `Skeleton`'s own
  explicit override below; the global rule alone does not fully disable a
  looping animation. **[judgment]** No scattered micro-animations; one
  entrance per surface.

## 4. Breakpoints

Canonical set, shared with React Grid Layout (`panelGridConfig.ts`):
**1440 / 1100 / 768 / 430**. CSS media queries use these values only. Container
queries on `panel-card` handle panel-internal density and are the right tool
for that job. **[mechanical]**

**430 (phone, ratified HEL-300):** the mobile PWA shell needs a sub-768 phone
breakpoint; 430px covers every iPhone portrait width (the largest is
430–440pt) while staying clear of small tablets. `PanelDetailModal.css`'s
pre-existing, unratified `480px` query was folded into this value.

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

### Icon-only buttons

Icon-only controls (kebab menus, close buttons, theme toggle, sidebar
collapse, row-action icons) use the shared `IconButton` primitive
(`frontend/src/shared/ui/IconButton.tsx`) — never a hand-rolled
`<button className="...">` square. It formalizes the same
Ghost/Secondary/Danger recipes above at icon-only sizing:

- **`variant`**: `ghost` (borderless, default) | `secondary` (hairline
  border) | `danger` (error-tinted hover). Same color/hover treatment as
  the labeled recipes above, just without the horizontal padding.
- **`size`**: `xs` (24px, the dense-row exception — inline row actions in
  lists) | `sm` (`--control-sm`, default) | `md` (`--control-md`).
- **`aria-label`** is a required, non-optional prop — TypeScript, not a
  lint rule, rejects a missing accessible name at compile time. **[mechanical]**
- **Tooltip pattern**: `title` defaults to `aria-label`'s value, so every
  `IconButton` gets a visible native tooltip for free. Pass a distinct,
  shorter/different `title` when it should diverge from the (often more
  verbose, task-focused) `aria-label` — e.g.
  `aria-label="Refine this dashboard with AI"` / `title="Refine with AI"`,
  or a keyboard-shortcut hint (`title="Undo (Ctrl+Z)"`). This is the
  general rule for **every** icon-only interactive element in the app, not
  just `IconButton` instances: a visible tooltip (`title`) or an accessible
  name (`aria-label`/`aria-labelledby`) is required, and pairing both is
  the default expectation. **[mechanical]**
- Forwards `ref` to the underlying `<button>` for `usePortalPopover`-style
  triggers that need a real DOM node (e.g.
  `DashboardAppearanceEditor`'s "Customize dashboard appearance" trigger).
- A hand-rolled icon-only control is acceptable only when it has a genuine,
  documented reason `IconButton`'s scale can't express (e.g. a sub-24px
  compact size, like `Toast`'s 20px dismiss button, or a state-dependent
  accent color `IconButton`'s variants don't cover) — it must still carry
  both `aria-label` and `title`. **[judgment]**

## 6. Shared components — reuse, don't reinvent

Canonical primitives in `frontend/src/shared/ui/`: **Modal** (sizes sm/md/lg,
native `<dialog>`, `--app-overlay` backdrop), **TextField**, **Textarea**,
**Select** (portal-based), **IconButton** (icon-only button — ghost/
secondary/danger variants, required `aria-label`, `title`-defaults-to-
`aria-label` tooltip — see §5), **EmptyState** (variants `main`/`sidebar`;
`main` titles are Fraunces), **Toast** (intents info/success/warning/error),
**DataGrid** (table-shaped data primitive; variants `preview`/`full`, cell
density `condensed`/`normal`/`spacious` — see below), **FormField** (label +
control + help/error layout — the one form-row recipe; new forms use it instead
of re-deriving `.xxx__field`), **StatusChip** (intent-colored status pill —
the one pill recipe), **Spinner** (the border-spinner loading indicator),
**Skeleton** (`block`/`line`/`circle` shimmer placeholder — initial
structural loads with a predictable resolved size; `Spinner` remains for
short in-place work over already-rendered structure — see §7),
**ConfirmInline** (inline confirm/cancel for destructive row actions — Helio
never uses `window.confirm`), **useScrollEdges** (scroll-shadow edge state
for overflowing lists/grids).
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
