## Context

See proposal.md (Why). Current state on main (beb94adfe):

- `HomeOpeningLine.tsx` renders, while the summary is `null`, `<div role="status" class="home-opening__loading">` containing `<p class="home-opening__ghost" aria-hidden="true">{DEFAULT_SENTENCE}</p>` and `<Skeleton variant="line" class="home-opening__skeleton-line" />`.
- `HomePage.css`: `.home-opening__ghost { visibility: hidden; max-width: var(--home-sentence-measure) }`, shared typography with `.home-opening__sentence`, a Sans-only nowrap + `overflow: hidden` band from `37.8125em` (HEL-1737), and `.home-opening__loading .home-opening__skeleton-line { position: absolute; top: 50%; width: min(520px, 80%); height: var(--text-xl); transform: translateY(-50%) }`.
- `Skeleton.css` owns the only shimmer recipe (`.ui-skeleton`: gradient over `--app-surface-soft`/`--app-surface-raised`, `background-size: 200% 100%`, `ui-skeleton-shimmer` keyframes on `--app-skeleton-shimmer`, `border-radius: var(--app-radius-sm)`), plus the reduced-motion (`:root:not([data-motion])` under `prefers-reduced-motion: reduce`) and `:root[data-motion="off"]` flat-fill overrides. Its header forbids any other file defining shimmer keyframes or a shimmer background (DESIGN.md §7).
- Guards: `e2e/hel1665-home-phone-stability-{light,dark}-{summary,dashboards}-first.spec.ts` + `e2e/support/hel1665-home-phone-stability.ts` + `e2e/support/homeLoadProbe.ts` (0px series), `e2e/hel1678-home-large-font.spec.ts`, `e2e/hel1572-appearance-preferences.spec.ts`; the HEL-1737 sweep is the evidence tool `openspec/changes/archive/2026-11-17-font-independent-home-sentence-cap/evidence/tools/vsweep2.cjs` (ghost height, web font vs fonts blocked, every width 320-1300, light/dark, CDP-proven face), run in the `helio1678-ci` (Liberation) and `helio1678-dv` (DejaVu-only) images. No e2e selects `.home-opening__ghost` or `.home-opening__skeleton-line` today (grep); unit tests do.

## Goals / Non-Goals

**Goals:**
- One bar per rendered line of the hidden default sentence, everywhere the placeholder shows (the AC range is 431-604px; the mechanism is width-independent, so 320-430px, the 605px+ one-line band and Serif/Mono wraps get the same behaviour for free and are asserted too).
- Zero layout change to the placeholder: identical height at every width in every face, so the 0px series and the 320-1300 sweep are unaffected.
- Reuse the shared skeleton recipe and its motion behaviour verbatim.

**Non-Goals:**
- No change to `Skeleton.tsx` / `Skeleton.css`, no new shimmer recipe, no JS line counting or ResizeObserver.
- No change to the real opening sentence, the type-style measure tokens, or the 605px nowrap band.
- HEL-1748's accepted 605-613px data-first residual is out of scope.

## Decisions

### D1. An inline span carrying `ui-skeleton`, inside the hidden ghost

Markup: `<p class="home-opening__ghost" aria-hidden="true"><span class="ui-skeleton home-opening__ghost-bar">{DEFAULT_SENTENCE}</span></p>`; the separate `<Skeleton>` element is removed. `HomeOpeningLine.tsx` keeps an explicit side-effect `import "../../../shared/ui/Skeleton.css";` (with a one-line comment) so the `ui-skeleton` styles never depend on a sibling Home component happening to import `Skeleton` (design CR 3).

CSS (in `HomePage.css`, never `Skeleton.css`), selector of at least two classes so it beats `.ui-skeleton`'s `display: block`:

```
.home-opening__ghost .home-opening__ghost-bar {
  display: inline;              /* an inline box paints its background once per line fragment */
  visibility: visible;          /* a child may be visible inside a visibility:hidden parent */
  color: transparent;           /* the bar shows, the text does not */
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;  /* each fragment gets its own rounded ends, its own gradient and its own mask */
  pointer-events: none;
  user-select: none;
  /* + the thickness mask, D2 */
}
```

What does what (corrected after design round 1): `display: inline` is what makes the background paint once per line fragment (it does so under `slice` too). `clone` gives each fragment its own rounded ends (border-radius), its own 200%-wide shimmer gradient (so each line shimmers like an independent bar rather than one strip across fragments) and its own mask (D2). The span's background, size, animation and radius come from `.ui-skeleton` itself, so reduced motion and motion Off apply unchanged through Skeleton.css's existing selectors (they set `animation`/`background`, which this rule does not touch). An inline box without padding/border/margin adds nothing to line boxes, so the paragraph lays out exactly as the plain text did.

Alternatives considered:
- *Keep the absolute bar and add a second one per line via a repeating-linear-gradient on the ghost.* Needs a second shimmer background outside Skeleton.css (forbidden by DESIGN.md §7) and per-width line geometry: rejected.
- *JS line counting (ResizeObserver, `getClientRects`) rendering N `<Skeleton>` bars.* Explicitly excluded by the ticket: rejected.
- *Use the `Skeleton` component with children.* `Skeleton` renders an empty span and the ticket forbids changing it; using its class on an element we own is the reuse the ticket asks for.

`box-decoration-break`: the round-1 skeptic probe (HeadlessChrome 156) confirmed per-fragment rendering. The e2e runs in Playwright 1.55's bundled Chromium and in the helio1678-ci/dv images; task 1.1 records that exact build and re-measures there (web font, and fonts blocked with the Liberation-matched and the DejaVu-matched fallback faces), STOPPING with ESCALATION if it does not render per-fragment bars.

### D2. Bar thickness and gap: a per-fragment rounded-rect mask, numeric targets

Measured in round 1: an unmasked inline background paints the face's content area, 29px per bar with a 1px gap at 24px (same 1-2px at 20px), in the web font and the fallback face: two near-touching slabs, not the skeleton look. Line-height and font-size must not change (layout). So the span gets a vertical mask, painted per fragment under `clone`, that leaves a centred band visible:

- **Targets (acceptance signal for "matching the existing skeleton look"):** each bar's painted thickness is `0.8em` ±1px of the sentence size (19.2px at the 24px size, about today's 20px `--text-xl` bar; 16px at the 20px phone size), the vertical gap between consecutive bars is at least `--space-2` (8px) at both sizes (expected ~10.8px / ~9px), and each bar's four corners are rounded with `--app-radius-sm` (6px), like every other skeleton.
- **Mechanism (rounded ends kept):** a composed rounded-rectangle mask on the span (`mask-image` + `-webkit-mask-image`, `mask-repeat: no-repeat`, sizes/positions per layer): two `linear-gradient(#000, #000)` layers forming a cross (one full width x (band - 2r) high, one (width - 2r) wide x band high, both vertically centred on the band) plus four `radial-gradient(circle at …, #000 r, transparent r)`-style corner layers of size r x r at the band's corners, where band = `0.8em` and the band's top inset = `(content-box height - band) / 2` expressed with `calc()` in `em`/`%` so it centres on each fragment's content box. The executor may use an equivalent per-fragment construction (e.g. an SVG data-URI mask with fixed-radius corners) if it is simpler, as long as it is a mask (not a second background), is painted per fragment, and meets the targets. The mask never touches `background`/`animation`, so the shimmer recipe and its reduced-motion/motion-off fills are still Skeleton.css's.
- A mask is not a shimmer background or keyframes, so DESIGN.md §7 / Skeleton.css's header rule holds. A unit assertion pins it, scoped so it cannot touch unrelated shipped motion (design round 2): HomePage.css never mentions `ui-skeleton-shimmer`; its only `@keyframes` is HEL-1584's `tl-nudge` (the run-timeline nudge, unrelated to this change, left untouched); no `background`/`background-image` declaration anywhere in HomePage.css uses `linear-gradient`; and the `.home-opening__ghost .home-opening__ghost-bar` rule body declares no `background`, `animation` or `@keyframes`.
- If no layout-neutral per-fragment construction meets the targets in the Playwright Chromium build (task 1.1), STOP and ESCALATE with the measurements; never change line-height or font-size to make room.

### D3. Width of each bar is the line's text extent

A bar spans the words on its line, so the last line's bar is shorter (paragraph skeleton shape). From 605px in Sans the ghost is one line with `overflow: hidden`, so the bar is the sentence width, clipped at the content box where a fallback face renders it 1-8px wider (HEL-1737 measurements): accepted and recorded, paint-only (the clipped right end loses its rounding in that 605-613px fallback case only). This replaces today's fixed `min(520px, 80%)` desktop bar width with the sentence width (about 580px at 24px); stated here as a deliberate, visible change at desktop widths.

### D4. Tests

- New e2e spec `e2e/hel1749-home-opening-skeleton-lines.spec.ts` (title prefix "HEL-1749"): hold `/api/home-summary` (never fulfil) so the placeholder stays; at widths 320, 375, 430, 431, 480, 540, 604, 605, 1024, 1280, light and dark, Sans:
  - **Fragments:** `getClientRects()` of the bar element (each width > 0) equals the ghost's line count (`round(ghost height / computed line-height)`); at 431 and 604 that count is 2 (pins the AC). This proves one painted fragment per line but does NOT by itself distinguish clone/slice or visibility; the computed-style and geometry assertions below do.
  - **Painted bar geometry:** the painted band per fragment is computed from the fragment rect and the resolved mask insets, OR (preferred, mechanism-independent) measured from a screenshot of the placeholder region: per fragment, scan the column at the fragment's horizontal centre for non-page-background pixels and derive bar top/bottom; assert thickness = 0.8em ±1px (font size from computed style), gap between consecutive bars >= 8px, at 431/480/604 and 320/375/430, light and dark. Corner rounding: the pixel at the bar's top-left (1px in, 1px down) is page background while a pixel r px in along the top edge is bar colour.
  - **Computed style:** bar `visibility: visible`, `color` transparent, `display: inline`, `box-decoration-break` (or `-webkit-`) `clone`, `background-image` the skeleton gradient, `animation-name: ui-skeleton-shimmer`, mask-image non-`none`; no element under the placeholder other than the ghost bar carries `ui-skeleton` (old absolute bar gone).
  - **Reduced motion:** with `reducedMotion: "reduce"` (and separately `data-motion="off"`), `animation-name: none` and background is the flat `--app-surface-soft`, bars still per line with the same geometry.
  - **Other styles:** Serif and Mono at 1280 (Mono's default sentence is two lines): fragment count equals line count.
  - Screenshots light/dark at 431, 500, 604, 1280 and reduced motion at 500 to the change's `evidence/screens/`.
- Red first (C1): the spec is run against base and the failing run committed before implementation.
- Mutations after green, each re-run on the full spec and recorded, with the assertion that catches it named in `evidence/mutations.txt`: (a) drop both `box-decoration-break` declarations → computed-style clone assertion (and corner-rounding check on line 2); (b) drop `visibility: visible` → computed visibility + geometry scan (no painted bar); (c) drop the mask → thickness/gap assertions; (d) restore the absolute single bar → "only one ui-skeleton" + fragment assertions.
- Unit: `HomePage.css.test.ts` replaces the "bar laid over it, absolute" assertion with the inline-bar rule shape (display inline, visibility visible, color transparent, both clone declarations, mask-image + -webkit-mask-image present, no `position: absolute`, no `background`/`animation` in the bar rule body; plus the D2 file-level shimmer assertion: no `ui-skeleton-shimmer`, `tl-nudge` is the only `@keyframes`, no `linear-gradient` in any `background` declaration); `HomePage.test.tsx` asserts the bar span inside the ghost with the default sentence text and `ui-skeleton` class, and no `.home-opening__skeleton-line`; a unit assertion (or a source-text check) that `HomeOpeningLine.tsx` imports `Skeleton.css` directly.

## Risks / Trade-offs

- [Find-in-page matches the transparent placeholder text while loading] → `user-select: none`; the paragraph is `aria-hidden`; accepted as transient (only until the summary arrives).
- [Mask math centres the band slightly differently per face (content-box height differs by face)] → targets are ±1px thickness and >=8px gap, asserted in the web font in e2e and measured with fonts blocked in both containers (task 4.3/4.4).
- [Mask corner construction is fiddly] → D2 allows an equivalent per-fragment construction; corner-rounding pixel check in e2e.
- [Fallback-face bars differ slightly in thickness/width from web-font bars during a cold load] → paint-only; layout guard is the unchanged 320-1300 height sweep, re-run at head in both containers.
- [Selector changes break an e2e] → grep showed none select the removed class; executor re-greps `e2e/` and `frontend/` for `home-opening__skeleton-line` and `home-opening__ghost`.
- [Specificity: `.ui-skeleton`'s `display: block` wins] → two-class selector; e2e asserts computed `display: inline` implicitly through fragment count.

## Migration Plan

None (CSS + markup). Rollback is a revert.
