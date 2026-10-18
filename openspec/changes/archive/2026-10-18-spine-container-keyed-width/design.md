## Context

See proposal.md (Why). Geometry, from the tree: the shell grid is `56px rail | --context-list-width (200..400, default
248) | page` (`frontend/src/app/App.css`), so the page container `.pipeline-detail-page--spine` (already
`container-type: inline-size`, `PipelineSpineLayout.css`) is 313–644px wide at 769–1100px viewports with the list at
400, and 465–796px with it at 248; 976px at 1280 (default list). `.spine-body` is its direct child, so `cqi` inside
`.spine-body`'s grid template resolves against the page. A row (`SpineStepRow.tsx`, styles in `PipelineSpine.css`) is
`[grip abs] [select: number 24px | text(title/summary) | markers (always rendered, often empty) | count 3ch] [menu ⋮]`,
flex with `gap: var(--space-3)`; the menu is `opacity: 0` unless hovered/focused/selected but always reserves its width.
Lane rows sit in `.spine-lane--sub` (left margin `--space-5`). The phone layout (HEL-1582, `PipelineMobile.css`) reuses
`SpineStepRow` (`spine-row--phone`) but never renders inside `.spine-body__spine`.

## Goals / Non-Goals

**Goals:** readable titles (≥~60px visible, or full) on every trunk and lane row at 769–1100px, both themes, list at
248 and 400; keep every HEL-1579 narrow-width header/editor/no-scroll guarantee; 270–340px spine at 1280×800.

**Non-Goals:** anything ≤768px; any TSX/DOM change to `SpineStepRow` (it is shared with the phone); token changes.

## Decisions

**D1 — Container-keyed track with a "main keeps ~320px" floor.** Replace `clamp(180px, 22vw, 340px)` with
`clamp(180px, max(34cqi, min(240px, 100cqi - 320px)), 340px)`. Worked values (page width → spine / main):
313 → 180/133 (today's value, so no header/editor regression is possible there); 465 → 180/285; 560 → 240/320;
644 → 240/404; 796 → 271/525; 976 (1280×800) → 332/644; 1136 → 340. The spine only grows beyond 180 when the centre
column keeps ≥320px, so it never takes the room the editor column
needs (HEL-1579 cycle 4's fixed 270px floor did; its header clipping was a page-level issue the track cannot cause,
since the header spans the page).
The executor may tune the constants (e.g. 34cqi, 320px) by measurement, but must keep: 180px floor, 340px cap, spine in
270–340 at 1280×800 with list 248, and main ≥ ~320px whenever spine > 180px. Alternative rejected: a viewport media
query (the defect itself); a single fixed floor of 240px (main would be 73px at 769/list 400).

**D2 — Row compaction keyed to the spine column's own width, desktop-only.** Make `.spine-body__spine` a NAMED
container (`container: spine-column / inline-size`) and add `@container spine-column (max-width: 226px)` rules in
`PipelineSpine.css`, scoped to `.spine-body__spine .spine-row…`. Unit: a container query measures the column's CONTENT box (track minus 32px
inline padding and 1px border), so 226px content = a track of about 259px; at 1280×800 with either list width (spine
≥ 280px) compaction is OFF. Levers, in this order, stop when the sweep passes:
(a) empty `.spine-row__markers:empty` leaves the flow (no wasted flex gap); (b) the select's gap drops to
`--space-2`; (c) the row count moves onto the summary line (CSS only, e.g. the select becomes a two-row grid or the
count is positioned at the summary line's end with the summary padded to clear it; no DOM change); (d) the ⋮ menu stops
reserving width: absolutely positioned at the row's right end over a row-coloured background, `opacity: 0` AND
`pointer-events: none` unless `.spine-row:hover`/`:focus-within` (both restored there) — NOT `visibility`/`display`
(it must stay in tab order so keyboard focus reveals it); `pointer-events: none` is MANDATORY, not optional: the
hidden ⋮ must be un-hittable, both for taps and for D3's occlusion probe. On the selected row it shows on hover/focus
too, not permanently, below this width. No padding lever: a
`spine-column` query cannot style the column itself, and (a)–(d) suffice (skeptic recount: a lane title of about 79px
at a 180px spine). The drag grip (`left: -space-3`) stays inside the unchanged column padding. A named container is required: unnamed `@container` rules
(the filter-condition rows in `PipelineSpineLayout.css`, the header rules) must keep resolving to their current
containers; the executor greps every unnamed `@container` whose subject could sit inside `.spine-body__spine` and
records that there are none. Because `spine-column` exists only in the desktop layout, phone rows are untouched.

**D3 — The readability assertion (the red-first proof).** In the existing "sweep 769-1100px" test only (constraint C3):
seed with `seedPipeline(page, true)` so lane rows exist (no edit to `seedPipeline`), and (i) right after each page load at 1280×900 with the
list at its default, assert `.spine-body__spine` is 270–340px wide (the committed check of the 1280 spine invariant;
the separate 1280×800 test is outside C3); (ii) per width measure every
`.spine-body__spine .spine-row__title`: `full = scrollWidth <= clientWidth + 0.5` and the title box lies inside the
spine column's client rect; `visible = width of (title rect ∩ spine column client rect)`; and an occlusion probe at BOTH ends of the
visible part: `document.elementFromPoint` at (visibleLeft + 4, centreY) and (visibleRight - 4, centreY) returns the
title or a descendant (the right end is where an overlaid ⋮ would sit). The probe passes on a compacted row only because the hidden ⋮ has
`pointer-events: none` (`elementFromPoint` ignores such elements but not `opacity: 0` ones); a visible or hittable
overlay fails it, which is the point. Readable iff unoccluded and (full or visible ≥ 60). The failure message names width/theme/list, the step
label (from the row's accessible name) and the measured px. Mouse is moved to (0,0) before measuring so no hover state
leaks. The assertion is committed first and run against unchanged CSS; the failing output is persisted as evidence
(`red-proof.txt` in the change dir) before the CSS fix lands.

**D4 — Doc nits.** Spec wording per the delta (paused chip drops its icon below ~600px; spine width wording). Archived
HEL-1579 design D2: change `clamp(270px, 22vw, 340px)` to the shipped track and note that HEL-1608 superseded it with
D1 here. `PipelineSpineHeader.css` comments at :295 ("Below 1100px the page…") and :331 ("After the 1100px block…")
refer to the `max-width: 800px`/`600px` container blocks (content width), not 1100/900px viewports.

## Risks / Trade-offs

- [Lane rows are ~20px narrower than trunk rows] → the sweep measures lane rows explicitly (D3); lever (d) exists
  for exactly that margin (a lane title of ~51px after (a)–(c) at a 180px track, ~79px with (d)); a ~15px scrollbar,
  if the spine ever scrolls, still leaves ~64px.
- [An overlaid ⋮ hides the title end while hovered] → transient and only on the hovered/focused row; the sweep moves the
  mouse away, and since the hidden ⋮ is `pointer-events: none` the two-end probe sees the title; any overlay that is
  visible or hittable when not hovered fails the probe.
- [`container-type` makes the spine column's min-content 0 and the containing block for fixed/absolute descendants]
  → its width comes from a definite track; the ActionsMenu panel portals to `<body>`; grip/menu absolutes position
  against rows. The 1280 spine width is asserted by D3(i).
- [Touch at desktop widths: a tap near a compacted row's right end can hit the invisible ⋮] → prevented: the hidden ⋮
  is `pointer-events: none` (D2(d)), so a tap there selects the step; keyboard focus still reveals and enables it.
- [Shared spec file with HEL-1620] → C3: confined edit, whole-file re-run on the merged head.

## Planner Notes

- Self-approved: CSS-only approach, constants tunable within D1's invariants, levers order in D2.
- `pipeline-schedule-config-ui`'s "Layout scope (HEL-1579)" paragraph states ≤1100/≤900 viewport thresholds while the
  CSS keys off 800/600px content width — same nit family, not named in the ticket; left as a follow-up candidate.
