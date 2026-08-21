## Context

`BottomNav.css` today is a full-width opaque strip: `position: fixed; left/right/bottom: 0`, `--app-surface`
background, `--app-border-subtle` top hairline, height `calc(var(--control-lg) + var(--space-4) +
env(safe-area-inset-bottom))` (56px + inset). Six labelled tabs, `min-width/min-height: 44px`, inactive
`--app-text-muted`, active `--app-accent`. Lines 21-23 cite `DESIGN.md` §0.2 as the reason it is opaque.

That 56px expression is currently written out **three times**: `theme.css`'s `--bottom-nav-height` (added by HEL-535 in PR #408,
merged 2026-08-21; `origin/main` is now `2eaf1d26`), `BottomNav.css:27`, and `App.css:424`. HEL-535 introduced
the token but deliberately left both inlined copies un-migrated as outside its charter, so today the token
reaches only `toast.css:25`. Verified by `grep -rn "control-lg) + var(--space-4)"` on both this branch and
HEL-535's.

`DESIGN.md` already has a precedent for writing such a carve-out: the overlay-scrim carve-out in "Surfaces &
the opacity invariant" (`DESIGN.md:102-112`) states what is permitted, where, and why it does not weaken the
rule. This one follows that prose shape.

## Goals / Non-Goals

**Goals:**

- Amend `DESIGN.md` so the rule and the shipped code stop contradicting each other, replacing the invariant —
  for the bottom nav alone — with a stated, measurable contrast floor.
- Reshape the bar to the Instagram reference: inset floating capsule, semicircular ends, small-radius blur,
  a tint layer beneath the glyphs, layered shadow, inner lozenge for the active item.
- Keep legibility guaranteed over hostile user backgrounds by measurement, not by eye.
- Preserve `env(safe-area-inset-bottom)` handling, >=44px targets, and full content scroll clearance.
- Finish the token migration so the geometry has exactly one definition.

**Non-Goals:**

- Translucency anywhere else in the app. The carve-out is this one element.
- Editing `toast.css`/`toast.css.test.ts` (HEL-535's), or `.app-shell`/`.app-command-bar` (HEL-772's).
- Changing which six destinations the bar shows. (`sections.ts` itself IS edited — one icon; see D11.)
- Changing stacking order. `.bottom-nav` keeps `z-index: 5`. The known "toasts inert behind an open native
  `<dialog>`" defect is tracked elsewhere; this change must not worsen it.
- Fixing accent-on-surface contrast app-wide (see D6) — pre-existing, and a different ticket.

## Decisions

### D1. The contrast floor is 3:1, governing every glyph rendered against the translucent material

Stated in `DESIGN.md` as: **every icon in the bar that is rendered against the translucent material must reach
3:1** against the composited backdrop — tint over blurred user content — in both themes, over a photo, pure
white, pure black, and the accent colour.

3:1 is WCAG 1.4.11 (non-text contrast, the standard for icons and UI component boundaries). It is 3:1 rather
than 4.5:1 **because the bar carries no text**: with labels dropped (D4) there is no small-text element to
bind the higher floor. This is the single largest consequence of the labels decision and it is what buys the
transmissivity in D3.

The scope clause is load-bearing, not weasel wording: the active icon sits on a near-opaque lozenge (D6), so
its legibility does not depend on the translucent material and it is governed separately.

### D2. Inactive ink moves from `--app-text-muted` to `--app-text` — forced by measurement, not preference

Worst-case composite contrast (sRGB relative luminance, WCAG formula), compositing `a*tint + (1-a)*backdrop`,
worst case over {theme-matched `--app-bg`, white, black, all eight accent presets} in both themes. **Valid only
for tint = the theme's `--app-surface`** (D3); a different tint token invalidates it.

At the shipping alpha of 0.55: `--app-text` reaches **3.44:1 (dark) / 4.89:1 (light)**, clearing the 3:1 floor.
`--app-text-muted` reaches **1.31:1 / 1.68:1** — hopeless. It needs alpha ~0.79 to clear even 3:1, at which
point the bar is essentially opaque and the effect is dead. **The current inactive ink is incompatible with the
carve-out at any usable alpha**, under either the 3:1 or the 4.5:1 floor, so the labels decision does not
rescue it and never could. The reference's glyphs are solid and high-contrast, so full-contrast ink is *more*
faithful, not less. The binding case is dark theme over a pure-white backdrop.

Photo backdrops need no separate model: a composite's luminance is bounded by the white- and black-backdrop
composites, and in both themes the ink's luminance lies outside that interval — so white and black genuinely
bound every photo, and clearing both clears all of them.

### D3. Tint is `--app-surface` at alpha 0.55; blur is 12px

- **Tint colour: the theme's `--app-surface`**, applied as a distinct layer between the blur and the glyphs
  (a `::before` filling the capsule, not a semi-transparent background on the blurring element), so the
  "tint above blur" ordering the reference depends on is explicit. Naming the token matters: reaching for
  `--app-surface-strong` (`#262320`/`#ffffff`) silently invalidates D2's whole table.
- **Alpha 0.55** — 45% of the user's background reads through. Not the theoretical minimum: the 3:1 floor is
  first cleared at ~0.51 (49%), but at 0.51 both the inactive icon and the lozenge's border land on **3.03:1**,
  i.e. 0.03 of headroom against a floor. Round 3 measured rendered values diverging from this model by up to
  0.03, and antialiasing costs ~0.2 when a 1px border is sampled at a curve apex — so 0.51 is a number that
  models as passing and renders as failing. 0.55 buys ~0.44 of headroom for four points of transmissivity.
- **Blur radius 12px**, acceptable range 10-16px. Below ~8px the backdrop reads as sharp-but-tinted rather
  than glass; above ~20px content stops being recognisable and fails the ticket's own AC. `Modal.css:64`'s
  `blur(2px)` is a page-scrim precedent, not a material one, and is not a guide here.

Paint order needs stating: an absolutely-positioned `::before` paints above non-positioned in-flow content, so
the tabs take `position: relative` (or the `::before` takes `z-index: -1`, which works because
`backdrop-filter` already makes `.bottom-nav` a stacking context). Otherwise the tint hides the glyphs.

The executor implements these and then **measures the real composite by screenshotting and sampling pixels**,
because `backdrop-filter` is a compositing operation whose result cannot be read off the CSS. If measurement
disagrees with the model, measurement wins and alpha rises.

### D4. Labels are DROPPED — icon-only, matching the reference

Decided by the product owner (2026-08-21) after the cost was quantified, overriding this plan's earlier
"keep labels" call. **The recorded basis is the contrast floor, not the reference's appearance:** 10px labels
are WCAG small text and bind the bar to a 4.5:1 floor; with no text the bar is governed by WCAG 1.4.11's 3:1.
That difference is what sets the tint alpha, and therefore the transmissivity the ticket calls the reference's
defining property:

| governed floor | shipping tint alpha | backdrop transmitted |
| -------------- | ------------------- | -------------------- |
| 4.5:1 — labels kept | 0.65 | 35% |
| **3:1 — icons only (chosen)** | **0.55** | **45%** |

Labels cost ~10 points of transmissivity, a ~22% relative reduction. (An earlier draft of this document
justified keeping labels as costing nothing; that was circular — the 4.5:1 floor existed *because* of the
labels. The corrected figure is 45% rather than the 49% first quoted, because the lozenge's border floor, not
the glyph floor, is what actually binds at low alpha — see D6.)

Three things this makes load-bearing:

- **Accessible names are now the only way a screen-reader user can navigate.** Each destination keeps its
  full `aria-label` (already present in `BottomNav.tsx:25`, previously belt-and-braces alongside a visible
  short label). This is verified against the **computed accessibility tree** via CDP
  `Accessibility.getFullAXTree`, never by grepping markup — this repo has already shipped a defect where an
  `outerHTML` assertion certified the opposite of the computed a11y state.
- **The icons now carry the entire meaning.** Five read conventionally: `LayoutDashboard` (Dashboards),
  `Database` (Data Sources — the cylinder is the near-universal storage glyph), `Workflow` (Data Pipelines —
  a node graph), `ChartNoAxesColumn` (Metrics — a bar chart), `MessageCircle` (Assistant — a chat bubble).
  **One does not: `BookOpen` for Data Types.** An open book reads as documentation or a library, not as a
  registry of row shapes; with a label beside it that was harmless, and without one it is a dead end. See D11.
- **Discoverability risk, explicitly accepted.** Six unlabelled glyphs are harder for a beta user still
  learning source -> pipeline -> type -> panel. The named mitigation is **HEL-554** (Guided first-dashboard
  onboarding, the last leaf of the HEL-349 epic, Backlog), whose scope is precisely to teach that model with a
  step-by-step checklist. Recorded here so that if beta feedback says the icons are opaque, the reasoning and
  the remedy are already on record rather than needing rediscovery.

**Fit is no longer a constraint.** At 375px the capsule's inner width is 335px across six items — 55.8px per
tab for a 22px icon, against a 44px minimum. The crowding risk that made labels marginal is gone.

### D5. `--bottom-nav-height` is redefined as *total clearance*, and all three copies are consolidated onto it

A floating capsule breaks the token's old meaning. `theme.css` gains the primitives and redefines the existing
name — **replacing the declaration in place at the existing declaration**, never adding a second (a later duplicate would
win by source order and silently defeat the single-seam argument):

- `--bottom-nav-capsule-height` — the capsule itself (`--control-lg` + `--space-4` = 56px).
- `--bottom-nav-inset` — the edge margin, `--space-3` (12px).
- `--bottom-nav-height` — `capsule-height + inset + env(safe-area-inset-bottom)`: viewport bottom edge to the
  top of the capsule.

The capsule's own offset is therefore `bottom: calc(var(--bottom-nav-inset) + env(safe-area-inset-bottom))` —
stating it as bare `--bottom-nav-inset` would put the capsule inside the home-indicator zone and break the
token identity. Correspondingly `BottomNav.css:28`'s `padding-bottom: env(...)` is **removed**: the offset now
carries the home indicator, and leaving it alongside a flat 56px height and the global `box-sizing:
border-box` (`theme.css:192-194`) would crush the content box to ~22px on a 34px-inset iPhone while tabs still
declare `min-height: 44px`.

**Consolidation is in scope** (coordinator update, verified): HEL-535 added the token but left `BottomNav.css:27`
and `App.css:424` inlining the expression, so a token-only change would desynchronise them. Both are inside
this ticket's fence and both are being rewritten anyway, so this change points them at the token family — one
definition, three consumers (the nav, the content padding, and HEL-535's toast viewport). `toast.css` stays
correct **unedited**: `calc(var(--bottom-nav-height) + var(--space-4))` still lands 16px above the capsule.

### D6. Active state is a material lozenge whose visibility comes from its border, not its fill

The active item gets an inner rounded lozenge nested inside the capsule — not an accent block, not an
underline. Two layers with distinct jobs:

**Carrier.** The lozenge's padding and border MUST live on a dedicated wrapper element around the icon —
`<span class="bottom-nav__lozenge">` in `BottomNav.tsx` — never on the lucide `<svg>` itself. Lucide renders a
`width="22"`/`height="22"` presentation attribute, and `theme.css:192-194`'s global `* { box-sizing:
border-box }` then resolves padding and border *inward* from that 22px: the specified
`var(--space-1) var(--space-3)` + 1px clamps the SVG's content box to **0px**, producing a 26x22 empty ring
with no glyph in it. To keep the icon from shifting between states, the carrier is present on every tab and
carries a `1px solid transparent` border always; only its `background` and `border-color` change on the active
tab, so no layout reflows when the active tab changes.

**Box.** Per the ticket ("a rounded rect behind the active **icon**"), the lozenge wraps the active tab's icon
only — not the whole tab. `padding: var(--space-1) var(--space-3)` plus the 1px border around the 22px icon
gives **48x32px**, which at 375px leaves ~3.75px clearance to the tab's edges and ~11px to the capsule's top
and bottom. Radius `--app-radius-pill`. A lozenge sized to the whole tab would be ~56x56 at zero vertical
padding, clamp to a circle, collide with the capsule's inner edge, and read as a stray ring rather than an
inner lozenge (AC 4).

- **Fill: `--app-surface` at alpha 0.95**, raising local opacity to ~0.98 effective over the tint. This is the
  "more opaque" part the ticket asks for. It deliberately reuses the *capsule's own* token, so the active
  icon's backdrop is essentially today's opaque bar background.
- **Border: a 1px hairline of `var(--app-text)` at full strength** — *relative to whatever is behind it*,
  which is the entire point, and the only thing that actually carries the lozenge's visibility. It is not a
  70% mix: at alpha 0.55 a 70% mix reaches only 2.50:1, below the floor. At full strength the border's
  separation from the capsule is arithmetically identical to the inactive icon's (both are `--app-text` over
  the same composite), so one number governs both: **3.44:1 (dark) / 4.89:1 (light)**. Using `--app-text` as
  a border colour is outside `DESIGN.md` §3's two-token border vocabulary and must be called out explicitly in
  the carve-out rather than arriving silently in a change that is *editing* `DESIGN.md`.
- **Paint model: no `background-clip` declaration is needed, and none should be written.** With a
  *translucent* border this matters enormously — round 3 measured the default `border-box` dropping a 70%-mix
  border from 3.26:1 to 2.51:1, because the lozenge's own fill paints under the border and shifts it. With the
  **opaque** `var(--app-text)` border chosen above, the fill behind it is completely covered: rendered across
  10 theme x backdrop cells, `padding-box` and the CSS default are pixel-identical. Declaring it anyway would
  be dead CSS, and pinning it in a test would pin a premise that no longer holds. Recorded here because it
  becomes load-bearing again the moment anyone weakens the border back to a `color-mix`.

An absolute fill token cannot carry this. `--app-surface-strong` and `--app-surface` are adjacent rungs of one
neutral ramp (2/255 apart in light, 12/255 in dark), so `lozenge - capsule = k*(S_strong - C)` where
`C = a*S + (1-a)*B` passes through exactly zero at `B ~ rgb(60,55,51)` in dark (measured at the
then-current alpha 0.65; the convergence exists at every alpha, only its location moves) and asymptotes to zero for any
light `B` in light. Rendered measurement of that construction gives **1.02-1.15:1 over every theme-matched
backdrop** — invisible, and invisible precisely in the default case, which covers five of the six destinations
(every non-dashboard route's backdrop is `--app-bg`). A relative border cannot converge, because it is a fixed
proportional shift away from the capsule material itself.

Measured worst case across theme-matched `--app-bg`, pure white, pure black, and all eight accent presets,
**border-vs-capsule 3.44:1 (dark) / 4.89:1 (light)** — clearing WCAG 1.4.11's 3:1 for UI component boundaries
everywhere, including the backdrops where the fill legitimately converges. The fill supplies depth; the border
supplies the affordance. **Stated as a floor: the lozenge's boundary SHALL reach 3:1 against the adjacent
capsule material, measured from rendered pixels** — sampled on the lozenge's straight top edge, never at the
curve apex where antialiasing dilutes a 1px border (worth ~0.2 with only ~0.1-0.3 of headroom). It needs its
own verification task over **theme-mismatched** backdrops in particular: the border's weak region is the exact
complement of the fill's, so a theme-matched-only matrix reads 6-8:1 and proves nothing.

Affordance rests on two independent cues: the bordered lozenge (material, 3.44:1 minimum) and `--app-accent`
on the active icon (hue). The label-weight cue from the previous draft is gone with the labels.

**The fill contributes essentially nothing to visibility** — measured, it separates from the capsule by
~1.01:1 over theme-matched backdrops. It is kept for one reason only: it raises local opacity to ~0.98 so the
accent icon sits on what is effectively today's opaque bar background. The border does all the work of
indicating the active tab. This is a deliberate divergence from the reference, whose lozenge is borderless and
carries itself on fill alone; a borderless fill cannot be made to clear 3:1 over hostile backdrops without a
mid-grey slab that abandons the material entirely.

**The accent icon, stated honestly.** Because the fill reuses `--app-surface`, the active icon's backdrop lands
within ~2% of today's opaque bar. Measured worst-case change across all eight presets is **-0.24 to -0.49**
(dark Red 4.70 -> 4.46, dark Purple 4.47 -> 4.24, dark Yellow 9.23 -> 8.74); no dark preset falls below
4.24:1, comfortably above the 3:1 non-text threshold. Light theme moves by at most 0.18 and remains
1.78-3.71:1, below 3:1 for four presets —
genuinely pre-existing and not introduced here. `DESIGN.md` (task 2.4) must claim exactly that and no more: a
small measured decrease in dark, an unchanged pre-existing shortfall in light, and the accent explicitly *not*
the sole active indicator. Worth a spinoff; not this ticket.

### D7. Verification is by rendered geometry and sampled pixels, never by reading CSS

Touch targets and geometry are asserted with `getComputedStyle` at 375px, 430px, and 768px. Reading the
stylesheet is not acceptable: HEL-535 shipped a defect where a `@media` block above the base rule made a 44px
floor inert at equal specificity, which source-reading cannot see. That is the fifth touch-target regression
here, so base/media ordering in `BottomNav.css` is itself a review item — and the safe-area assertion must run
with a **non-zero simulated inset**, or it proves nothing.

`getComputedStyle` returns border-radius's *computed*, not used, value — with `--app-radius-pill` it reports
`9999px`, never "half the height" — so semicircular ends are asserted from rendered pixels instead: the pixel at
the capsule's bounding-box corner must be backdrop, and the pixel at its left edge, vertical centre, must be
capsule. Reduced motion is likewise asserted on the *rendered* element under an emulated
`prefers-reduced-motion: reduce`, not by parsing the stylesheet — a reduced-motion block placed above the rule
it means to override loses at equal specificity and a source-reading test still passes, which is HEL-535's
inert-44px bug with a different property.

Accessible names are verified from the **computed accessibility tree** (CDP `Accessibility.getFullAXTree`),
not from markup. With no visible labels the `aria-label` is the entire accessible name, and this repo has
already shipped a defect this session where a `role`'s implicit ARIA default made an `outerHTML` grep certify
the opposite of the computed state. Markup assertions cannot see computed ARIA; the AX tree can.

There is no photo-background feature to test against: `DashboardAppearance.background` is a colour string
(`dashboard.ts:8`) applied as `background-color` (`App.css:9`). The "photo" case must be synthesised — inject
a background image on `.app-shell`, and additionally scroll a dense panel grid beneath the bar as the
real-world analogue — or the measurement is unrepeatable.

### D8. `prefers-reduced-motion` disables added motion outright

The added motion is the lozenge's transition. Under `prefers-reduced-motion: reduce` it is removed with
`transition: none`, **not** `transition-duration: 0s`: `theme.css:244-251` already forces
`transition-duration: 0.01ms !important` globally, so a longhand duration would be silently overridden, while
`transition: none` works because it clears `transition-property`, which the global rule does not touch — the
same mechanism `Skeleton.css:53-61` documents and `DESIGN.md:166-169` calls out.

### D9. `backdrop-filter` is prefixed, and has a declared no-blur fallback

`-webkit-backdrop-filter` is emitted alongside the unprefixed property. The ticket's premise is the installed
**iOS** PWA, and the repo's single existing usage (`Modal.css:64`) is unprefixed and desktop-facing — not a
precedent. All verification runs in headless Chromium, which structurally cannot surface a Safari-only miss,
so the prefix is a design decision rather than something testing will catch.

No `@supports` block is written: the tint is an unconditional layer, so a browser without `backdrop-filter`
already renders exactly the intended fallback — tint alone, no blur — and an `@supports not (...)` rule would
be dead CSS pinned by a test. The contrast model survives that degradation untouched, because blur does not
move a uniform backdrop's mean and D2's bounding argument rests on the white/black extremes. The bar simply
reads as flat translucency rather than glass.

### D10. `.panel-list__zoom-widget` is retargeted onto the token

`PanelList.css:79-96` pins it `position: fixed; bottom: var(--space-5); z-index: 10` and hides it only below
**430px**, while `BottomNav` renders to 768px — so between 431px and 768px it would sit directly on top of the
new capsule, over the Assistant tab, at a width the verification tasks explicitly render. Today it rests
harmlessly on an opaque strip. It is retargeted to clear `--bottom-nav-height` within the nav's breakpoint
only, leaving desktop untouched. The file belongs to neither HEL-535 nor HEL-772, so it is inside this fence.
Leaving it would falsify the "single seam" claim this design rests on.

### D11. `BookOpen` becomes `Shapes` for Data Types — a defect this change creates, so it fixes it

Of the six glyphs, five read conventionally without a label (D4). `BookOpen` for Data Types does not: an open
book means documentation or a library, not a registry of row shapes. While the label sat beside it this was
invisible; dropping the labels is what turns it into a navigation dead end, so it is this change's defect to
fix rather than a pre-existing one to inherit.

`Shapes` (verified present in the installed `lucide-react` 1.14.0, alongside the rejected `Boxes`, `Braces`,
`Tags`, `Table2`) reads as "kinds of things", which is what a type registry is. `Braces` was rejected as
developer-coded for a broader audience; `Table2` collides with the Metrics bar chart; `Library` repeats
`BookOpen`'s error.

The edit lands in `sections.ts`, the shared registry, so it also changes the desktop sidebar's icon. That is a
deliberate, contained widening of scope: the desktop sidebar keeps its labels, so the change is cosmetic
there and corrective here, and leaving the two surfaces on different icons would breach the registry's
single-source-of-truth guarantee that `navDestinations.ts` exists to enforce.

### D12. The focus ring is re-shaped for a floating capsule

`BottomNav.css:71-74` gives `.bottom-nav__tab:focus-visible` a 2px accent outline at `outline-offset: -2px`.
That was correct for a flush, full-width strip. On a pill, the first and last tabs extend into the capsule's
semicircular ends, and a rectangular outline overhangs the rounded edge on three sides — rendered, a hard
accent square breaking out of the capsule. `DESIGN.md:291-293` is `[mechanical]` and scopes the `-2px` inset
recipe to "flush list items"; a floating capsule is not one, so this is a documented exception rather than a
rule violation.

The tab therefore takes `border-radius: var(--app-radius-pill)` so its outline follows the same curve, with the
offset deepened to `-3px` to keep the ring clear of the capsule's own hairline. Verified from rendered pixels
at the first and last tabs, which are the only ones that can overhang.

## Risks / Trade-offs

- **HEL-535 has merged** (PR #408, `origin/main` `2eaf1d26`, token at `theme.css:90`), so preflight should
  pass by merging `origin/main` into this branch. If the token is somehow still absent after that, it is an
  escalation, not a guess.
- **The capsule's edge uses `--app-border-strong`, not `--app-border-subtle`.** At subtle the capsule's edge
  against a theme-matched page measures ~1.16:1 and is very nearly invisible; at strong, ~1.42:1. No numeric
  floor is set for it (it is figure-ground, not legibility), but the token is named and the final gate judges
  it from retained evidence.
- **The capsule's edge is load-bearing, not decoration.** Over a theme-matched backdrop the capsule composite
  sits within ~5/255 of the page colour (dark `rgb(18,17,16)` -> `rgb(23,21,19)`), so figure-ground separation
  for the whole bar rests on the shadow and hairline of task 3.6. That matches how iOS bars read over flat
  backgrounds, but it means the final gate must judge the capsule's edge as carefully as its contrast.
- **`backdrop-filter` cost.** A blurred surface composited over a scrolling panel grid is the expensive case.
  Mitigated by the capsule being small (~351x56, not full-bleed) and the blur radius being small. Must be
  checked under CPU throttling against a stated threshold, not eyeballed.
- **Contrast floor vs. transmissivity is a genuine trade**, now settled at 45% by the product owner's
  icon-only decision. If the rendered result still does not read as glass, that is an escalation rather than a
  ship — the remaining lever would be the blur radius or the shadow, not the alpha.
- **Icon-only navigation is a real discoverability cost**, accepted deliberately (D4) with HEL-554 as the
  named mitigation. If beta feedback says the glyphs are opaque, the remedy is onboarding, not re-adding
  labels — re-adding them would push the floor back to 4.5:1 and cost 10 points of transmissivity.
- **The lozenge's border is the whole active affordance**, and its worst case (3.44:1, dark over white) has
  ~0.44 of headroom against the floor. If rendered measurement lands materially below the model, the answer is
  to raise tint alpha (costing transmissivity), not to weaken the floor.
- **Spec-level behaviour change.** The existing `mobile-bottom-nav` spec mandates opacity and muted inactive
  ink; the delta must retire those scenarios rather than accumulate contradictions.

## Planner Notes

Escalated and decided by the product owner, not self-approved: the labels call (D4), raised once the cost was
quantified and answered `drop-labels`. Self-approved: the floor's value and scope (D1/D6); the
token redefinition and the three-copy consolidation (D5), confirmed in scope by the coordinator and verified
against both branches; the zoom-widget retarget (D10); the `BookOpen` -> `Shapes` icon
correction (D11), as a defect this change creates. Deferred to an execution-time check, not self-approved:
building against `--bottom-nav-height` before HEL-535 merges. Flagged for a spinoff, explicitly not fixed
here: app-wide accent-on-surface contrast (D6).
