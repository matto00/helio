# HEL-1723 sweep: every `.panel-grid-card` hit in `e2e/`

Command (branch base d60b1f799): `git grep -n "panel-grid-card" HEAD -- e2e`
Base: 72 hits in 20 files. After the change: `git grep -n "panel-grid-card" -- e2e` = 62 hits (12 FIX entries: 11 converted away from the string, plus hel1028:310, which keeps its `__handle` string and only gains a wait;
and one hit added: the new doc comment in `hel1584-motion-surfaces.spec.ts` openDashboard mentions the class).
Per-file base counts: hel1023:1 hel1028:3 hel1094:1 hel1096:1 hel1230:2 hel1392-burst:2 hel1392-staleness:2 hel1398:4
hel1444:4 hel1457:3 hel1573-grid-chart:6 hel1573-primitives:1 hel1575-tabs:3 hel1575-switch:3 hel1584-perf:3
hel1584-surfaces:17 hel1656:1 hel1681:2 hel572:4 hel588:9 (sum 72). No hit in hel1685 (not touched).
Line numbers below are the BASE (HEAD) line numbers.

Verdicts: FIX / OK-filtered / OK-settled / OK-not-a-read / OK-scoped (design D2).

## FIX (converted to `waitForPanelGrid` / `waitForPanelStack`, helpers from `e2e/support/panelGridReady.ts`, no new helper)
- hel1028:310 (`.panel-grid-card__handle` count 0 straight after goto, xs): `waitForPanelStack(page, 2)` first. See mutation-hel1028.md.
- hel1573-grid-chart:285 and :389 (`.panel-grid-card` count 3 after goto): `waitForPanelGrid(page, 3)`.
  :396 (in-page loop over every `.panel-grid-card`): OK-settled by :389 (+ canvas visible :390), no load between.
  :398 (`card.querySelector(".panel-grid-card__title")` inside that loop): OK-scoped to the `card` of the :396 loop, which the
  :389 `waitForPanelGrid(page, 3)` settles, and `__title` is a class only real cards carry. This covers all 6 hel1573-grid-chart
  hits (:172 OK-filtered, :285 FIX, :305 OK-filtered, :389 FIX, :396 OK-settled, :398 OK-scoped) and, with the rest, all 72 base hits.
- hel1573-primitives:62 (count 3 after goto /dashboards): `waitForPanelGrid(page, 3)`.
- hel1584-perf:183 (count PANELS after goto): `waitForPanelGrid(page, PANELS, {timeout: 30_000})`. The load metrics come from an
  init-script poller that started at navigation, so waiting longer here does not move them.
- hel1584-surfaces:61 (`openDashboard`, count `cards`): viewport-aware wait (`waitForPanelStack` below 768 px, because one
  caller, :447, runs at 375 px; else `waitForPanelGrid`).
- hel1584-surfaces:101, :371, :385, :430 (counts 3/3/3/4 after a goto, tab switch or route return): `waitForPanelGrid`.
- hel1681:332 and :343 (`.panel-grid-card` `.first()` visible, both at 1280 px): `waitForPanelGrid(page, 3)` (seedWorld seeds 3 panels).
  Only these two lines plus one import line changed in that file (lane HEL-1692 overlap risk, name it in the PR).

## OK-filtered (filter only a real card carries; cite the filter)
- hel1028:126, hel1230:84, hel1457:48 and :130, hel1575-tabs:196, hel1584-perf:218, hel1584-surfaces:114 and :614,
  hel1573-grid-chart:305: `.panel-grid-card__handle` (real-only class, stubs have none).
- hel1094:143, hel1096:154, hel1392-burst:191, hel572:192 :234 :278, hel588:251 :254 :257 :333 :385 :522 :525 :759 :779:
  `.filter({ has: getByRole("heading", { name }) })` (stubs have no heading).
- hel1392-staleness:140 and :141, hel1573-grid-chart:172, hel1575-tabs:132 and :896, hel1575-switch:155 and :163,
  hel1584-surfaces:141 :214 :391 :518: `{ hasText }` (stubs carry no text).
- hel1398:258 and hel1656:166: `.panel-grid-card__title` (real-only; the stub has no title).
- hel1584-surfaces:420: `[data-entrance="pop"]` attribute selector (real-only).
- hel1575-switch:48: in-page loop whose resolve condition requires `[role="cell"], td` in `withData >= want` (stubs have no cells).

## OK-settled (earlier wait in the same test excluded the skeleton, no load in between)
- hel1023:236: `readRects` runs only after `openAt` (:364 `waitForPanelGrid(page, 8)`); later calls are resizes, no skeleton.
- hel1392-burst:63: probe runs after `openDashboard` (:86 `waitForPanelGrid(page, 8)`); a stub marked old is harmless.
- hel1457:42-45 and :118-121: the `.react-grid-item` count 1 (a skeleton can satisfy it, so it proves loading started) is
  followed by `Loading panels` count 0 (skeleton gone); the handle reads at :48/:130 come after. (Reads are also OK-filtered.)
- hel1573-grid-chart:396: see FIX note above (settled by :389).
- hel1584-surfaces:395 (count 4 after Duplicate): the grid stays mounted since :385's `waitForPanelGrid`, no load in between.
- hel1584-surfaces:113: `item` comes from `.panel-grid > .react-grid-item` filtered `hasText: "Metric"` (:111) after :101's wait (OK-scoped too).
- hel1584-perf:93: the in-page poller deliberately sees stubs; `hasContent` requires no `.panel-body-skeleton` and real content
  (stubs have neither) and `visible` excludes `.crossfade__skeleton` cards (:99). Only `content.cards` (:94, reported, not asserted
  on stub-sensitive terms) can include stubs. Left as is: it measures the load, so converting would remove what it measures.
- hel1444:228 :234 :239 :243 and hel1398:167 :168 :174: OK-scoped. `card` / `item` is `.react-grid-item` filtered
  `hasText: <title>` (hel1444:370/:401/:601, hel1398:159), so a stub cannot be the element read.

## OK-not-a-read
- hel1028:12, hel1230:7, hel1457:6, hel572:162 (comments); hel1584-surfaces:41, :264, :411 (`r.target.includes("panel-grid-card")`
  filter on recorded animation records).

## Follow-up candidates (not `.panel-grid-card` hits, so out of this ticket's scope; not edited)
- hel1681:330-331: `.mobile-panel-stack` count 0 at 1280 px is vacuous before mount (HEL-1692 overlap).
  (After this change :332 waits for the real grid, which makes the later `refreshButton` count 0 non-vacuous.)
- hel1681:307 `.mobile-panel-stack__item` `.first().boundingBox()` and hel1584-surfaces:110 `.panel-grid > .react-grid-item`
  reads are bare skeleton-shareable reads without a `.panel-grid-card` string.

## Verification (every run pinned `DEV_PORT=7155 BACKEND_PORT=10062`, `nice -n 19`, `--workers=2 --trace retain-on-failure`;
`grep -c "DEV_PORT is unset"` on each transcript = 0)
- `npx playwright test e2e/hel1028-layout-undo-redo-visual-revert.spec.ts e2e/hel1681-refresh-control.spec.ts --repeat-each 3`: `84 passed (3.7m)`, exit 0.
- `npx playwright test e2e/hel1573-motion-grid-chart.spec.ts e2e/hel1573-motion-primitives.spec.ts e2e/hel1584-motion-perf.spec.ts e2e/hel1584-motion-surfaces.spec.ts`:
  `1 failed, 27 passed (2.6m)`. The failure is hel1584-surfaces:496 "same-shape data refresh morphs the series" ("the chart animation
  clock ran", a poll timeout). Isolated, 4 repeats: with this change `4 passed (19.7s)`; on the unchanged base (`git stash`)
  `3 failed, 1 passed (29.7s)`. So it is a pre-existing flake of that assertion (HEL-1658 area), not caused by this change; the
  conversion in `openDashboard` (waiting out the skeleton before the refresh) did not make it worse.
