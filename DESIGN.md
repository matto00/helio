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
  runtime `applyAccentTokens()` writes `--app-accent`/`--app-accent-ink`
  (readable text on solid accent), plus three DERIVED, non-brand
  obligation tokens that exist because `color-mix` alone cannot guarantee
  a WCAG floor: `--app-focus-ring-color` (HEL-1046, 3:1 non-text, theme-
  independent), `--app-accent-text` (HEL-1048, 4.5:1 text, theme-AWARE —
  see §8), and `--app-selection-bg` (HEL-1048 D7, `::selection`'s opaque
  background). Every OTHER accent token (`-strong`, `-surface`, `-dim`,
  `-mid`, …) is still **derived in CSS** with `color-mix`.
  **[mechanical]** Never hardcode the accent; never write additional accent
  tokens from JS without a stated WCAG obligation backing them; never
  derive borders/backgrounds from the accent.

## 3. Tokens are the source of truth

All visual values come from the custom properties in `theme.css`. **Never
hardcode a value a token exists for.** **[mechanical]**

### Color (themed; tokens are `--app-*`)

| Purpose           | Tokens                                                                                                                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text              | `--app-text`, `--app-text-muted`                                                                                                                                                                                                                               |
| Canvas / surfaces | `--app-bg` (canvas) → `--app-surface-soft` (recessed wells/inputs; **also the default interactive-state background — see the HEL-866 note below**) → `--app-surface` (cards/chrome) → `--app-surface-raised` → `--app-surface-strong` (modals/popovers/toasts) |
| Accent (user-set) | `--app-accent`, `--app-accent-ink`, `--app-accent-strong` (hover), `--app-accent-surface` / `--app-accent-dim` (selection washes), `--app-accent-mid` (selection borders)                                                                                      |
| Border            | `--app-border-subtle` (default hairline), `--app-border-strong` (hover/emphasis) — **neutral, never accent-tinted**                                                                                                                                            |
| Intent            | `--app-success`, `--app-warning`, `--app-error` (+ `--app-*-surface` washes), `--app-info` (→ accent). `--app-danger` aliases error.                                                                                                                           |
| Overlay / texture | `--app-overlay` (modal backdrop), `--canvas-dot` (neutral dot field)                                                                                                                                                                                           |

**HEL-866 — which rung is correct depends on the REAL BACKDROP a state composites against, and that backdrop varies by layer, not just by theme.** `--app-surface-raised` and `--app-surface-strong` are byte-identical in light theme (`#ffffff` = `#ffffff`), so a state layered directly on a Modal/popover/menu's own background (`--app-surface-strong`) rendered with **zero** visible feedback there; dark theme is not safe either (`#232019` on `#262320` measures ~1.04:1, non-identical but not _measurably_ different). But the fix is NOT "always use `--app-surface-soft`" — that was tried first (cycle 1), shipped as a blanket sweep, and **measurably regressed a whole family of call sites it never verified** (evaluation-2.md CR6): table/list rows and page-level buttons mostly composite against `--app-bg` (the outermost canvas), not `--app-surface-strong`, and on `--app-bg` it is `--app-surface-raised` that clears the threshold in both themes (1.161 dark / 1.119 light) — `--app-surface-soft` measures _worse_ there (1.034 dark / 1.054 light). A rendered, CI-gated contrast guard (`e2e/state-surface-contrast-guard.spec.ts`) — the arbiter for every remediation decision here, not inspection or a general rule — found three distinct backdrop families, each needing a different fix:

| real backdrop                                                                         | correct fix                                                                                                  | measured (dark / light) |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `--app-surface-strong` (modal/popover/menu interiors)                                 | `--app-surface-soft` alone, no theme split                                                                   | 1.167 / 1.179           |
| `--app-surface` (an intermediate layer — command bar, a step card, a settings button) | `--app-surface-strong` in dark, `--app-surface-soft` in light (a `:root[data-theme="dark"]`-scoped override) | 1.133 / 1.150           |
| `--app-bg` (the outermost page canvas — most table/list rows)                         | `--app-surface-raised`, unchanged, no fix needed                                                             | 1.161 / 1.119           |

See `openspec/changes/state-surface-contrast-guard/design.md` D1/D3 for the full derivation. **This three-way split is itself strong evidence for a dedicated `--app-state-hover` / `--app-state-selected` token pair** — no single existing rung serves all three backdrops in both themes, so every future call site has to re-derive which of three fixes it needs (as this ticket's own remediation got wrong on its first pass) rather than reaching for one name that is correct by construction. **Still recommended, still not adopted this run**: adding a token to `theme.css` is a visual-identity decision requiring owner sign-off (escalated during HEL-866, no dashboard attached; the conservative per-backdrop-measured-fix path was taken instead of blocking on it).

**`--app-accent-mid` on a border is CORRECT, not drift** (HEL-442 audit correction): the "never accent-tinted" rule
above governs the DEFAULT hairline (`--app-border-subtle`/`--app-border-strong`), not every border in the app.
`--app-accent-mid` is the token this table already names FOR "selection borders" one row up — the ~46 sites where it
appears are explicit state pseudo-classes (`:focus-visible`/`:hover`/`:checked`/`--active`/`--selected`), affordance
idioms (dashed drop-target outlines), or semantic tinting, not a default hairline drawn in accent. Do not "fix" them.

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
inside dense rows may be 24px. Native `input[type="color"]` swatches
(accent/appearance pickers) are exempt, sized for visual color-swatch clarity
rather than by a control token.

**The 44px touch floor.** Every interactive control reachable by touch must
clear a 44x44px target. Two mechanisms, and which one you use is not a
preference:

- **Grow the box** (`min-height: 44px`) for full-width list/menu rows
  (`MobileNavSheet` items, `ActionsMenu` items, `UserMenu` items, picker
  rows), text inputs and select triggers, and `BottomNav` tabs. A 44px row is
  the phone idiom and height there is legibility, not just target area.
- **A sized `::after` hit expander** for every compact PAINTED control — any
  button. `position: relative` on the control, then `width: 44px;
height: 44px; top/left: 50%; transform: translate(-50%, -50%)` (or a
  full-width strip: `left: 0; right: 0; height: 44px; top: 50%;
transform: translateY(-50%)` for a labelled button). The canonical
  rationale, and the list of where each mechanism applies, lives in
  `shared/ui/tapTarget.css`; `shared/ui/tapTargetTestUtils.ts`'s
  `expectTapExpander()` is the guard.

Inflating painted buttons was the ORIGINAL approach and it was wrong: on a
phone it made every secondary action — header CTAs, icon-only chrome, inline
form actions — the largest, heaviest element on screen, and wrapped labels
like "Add connector" onto two lines. Do not reintroduce `min-height: 44px` on
a button. Size the expander explicitly (never a negative `inset`, which
resolves against the PADDING box and lands 2px short per axis on a bordered
control), and never omit `position: relative` — without it the expander
resolves against the nearest positioned ancestor and the enlarged hit region
silently lands elsewhere on the page, invisible to screenshots and unit tests.

**Gate on the input device, not the viewport:**
`@media (max-width: 768px), (pointer: coarse)`. A width-only gate was wrong —
`max-width: 768px` covers only iPads in the narrowest portrait orientation.
iPad 10.2/Air/Pro (810–1024px), every iPad in landscape (1080–1366px) and
every iPhone 12+ held sideways (844–932px) all fell outside it and got
desktop-sized 24–28px targets. `(pointer: coarse)` is true on exactly the
devices that need this and false for a mouse, and the comma is a logical OR,
so the existing narrow-viewport behaviour is preserved. This gate belongs on
tap-target rules ONLY — phone-shaped LAYOUT (stacking a row, hiding desktop
chrome, going full-bleed) stays width-gated, since an iPad Pro at 1366px has a
desktop's worth of room and should get the desktop layout with finger-sized
targets. **[mechanical]**

**Expander tiling.** The expander extends `(44 - controlSize) / 2` per side (8px for a 28px control),
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
number over 44 — the threshold takes the epsilon, not the gap. This is why
`.app-command-bar__right`'s `--space-4` gap carries the SAME touch gate as the
expanders it separates: gate the two differently and an iPad gets the
expanders without the spacing they were measured against.
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
  **`50%` is an ALLOWED value for a circle, not drift to be exempted or
  "normalized" onto `--app-radius-pill`** (HEL-442 D1): avatars, `Spinner`,
  the `Toggle` knob, `AccentPicker` swatches and `StatusChip` all use `50%`
  because it is the semantically correct expression of a circle and, unlike
  a fixed-px token, survives a size change without distorting the shape. On
  a square element `50%` and `9999px` render identically, but treating `50%`
  as an exception would invite a future ticket to "resolve" it and visibly
  break every one of those circles.
  A handful of sub-scale radii below the 6px floor (`1px`/`3px`/`4px` on
  `DividerPanel`, `MarkdownPanel`, `PipelineDetailPage`) are deliberately
  LEFT literal rather than snapped to `--app-radius-sm` (HEL-442 D2):
  snapping is a visible 2–5px increase on decorative detail (a hairline
  rule, a drag-drop indicator line, a code-block/badge corner), and
  measurement showed the token looked like a different, worse shape at that
  size — the same "locally tidier, globally worse" trap HEL-441 hit with
  motion durations. Each site carries an inline comment recording why.
- Shadow: `--app-shadow-card` (resting cards), `--app-shadow-soft`
  (overlays/hover-lift). Borders do the separating; shadows stay soft.
  **Two families of `box-shadow` declarations exist that neither elevation
  token applies to** (HEL-442 D0): zero-blur "spread ring" focus/selection
  indicators (`0 0 0 3px var(--app-accent-dim)` and similar — a different
  mechanism from the `--app-focus-ring` outline token, converging them is
  HEL-1022's remit) and scroll-fade edge insets (`inset Npx 0 Npx -Npx
color-mix(...)`, in four distinct values across `DataGrid`/list tables/
  `ConnectorsPage`). Neither carries a y-offset with a blur — the shape an
  elevation shadow takes — so neither is drift; `frontend/src/theme/
elevationTokenGuard.css.test.ts` pins each declaration by exact file,
  text and count rather than exempting the properties wholesale.
- Motion: `--app-transition` (0.16s, hover/color), `--transition-slow`
  (0.28s, entrances), `--app-skeleton-shimmer` (1.6s, the `Skeleton`
  primitive's shimmer loop), `--app-spin-duration` (0.7s, the loop role
  shared by the `Spinner` primitive and any local copy of it — HEL-441).
  The first two are transition _shorthands_ tuned for a single hover or
  one-shot entrance; a continuous loop needs its own duration token rather
  than reusing either (0.28s repeated indefinitely strobes). **[judgment]
  governing rule (HEL-441 D1):** a single-use loop may keep its own literal
  duration; a loop role used by two or more surfaces needs a token —
  do not build a full duration scale ahead of that need. Modals/popovers/
  auth card animate in once (fade + 4–10px rise); a backdrop fade paired
  with its panel's rise (`MobileNavSheet`, `RefinementChatDrawer`) counts
  as ONE entrance expressed in two elements, not two entrances — do not
  "fix" that by removing the backdrop fade **[judgment, HEL-441 D7]**.
  Exit motion is deliberately component-scoped rather than tokenized:
  `--toast-exit-duration` lives in `toast.css`, paired with `Toast.tsx`'s
  `TOAST_EXIT_MS`, because it has exactly one consumer — do not promote it
  to a theme token **[judgment, HEL-441 D1]**. `prefers-reduced-motion` is
  respected globally — but see `Skeleton`'s own explicit override below;
  the global rule alone does not fully disable a looping animation.
  **[judgment]** No scattered micro-animations; one entrance per surface.

## 4. Breakpoints

Canonical set, shared with React Grid Layout (`panelGridConfig.ts`):
**1440 / 1100 / 768 / 430**. CSS media queries use these values only. Container
queries on `panel-card` handle panel-internal density and are the right tool
for that job. **[mechanical]**

**430 (phone, ratified HEL-300):** the mobile PWA shell needs a sub-768 phone
breakpoint; 430px covers every iPhone portrait width (the largest is
430–440pt) while staying clear of small tablets. `PanelDetailModal.css`'s
pre-existing, unratified `480px` query was folded into this value.

**These are LAYOUT breakpoints, and a viewport width is not a proxy for a
touch device.** Tap-target rules take the touch gate instead — see §3's
"Gate on the input device, not the viewport". Reaching for `max-width: 768px`
to mean "is this a finger?" silently excludes every iPad above the narrowest
portrait width and every phone in landscape.

## 5. Buttons

Until a shared `Button` component exists, every button follows one of these
recipes (match metrics exactly; see `Modal.css` / `App.css` for reference):

- **Primary** — solid `--app-accent`, text `--app-accent-ink`, hover
  `--app-accent-strong`, no border. One primary per view/section.
- **Secondary** — transparent bg, `--app-border-subtle` hairline, muted text;
  hover: `--app-border-strong` + `--app-surface-soft` + full text (HEL-866 —
  see §3's ramp note; `--app-surface-raised` collides with modal/top-surface
  backgrounds).
- **Ghost** — borderless, muted text; hover `--app-surface-soft` (HEL-866).
- **Danger** — hairline `color-mix(error 60%)`, error text; hover
  `--app-error-surface`. Solid error only for final confirm actions.

All at `--control-sm/md` height, `--app-radius-sm`, `--weight-medium`,
`--text-xs/sm`. **[judgment]** A new button style is a defect, not a variant.

**Chrome surfaces are borderless.** Inside `.app-command-bar` and
`.app-sidebar`, every trigger drops its hairline at every width (`cmd-btn`,
`ui-icon-btn`, `actions-menu__trigger`, `user-menu__trigger`) — these surfaces
FRAME the app rather than being content, and a row of controls each in its own
box reads heavier than what it frames. Hover backgrounds are kept, so feedback
survives. This is scoped to those two surfaces, deliberately NOT to the
primitives: the same recipes keep their border everywhere else, and especially
on panel cards, where it separates a control from busy content rather than
from flat chrome. Note each recipe re-asserts `border-color` on hover, so a
borderless override must list `:hover` alongside the base selector or the
outline returns on pointer-over. **[mechanical]**

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

Utilities in `theme.css`: **`.page-title`** (a section page's `<h1>` —
`--font-display` at `--text-2xl`, `--weight-semibold`; do not re-derive it
per page, which is how `SettingsPage` and `ConnectorsPage` drifted apart) ·
**`.eyebrow`** · **`.sr-only`**. `shared/ui/tapTarget.css` carries the
`.tap-expand-44` utility and the canonical tap-target rationale (§3).

### Section overview pages

The six sidebar sections share one shape. Dashboards is the deliberate
exception — that route IS the canvas, and a dashboard's useful representation
is visual, not a table row.

- **`/<section>` is an overview**: `.page-title` `<h1>` in a `__header`,
  then a list table, then the create action in a `__toolbar` BELOW the table.
  Geometry is identical across every one of them — `padding: var(--space-5)
var(--space-6)`, `gap: var(--space-7)` on the page container — so switching
  sections doesn't shift the title. Verified equal on all five.
- **The create action goes below the list, never in the header.** As a
  header-height block it pushes the list — the reason the page exists — down
  the viewport.
- **`/<section>/:id` is the detail**, and the ROUTE is the selection. Do not
  reintroduce a Redux `selectedXId` with an `items[0]` fallback: that made a
  bare section URL render an arbitrary item, and in the registry's case
  force-navigated the address bar to it. An unknown id must be a real
  not-found, not a silent fallback to whatever sorted first.
- The sidebar, the phone picker sheet (`usePickerSelection`) and the
  breadcrumb all read the same route id, so a deep link, a refresh and a click
  resolve identically.
- A section with no create action (Data Types — types are produced BY
  pipelines) gets no toolbar and no `onAdd`; its table is a read-only audit
  surface. **[judgment]**

**Sanctioned exceptions**, both tracked so they are not mistaken for drift:
**Dashboards** (the route is the canvas; a gallery, not a table, would be the
right index if one is ever wanted) and **Chat** (`ActiveConversationPanel`
still resolves selection from Redux with an `items[0]` fallback — a new
conversation has no id until its first message persists, so "the route is the
selection" needs an answer for that state first; HEL-855).

### List/overview default ordering and column sorting (HEL-1022)

Every `/<section>` overview defaults to **most-recent-first**, keyed on the
field the page's own recency actually means — not whichever timestamp
happened to be easiest to project. Pipelines/Sources/Connectors default to
`updatedAt desc` ("last edited"); Dashboards (gallery) and Audit default to
their own existing `lastUpdated`/`createdAt desc`. `lastRunAt` is "last run",
not "last edited", and is absent for a never-run pipeline — never use it as a
recency default. The backend repository is the source of truth for this
default (`.sortBy(...desc)`, or an in-Scala sort on the raw `Instant` when the
query already collapses to one row per resource) so the **first paint** is
correct before any client-side sort has run.

Every list **table** (not the Dashboards gallery, which has no columns) adds
clickable per-column sorting on top of that default, built from three shared
primitives in `shared/ui/`:

- **`useSortedRows(rows, columns, defaultSort)`** — a client-side sort over
  the already-fetched array. `columns` is a small typed table of
  `{ key, getValue }`; `defaultSort` seeds the initial `{ key, direction }`
  and should match the page's backend-driven default order. Sorting itself
  never re-fetches or adds a query param — it re-orders what's already on
  screen. `columns` (and `defaultSort`) should be a stable reference (a
  module-level `const`, or `useMemo` when it depends on props) — the hook
  memoizes on `[rows, columns, sortState]` by identity, and an inline array
  literal re-sorts on every render for nothing.
- **`<SortableTh direction={...} onSort={...}>`** — a `<th>` whose entire
  contents are a button (the whole header is clickable, not just the label),
  carrying `aria-sort` (`"ascending"` / `"descending"` / `"none"`, per the
  WAI-ARIA sortable-table pattern) and a direction glyph (▲/▼/⇅) so the state
  is never color-only.
- **`<SortableTable tableClassName columns sortState onSort>`** — the shared
  shell all four tables actually render through: the scroll-shadow wrapper
  (`useScrollEdges`), the `<table>`, and the `<thead>` built from `columns`
  (each driving a `SortableTh`). Deliberately thin — it owns the shell ONLY;
  row rendering, click-to-navigate behavior, Actions columns, empty states,
  and one-off extra rows (Connectors' conflict row) stay with the caller,
  passed as `children` (the `<tbody>`). `scrollClassNames` (a caller's own
  `{container, left, right}` class names — this component never invents or
  renames a class) opts a table INTO the scroll wrapper; omit it for a table
  that never overflows (`AuditEventTable`) so no wrapper `<div>` is rendered
  at all. `scrollAriaLabel`, when given, makes the wrapper a keyboard-
  focusable `role="region"` — but only while the table is actually
  overflowing (`useScrollEdges`' `overflowing`), never as an unconditional
  tab stop on a box with nothing to scroll to.

**A sticky Actions column is the one sanctioned divergence between the four
tables**, used ONLY by Connectors. Pipelines (whole-row navigation + an
optional single Share button) and Sources (no Actions column at all) have no
fixed, always-reachable-regardless-of-scroll-position column to guarantee —
Connectors' 409-guarded Delete (with its own confirm step) is the shape that
actually needs one, since a control the mobile touch-target e2e guard (or a
real user) can never scroll far enough right to reach is a genuine
reachability defect, not a cosmetic one. The recipe, should another table
ever need it:

- `position: sticky; right: 0` on both the `<th>`/`<td>` in that column,
  `z-index: 1` so it paints over cells scrolling underneath.
- Background and edge-shadow are gated on the SAME overflow-state classes
  `scrollClassNames` already toggles (`--left`/`--right`) — a non-overflowing
  container (the column has nothing to stick past) must render the column
  exactly as if it weren't sticky at all. Use `--app-bg`, not `--app-surface`
  — a table's real backdrop is the page background (everything from the
  `<table>` up to `<body>` is transparent), and painting the lighter surface
  token here reads as a detached, mismatched-tone panel.
  `--app-surface-raised` still matches the row's own hover treatment — a
  table row's real backdrop is `--app-bg` (family 3, §3's HEL-866 note),
  where `--app-surface-raised` clears 1.10 in both themes and `--app-
surface-soft` measurably does not; this corrects a stale cycle-2
  "always soft" claim this line previously repeated.
- The scrollable container's own edge shadow (the `--right` inset shadow
  signaling "more content this way") paints at the CONTAINER's physical
  edge, which sticky content now visually occupies — an inset shadow paints
  below descendants, so it renders completely hidden under the sticky
  column's opaque fill. Move that cue onto the sticky column's OWN edge
  instead (its left edge, toward the scrollable content), gated on the same
  `--right` class — painted on the sticky layer itself, it can never be
  occluded by its own background.
- If the sticky content is itself too wide relative to the container at
  small viewports (a visible button plus a menu trigger can eat the
  majority of a 382px-wide container), collapse it to just the essential
  trigger below a real breakpoint (`useIsNarrowerThan`, genuinely reactive —
  not a CSS-hidden duplicate reachable twice by different input methods) —
  see Connectors folding "Test connection" into its `ActionsMenu` below
  1100px as the worked example.

**Nulls sort last, in both directions.** A missing value (a never-run
pipeline's `lastRunAt`, an unused source's dependent count) must never look
like the most-recent or the smallest — `useSortedRows` special-cases `null`/
`undefined` OUTSIDE the ascending/descending sign flip, so it lands last
regardless of which direction is active.

**Date-typed columns compare as dates, not as strings.** Every date on the
wire is `java.time.Instant.toString()`, which emits 0/3/6/9 fractional
digits depending on the value (trailing zero groups drop) — a plain string
or numeric-digit-run compare gets these backwards (`"...900Z"` sorts before
`"...123456Z"` under `localeCompare(..., {numeric:true})`, even though 900ms
is later). `useSortedRows` detects the exact `Instant.toString()` shape and
compares as epoch milliseconds instead; a `getValue` that returns some OTHER
date string shape should parse it the same way rather than falling through
to string comparison.

Clicking a column's header toggles `asc` → `desc` → `asc`; clicking a
DIFFERENT column resets to `asc` on that column. Retrofit an existing table
onto this pattern rather than writing a bespoke comparator — four
independent hand-rolled sorts is exactly the drift this trio exists to
prevent.

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

### Long lists: grouping, capping, and search (HEL-1022)

A flat list can genuinely be large — a REST source's inferred schema can
carry ~200 dotted-path fields (`player.metadata.injury_override_regular_
2024_10`, repeated ~140 times with only the trailing segment varying).
Rendering all of it unbounded is the failure mode this pattern exists to
close. Built once, in `shared/ui/`, as three layers so a table-shaped
consumer and a chip-shaped consumer can both use the same logic without
either being forced into the other's markup:

- **`groupFieldsByNamespace(fields, getName)`** (pure function) — groups by
  the FULL dotted-path prefix (everything before the field's last dot), one
  level deep, not a recursive tree. `player.metadata.foo` and
  `player.metadata.bar` collapse into one `player.metadata` group; a
  dotless field lands in the `"(root)"` sentinel group. One level is
  deliberate: the real motivating data is two-or-three-segments deep with
  many fields sharing an identical prefix, so full-prefix grouping already
  collapses ~140 fields into one row — a general nested tree would add
  disclosure-within-disclosure UI for a shape this data doesn't need.
- **`useSchemaFieldSearch(fields, getName, options?)`** (hook) — the actual
  state: search query, which namespace groups are expanded, which groups
  (or the flat list) are showing all vs. capped. Renders nothing; returns
  data + callbacks only, so it can back a table row list or a chip row
  equally.
- **`<SchemaFieldViewer title fields getName renderField fieldsContainer>`**
  (component) — the default chrome built on the hook: a "Title N fields"
  header, a filter input, collapsible namespace disclosures with per-group
  counts, and a "Show all N" affordance per group (and for the flat/
  filtered case). `renderField(field)` renders ONE field's presentation
  unit (a `<tr>`, a chip `<span>`); `fieldsContainer(children)` wraps one
  visible list's worth of them into the caller's real structural container
  (a `<table>…<tbody>{children}</tbody></table>` — the caller supplies its
  own `<thead>` — or a flex-wrap chip row). This is what keeps the
  component presentation-agnostic without a `variant` prop enumerating
  every future caller's shape.

**Small counts get NO chrome at all.** At or below
`SCHEMA_FIELD_VIEWER_SMALL_THRESHOLD` (12) fields, `SchemaFieldViewer`
skips the header, the filter box, and grouping entirely — it renders
exactly what `fieldsContainer`/`renderField` would produce with no
`SchemaFieldViewer` in the picture at all. Most sources have a handful of
fields; a fix for the 200-field case must not tax the common case. This is
the same instinct as `SortableTh`'s glyph and `PageStatus`'s skeleton
gate — the affordance only appears once there's actually enough content to
need it.

**The cap is per-group, not global.** `SCHEMA_FIELD_VIEWER_GROUP_CAP` (20)
limits how many fields render inside ONE expanded group (or the flat/
filtered list) before "Show all N" appears — expanding a 134-field
`player.metadata` group must not just relocate the flood from the page to
the group body.

**Filtering flattens across every namespace.** While the filter box has a
query, matches are shown as one flat capped list spanning every group, not
still boxed per-namespace — a user searching is looking for a NAME, not
browsing a structure, and re-imposing group headers on a search-result set
would just be more chrome between them and the answer.

**Grouping only renders when it would actually help.** Zero or one real
namespace (every field shares one prefix, or none has a dot at all) skips
the collapsible-groups UI and falls back to the same flat capped list
filtering uses — a single group with a disclosure triangle around it is
chrome with no payoff.

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
- **Focus ring: always `:focus-visible`, never bare `:focus`, for a ring.**
  (HEL-1022.) `:focus-visible` is what gives a keyboard user a ring while
  NOT painting one for a mouse-triggered programmatic `.focus()` — e.g. a
  dialog auto-focusing its first field the instant it opens, which is
  correct a11y behavior (overlays MUST auto-focus on open) but must not
  flash an orange ring at someone who opened it by mouse. `--app-focus-ring`
  (`theme.css`) centralizes the outline VALUE — `2px solid
var(--app-focus-ring-color)` — so every component references one token
  instead of hand-copying the literal; the global rule is `outline:
var(--app-focus-ring); outline-offset: 2px`. `outline-offset` still varies
  legitimately per component and is NOT part of the token — use `-2px` only
  where the ring would clip (flush list items); see §3's `-3px` carve-out
  for `BottomNav`. **[mechanical]**
  - **`--app-focus-ring-color` is a dedicated token, DERIVED — not
    `--app-accent` itself, and not a hand-picked palette value** (HEL-1046).
    A focus indicator carries a 3:1 non-text WCAG contrast obligation that a
    decorative accent does not; binding the two (the pre-HEL-1046 state) is
    what let the ring fall to 2.58–2.99 against `--app-surface-soft` in the
    shipped light theme while `--app-accent` was never wrong for its own
    purpose. `appearance.ts`'s `deriveFocusRingColor(hex)` computes the
    token as **the minimum darkening (toward black, in TypeScript — never
    CSS `color-mix`) of the chosen accent that clears 3:1 against every
    surface declared in BOTH `:root[data-theme=...]` blocks**, taking the
    minimum over all of them rather than a chosen "worst" pair. This is why
    it is theme-independent by construction: one value already serves both
    themes, so no `ThemeProvider` re-application on theme switch is needed.
    Measured need per preset (Red/Purple/Blue 0% — already pass, rendered
    unchanged; Pink 1%; Orange 12%; Cyan 18%; Green 21%; Yellow 28%).
    **This justification — derived rather than chosen — is the entire
    reason the token is safe to leave alone.** Hand-tuning it toward brand
    at a future edit silently re-couples the two obligations this token
    exists to separate; `focusRingTokenGuard.css.test.ts` asserts the
    property (>= 3:1, re-deriving the binding surfaces from `theme.css`
    itself rather than a hardcoded pair) so drift fails loudly instead of
    shipping unnoticed, as it did the first time. `--app-accent` itself is
    never modified by this token — brand rendering elsewhere is untouched.
    The static `:root` value (`#db6513`, the derivation applied to
    `DefaultAccentColorByTheme.dark`) is what actually paints on first load
    and on an unparseable-accent fallback, before `ThemeProvider`'s effect
    runs; it must stay equal to that derivation (also guarded) rather than
    drift into an independently hand-typed hex.
    **"Every component references one token instead of hand-copying the
    literal" (above) was NOT true when HEL-1046 was first written** — **17**
    focus-indicator rules across **8** component stylesheets
    (`DashboardList.css`, `DashboardAppearanceEditor.css`,
    `PanelDetailModal.css`/`.sections.css`/`.binding.css`/`.appearance.css`,
    `OutputPicker.css`, `TableDisplayFields.css`) hand-copied
    `outline: 2px solid var(--app-accent);` directly, painting the raw,
    undarkened accent and defeating the 3:1 floor exactly like the original
    defect. Broken down: 15 `:focus-visible` rules, 1 bare `:focus` rule
    (`PanelDetailModal.binding.css`'s `.panel-detail-modal__type-search`),
    and 1 state class (`OutputPicker.css`'s `.output-picker__card--focused`,
    driven by `aria-selected` rather than a pseudo-class). Verified by
    `git grep -n "outline: 2px solid var(--app-accent);" <commit> -- '*.css'`
    at the pre-fix commit, not transcribed from a prior review's count —
    two earlier tallies in this same review (15, then 16) both undercounted.
    Cycle-2 review caught this because every other gate could not:
    `check:tokens` only proves a `var(--*)` reference resolves, not which
    token a component chose, and the contrast guard above reads `theme.css`
    only. Fixed by repointing all 17 at `var(--app-focus-ring)`, keeping
    each site's own `outline-offset` (still not part of the token). The
    sentence is true now, checked by a second [mechanical] guard in
    `focusRingTokenGuard.css.test.ts` that walks every `.css` file under
    `frontend/src` and fails on any `outline` colour that is not
    `var(--app-focus-ring)`, `none`, or an explicitly pinned exception.
    **The one pinned exception is `App.css:43`'s skip link**
    (`outline: 2px solid var(--app-text);`, HEL-772) — a deliberate,
    high-contrast, modality-independent ring on a `position: fixed`,
    viewport-top-anchored surface, not an accidental accent hand-copy, so it
    is excepted by name rather than silently allowed by a loose pattern.
    **A second, DIFFERENT kind of exception exists in the same guard's
    whitelist: `PanelDetailModal.binding.css`'s
    `.panel-detail-modal__type-search:focus` is the ONE bare-`:focus` (not
    `:focus-visible`) consumer of `--app-focus-ring`** — the whitelist
    requires it to stay a token consumer, same as every `:focus-visible`
    site, so `theme.css`'s own header comment on the token no longer
    claims "never bare `:focus`" (that claim, written cycle-1, went stale
    the moment this site was repointed cycle-2 — corrected cycle-4).
    **Investigated rather than assumed:** `grep -rn` for
    `type-search`/`type-list` across `frontend/src` returns zero hits
    outside these two CSS declarations — no component in the current tree
    renders this class. `git log` traces it to `PanelDetailModal.binding.css`
    surviving HEL-909's removal of `BindingEditor.tsx` (#509, "retire
    wizard/BindingEditor/Types/Metrics pages"), which almost certainly
    rendered it. So this is most plausibly orphaned CSS, not a live,
    deliberately-chosen instance of the carve-out below — recorded here as
    what that carve-out WOULD require if the rule ever renders again (a
    type-ahead search input announcing "you're typing into me," which the
    class name and styling support), not as a claim that a real user
    currently sees this behavior. Removing genuinely dead CSS is outside
    HEL-1046's scope (a focus-ring colour fix) and no existing ticket owns
    a dead-CSS sweep of this file, so it is left in place, correctly
    described, rather than silently deleted or silently misrepresented as
    live.
  - **The one legitimate exception is a persistent, modality-independent
    indicator** — an element that should look "active" regardless of HOW it
    got focus, because the state itself (not the input device) is what's
    being communicated: a text input showing it's the one accepting
    keystrokes (an accent border, not an outline ring), or a selected item
    in a listbox. These legitimately keep bare `:focus`. The test: if the
    visual state is announcing "this is the thing you're typing into/have
    selected" rather than "a keyboard just moved here," bare `:focus` is
    correct; if it's announcing keyboard navigation, it must be
    `:focus-visible`. **`.add-source-modal__cell-input:focus` /
    `.add-source-modal__cell-select:focus` remain the example of the shape**
    (bare `:focus` on a text input, correctly), but are ORPHANED CSS with
    zero markup references (HEL-1050 D9) — kept bare, kept unfixed for
    contrast, and pinned in `focusRingTokenGuard.css.test.ts` pending
    HEL-1052's resolution, rather than presented as a live instance.
    `.auth-field input` was converted from bare `:focus` to `:focus-visible`
    by HEL-1050 D6 — it was hand-copying the raw accent when this doc was
    first written, so fixing its colour required deciding this question
    too, and the `:focus-visible` reading won because nothing about a login
    field's border needs to persist across a mouse click the way a
    listbox's selected-row border does.
  - Never remove focus indication entirely to chase this — a keyboard user
    must always be able to see where focus is. If a component can't make
    the mouse/keyboard distinction without losing keyboard visibility,
    leave it on bare `:focus` (visible for everyone) rather than drop the
    ring.
  - **The 3:1 obligation binds on whichever mechanism actually conveys
    focus — `outline`, `border`/`border-*-color`, or `box-shadow` — not
    only on `outline`** (HEL-1050). `outline: none` is not, by itself, a
    focus-accessibility defect; it is only a defect when nothing else
    conforming replaces it. HEL-1046's whitelist guard reasoned about
    `outline` alone and therefore had nothing to say about **ten
    `outline: none` declarations across nine distinct sites**
    (`shared/ui/inputs.css`, three `DashboardList.css` inputs, its
    permanent-border rename input, `auth.css`, `PanelGrid.css`'s title
    input, `PipelineDetailPage.css`'s footer input — which carries TWO
    separate `outline: none` declarations, one on its base rule and one on
    its former bare-`:focus`/`:focus-visible` pair, the only site
    contributing more than one — and `AccentPicker.css`'s swatch ring).
    **Not all ten painted the raw, undarkened `--app-accent`** — most did
    (measuring 2.38–2.80 in light, below the 3:1 floor), but `PanelGrid.css`
    painted `--app-accent-strong` instead (disqualified separately, below,
    for failing Yellow specifically) and `DashboardList.css`'s rename input
    conveyed focus via its sub-threshold halo alone, with no accent
    recolouring needed at focus at all (its permanent, always-visible
    border was already accent-coloured, unrelated to the focus state). Each
    site now routes through the same `--app-focus-ring-color` token
    `outline` does, recolouring (or, for the halo-only site, adding a
    conforming border) without changing the mechanism — a border stays a
    border, a box-shadow ring stays a box-shadow ring — D1's ruling is
    "recolour, do not reinstate an outline," precisely because an outline
    can reintroduce clipping a border/shadow mechanism was chosen to avoid.
    `focusRingTokenGuard.css.test.ts` extends the same file with a second,
    independent guard for this: it groups declarations by selector BASE
    (trailing pseudo-classes stripped) so a base rule's `outline: none` and
    its sibling `:focus-visible` rule's indicator are checked together, and
    requires (1) some `:focus-visible` rule in that group to reference
    `var(--app-focus-ring-color)`/`var(--app-focus-ring)`, and (2) no
    indicator declaration in a genuine focus rule to reference the bare
    `var(--app-accent)`.
  - **A translucent halo (`--app-accent-dim`, an 8–10% alpha tint) is
    decoration and is never credited toward the 3:1 obligation** — it
    measures ~1.08:1 (light) / ~1.14:1 (dark) against its own surface, so
    even a highly visible halo contributes essentially nothing to contrast.
    Kept for visual continuity where it already exists (the border
    alongside it is what must conform), but a site whose ONLY focus
    affordance is a halo (`DashboardList.css`'s always-bordered rename
    input, where focus previously added nothing but the halo) must gain a
    conforming border, not a thicker halo.
  - **`--app-accent-strong` (`color-mix(in srgb, var(--app-accent) 76-78%,
black|white)`) is not a conforming focus colour** — Yellow measures
    2.78:1 in light, below the floor, even though seven of the eight
    presets pass. `PanelGrid.css`'s title input (`border-bottom-color`)
    repoints to `--app-focus-ring-color` instead. `focusRingTokenGuard.css.test.ts`
    asserts this per-preset by parsing the mix percentage/base colour out
    of `theme.css` itself (never a hardcoded `2.78`), so a future edit to
    the mix ratio re-checks itself rather than going stale. **This
    indicator's binding surface is the user-chosen panel background, not a
    theme surface** — no single derived colour can guarantee 3:1 there; the
    repoint is a strict improvement (fixes the Yellow failure, conforms
    against every theme surface and preset) but is knowingly NOT a closure
    for an arbitrary user-chosen panel background near the derived ring
    colour. That residual is owned by HEL-1051, not silently absorbed here.
- `--app-accent-ink` is contrast-computed per accent; never place raw white
  text on the accent. Color is never the sole carrier of meaning.
- **`--app-accent-text` — accent used as readable TEXT is a separate,
  THEME-AWARE derived token, unlike the ring token above** (HEL-1048).
  `--app-accent` (fills, borders, decoration) is never rewritten — the
  owner's ruling was `text-only-token`, mirroring HEL-1046's shape of
  giving the obligation its own token rather than bending the shared one.
  - **Why theme-aware, when `--app-focus-ring-color` is deliberately not:**
    a single colour clearing WCAG's 4.5:1 text floor against BOTH the
    binding light surface (`--app-surface-soft`) and the binding dark
    surface (`--app-surface-strong`) needs disjoint luminance ranges — the
    light-side ceiling is _below_ the dark-side floor, an empty window.
    This is a property of the stricter 4.5:1 text floor, not of the 3:1
    non-text floor `--app-focus-ring-color` clears with one theme-
    independent value; the two tokens deliberately diverge on this axis and
    the code says why (`appearance.ts`'s `deriveAccentTextColor` doc
    comment) so a future reader doesn't try to unify them.
  - Derived by `deriveAccentTextColor(hex, theme)`: minimum darken-toward-
    black (light) / lighten-toward-white (dark) that clears 4.5:1 against
    the COMPLETE scored background set for that theme — the five neutral
    surface tokens, `--app-accent-surface`/`--app-accent-dim` composited
    over each, and the two hand-rolled inline tints heavier than those two
    (`BottomNav.css`'s 22% active-tab lozenge, `AddSourceModal.css`'s 20%
    selected-type-pill fill) that no scan over token names can see, since
    what varies there is the background, not the declaration. Scoring only
    the five neutral surfaces would ship a colour that still fails against
    the app's own accent-tinted surfaces — an omitted background class, not
    a moving target, since `--app-accent` itself never changes under
    `text-only-token`.
  - **Producibility, not just the ratio:** the derivation searches integer
    percents only and returns the first that clears the floor, so every
    value it can return is inherently one that same search can re-emit —
    there is no separate "does this ratio-passing colour actually come out
    of the darken/lighten formula" check needed, because the search never
    considers a value outside what it can produce.
  - Re-applies on **theme** change as well as accent change
    (`ThemeProvider.tsx`'s effect is keyed on `[accentColor, theme]`) — the
    one place this ticket had to touch `ThemeProvider` where HEL-1046
    avoided it, because the token itself is theme-aware.
  - A static `:root` fallback (same first-paint-race reason as
    `--app-focus-ring-color`'s) ships as a single value for the default
    dark/Orange combination, immediately superseded once the effect runs.
  - **Accepted, visible consequence:** `text-only-token` + the owner's
    `accept-hue-shift` ruling (full conformance on all 8 presets, not a
    partial palette) means a preset's TEXT can render visibly darker/
    lighter than its own FILL on the same surface — sharpest for Yellow in
    light theme, where the login card's "Sign in" button (bright) sits next
    to the "Create one" link (dark olive). This was rendered and reviewed
    (`.concertino/runs/HEL-1048/evidence/`) rather than shipped unseen; it
    reads as a coherent same-hue two-tone use, not as broken.
  - **`::selection`** sets BOTH `background` (an opaque per-theme hex,
    resolved in TypeScript — not a translucent CSS `color-mix` — from the
    accent blended over `--app-bg`) and `color` (`--app-text`, deliberately
    _not_ the accent-text token: selection is not accent-COLOURED text).
    Setting only one property was tried twice and was defective both times:
    colour alone left selected text on the old translucent tint (broke the
    accent-ink pairing); the page's own background/text pair is what `body`
    already declares, so selected text would render pixel-identical to
    unselected. Because `color` is always set here, accent text never
    actually paints on the selection background, so that hex is
    deliberately NOT scored in the set above — it is checked as a fixed
    `--app-text`-vs-selection-background pair instead.
  - **Explicit scope boundary:** a panel with a user-chosen background
    (`--panel-surface-override`) cannot be guaranteed by any derived colour
    — same structural impossibility as the two-theme case, relocated to
    "any colour the user picks," at the stricter text floor. Owned by
    **HEL-1057**, not this token and not HEL-1051 (which is focus
    indicators at 3:1, a different obligation on the same component).
- Keyboard operable; dialogs handle Enter/Escape.

## Light/dark token-parity rule (HEL-444)

Every `--app-*` custom property declared inside `:root[data-theme="dark"]` in
`frontend/src/theme/theme.css` must also be declared inside
`:root[data-theme="light"]`, and vice versa. A token present in only one theme
block resolves to the empty string wherever the _other_ theme is active — the
two selectors are siblings, neither inherits from the other, so there is no
fallback chain that would otherwise mask the gap. Measured on `f20ea8f6`: each
block declares 29 `--app-*` tokens (30 custom properties total per block,
counting the deliberately theme-invariant `--canvas-dot`), symmetric in both
directions, zero live violations. Guarded by
`frontend/src/theme/themeParityGuard.css.test.ts` — a Jest guard beside its
seven `theme.css`-parsing siblings, not a `scripts/*.mjs` (Jest already runs
in pre-commit and CI, so no new wiring or gate-chain surface is needed).
Runtime-set tokens written inline by `applyAccentTokens`
(`--app-focus-ring-color`, `--app-accent-text`, `--app-selection-bg`) are
declared in _neither_ theme block by design — their static fallback lives
once in the theme-invariant `:root` block and is pinned separately by
`accentTextSourceSyncGuard.css.test.ts`/`focusRingTokenGuard.css.test.ts` —
and the parity guard treats "declared in neither" as a non-violation without
that leniency swallowing "declared in exactly one."

## HEL-444 re-test: the site-wide focus ring and the accent-text link are FIXED

An earlier (parked, pre-`f20ea8f6`) walk of this ticket found the keyboard
focus ring at 2.38-2.80 against light-theme surfaces (below the 3:1 non-text
floor, site-wide via the single `--app-focus-ring` token) and the Dashboards
empty-state CTA rendering `color: var(--app-accent)` as normal-size text
(2.38-2.80, below 4.5:1). Both findings were **HEL-1046's and HEL-1048's own
subjects** and shipped fixed before this re-test (`736a8cbb`, `153f6714`,
`35d8e5e9`). Re-measured live on `f20ea8f6` rather than carried forward:

- **Focus ring**: `--app-focus-ring-color` is derived by
  `deriveFocusRingColor` (`theme/appearance.ts`) to clear 3:1 against every
  theme surface in `FOCUS_RING_SURFACES`, by construction (a search-until-
  clears loop with a safe black-fallback terminal case — it cannot return a
  sub-3:1 value). Verified live: a fresh page load with no stored accent, in
  light theme, produces a focused element whose computed `outlineColor` is
  `rgb(234, 88, 12)` (`#ea580c`, the light default, which already clears 3:1
  without darkening); a fresh dark load produces `rgb(219, 101, 19)`
  (`#db6513`). Confirmed for all 8 `ACCENT_PRESETS` × both themes
  analytically (16 computations, all ≥ 3:1; thinnest is Cyan/light at 3.01)
  and spot-checked live for the Cyan preset (worst analytic margin), which
  renders exactly the analytically-derived `#0595ae` in both themes.
- **Accent-as-text**: the empty-state CTA (`EmptyState.tsx`/`.css`) now sets
  `color: var(--app-accent-text)`, derived by `deriveAccentTextColor`
  (theme-aware, same search-until-clears construction, 4.5:1 floor) — not
  the raw `--app-accent`. A computed-style sweep of every visible,
  non-zero-area element on Dashboards, Sources, Pipelines, and Connectors in
  both themes found **zero** elements rendering raw `--app-accent` as
  `color`, `border-*-color`, or `outline-color`. Confirmed for all 8 presets
  × both themes analytically (16 computations, all ≥ 4.5:1; thinnest is
  Yellow/light at 5.10).
- **One remaining raw-`--app-accent` render was found and reviewed, not
  fixed**: `OrbitMark.tsx`, the Helio logo mark (`aria-hidden="true"`,
  `stroke="var(--app-accent)"`). It renders primarily as the **persistent
  app-chrome logo** — `CommandBar`'s `.app-command-bar__logo`
  (`aria-label="Helio home"`), present in the header on **every
  authenticated page**, not just the surfaces below — plus on the
  unauthenticated **auth pages**
  (`LoginPage`/`RegisterPage`/`MfaVerifyPage`/`OAuthCallbackPage`) and
  `ConnectorCompletionPage`. Corrected here on two counts: an earlier
  measurement wrongly located it in Settings/Chat chrome, and a later
  correction over-indexed on the auth pages alone, which could read as
  auth-only when `CommandBar`'s always-visible instance is actually where it
  is most exposed. Measured live on `/login`: at the **shipped per-theme
  default** it is 3.47:1 in light (`#ea580c` on `#fdfcfa`) and 6.32:1 in dark
  (`#f97316` on `#1a1816`) — both clear 3:1. At the **Yellow preset**
  (`#eab308`, this session's adversarially-chosen worst accent-on-surface
  case, also re-measured on `/login` rather than Settings/Chat) it is
  1.87:1 in light — below 3:1. This is **not treated as a defect** for any
  preset: WCAG 1.4.11 Non-text Contrast explicitly excepts logotypes, and
  this is exactly that case — a decorative brand mark, `aria-hidden="true"`,
  sitting immediately beside the `Helio` wordmark
  (`.app-command-bar__wordmark`, plain `--app-text` on the page background,
  measured elsewhere in this document at 14.96-16.74:1 across every surface
  in both themes) which is what actually carries the label and the click
  affordance (`aria-label="Helio home"` is on the parent link, not the SVG).
  The mark supplies decoration next to a fully-legible textual identity, not
  the identity itself. **This exception is scoped to `OrbitMark` alone and
  must not be read as a general licence for raw `--app-accent` on light
  surfaces** — every other consumer measured in this document (the focus
  ring, accent-as-text) has its own derived, contrast-guaranteed token
  precisely because it is NOT exempt the way a logotype is. Recorded here so
  a future reader does not re-flag `OrbitMark` without the exception in
  view, and does not misread the exception as covering anything else.

**Conclusion, scoped to the surfaces actually walked (both themes, fresh
default accent per D9.6b, plus the Yellow/Cyan adversarial presets spot-
checked): AC2 is SATISFIED on Dashboards+PanelGrid (including the
always-present `Add dashboard` button, whose `aria-label="Add dashboard"`
control at `DashboardList.tsx:210` opens an INLINE create form — not a
modal — regardless of list population; the _hero_ empty-state CTA at
`DashboardList.tsx:321` is a separate, narrower affordance only visible when
the list is empty), Sources, Pipelines, Settings, Connectors (both the
wide-viewport standalone `Test connection` button, whose own inline
pending/success/error UI renders in the table row, and the
narrow-viewport/`ActionsMenu` `Test connection` path, which instead surfaces
its result via a real toast — both variants clicked and screenshotted,
success and error, both themes), auth `LoginPage`/`RegisterPage`, the
mobile shell (390×844), the `Customize dashboard appearance` popover on
Dashboards, `MfaEnrollModal` (opened via Settings → "Enable two-factor
authentication", closed with Escape without confirming), the
`connectors add-connector` modal, and a live toast (`ApiTokensSection`'s
PAT-creation "Copy" button, `role="status"`/`aria-live="polite"`, text
"Token copied to clipboard.")** — this supersedes the parked lane's
"REPORTED-NOT-SATISFIED against HEL-1046" for those surfaces specifically:
HEL-1046 has since shipped and its subject (the site-wide ring) plus
HEL-1048's subject (accent-as-text) are both confirmed fixed there by live
re-measurement, not by re-reading the ticket status. The raw `--app-accent`
× surface matrix (4 presets fail 3:1 in light, 4 fail 4.5:1 in dark) remains
true as a property of the _undifferentiated_ accent token, but nothing on
the confirmed surfaces still renders that raw token where a threshold
applies except the WCAG-exempt `OrbitMark` logo above.

**Three required surfaces were reached but could not be exercised in a
populated state, and are reported rather than silently omitted:**
`MfaVerifyPage` and `OAuthCallbackPage` both redirect to `/login` without a
real in-flight MFA challenge / OAuth provider round-trip to drive them (this
dev environment has neither); `/proposals/review` renders but with no
active proposal in Redux state to review, so only its own empty/redirect
state was seen. None of the three is claimed confirmed or folded into the
SATISFIED verdict above.

The `MfaVerifyPage`/`OAuthCallbackPage` pair is further **self-evidenced**
by its screenshots, not merely asserted: both routes, within the same
theme, redirect to the identical `/login` page with no distinguishing query
param or state to render differently, so their captured screenshots are
genuinely byte-identical — that identity is itself the evidence that
neither route received the real state it needs (an in-flight MFA challenge,
a live OAuth provider round-trip) to render anything else, rather than a
screenshot-capture defect (contrast the cycle-2 md5 failure, where two
DIFFERENT, populated surfaces were wrongly captured as identical by a stale
script run — this is the opposite case: two DIFFERENT routes correctly
captured as identical because they fell back to the SAME unpopulated one).

See `.concertino/runs/HEL-444/evidence/walk-2026-09-09-cycle2/` (the
required-surface walk: Dashboards+PanelGrid, Sources, Pipelines, Settings,
auth pages, mobile shell, and the two genuinely-unreachable auth routes) and
`.concertino/runs/HEL-444/evidence/walk-2026-09-09-cycle3/` (Connectors,
the appearance popover, `MfaEnrollModal`, the add-connector modal, and the
PAT-copy toast, plus both Connectors `Test connection` code paths) for
screenshots, each directory's own `md5sums.txt`, and `walk-transcript.txt`.
Cycle 3's 20 screenshots are 20/20 `md5sum`-distinct. `derived-token-matrix.txt`
carries the 16-computation transcript.
