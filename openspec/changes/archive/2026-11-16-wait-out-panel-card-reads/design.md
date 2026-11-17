## Context

See proposal.md - Why. Ground truth (verified 2026-11-16 on d60b1f799):

- `PanelGridSkeleton.tsx:30` is the `aria-label="Loading panels"` wrapper (`.panel-grid-shell`). Desktop widths:
  `DesktopPanelGridSkeleton` (a real react-grid-layout) whose stubs are `.react-grid-item > .panel-grid-card`
  (`PanelCardSkeleton.tsx` root, aria-hidden). Phone widths: `MobilePanelStackSkeleton`, whose stubs are
  `div.panel-grid-card.mobile-panel-stack__item` (aria-hidden).
- Classes the skeleton stubs carry: `.panel-grid-card`, `.panel-grid-card__top`, `.panel-grid-card__title-area`,
  `.panel-grid-card__body-skeleton`, `.panel-grid-card__footer` (desktop); `.panel-grid-card`,
  `.mobile-panel-stack__item`, `.mobile-panel-stack__header`, `.panel-grid-card__body-skeleton` (phone). They carry
  NO `.panel-grid-card__handle` and NO `.panel-grid-card__title`, and no text (`Skeleton` renders an empty
  aria-hidden `<span>`), so a `hasText` filter cannot match a stub. Desktop stubs are `div.panel-grid-card`, real
  desktop cards are `article.panel-grid-card` (executor: confirm the real-card element in `PanelCard`/`PanelGrid`).
- `e2e/support/panelGridReady.ts` exports `LIVE_GRID_ITEMS` + `waitForPanelGrid(page, count)` (desktop, HEL-1633) and
  `LIVE_STACK_ITEMS` + `waitForPanelStack(page, count)` (phone, HEL-1724). Each asserts the live-layer count first
  (positive anchor), then `getByLabel("Loading panels")` count 0 (skeleton unmounted).
- HEL-1644 (d60b1f799) edited `hel1575-dashboard-tabs.spec.ts` (warm-copy logout); its `.panel-grid-card` hits are
  now :132, :196, :896.
- Current grep: `git grep -n "panel-grid-card" HEAD -- e2e` = 72 hits in 20 files (HEL-1633's 73 minus one
  hel1573-motion-grid-chart line that HEL-1633 itself removed). No hit in `hel1685-draft-polish.spec.ts`.

## Goals / Non-Goals

**Goals:** every current `.panel-grid-card` hit has a fixed-or-justified verdict with a line reference; every
skeleton-satisfiable read is converted using the existing helpers; hel1028:310 asserts 0 only after a mounted state,
with a recorded red mutation.

**Non-Goals:** product code; new helpers that duplicate `waitForPanelGrid`/`waitForPanelStack`; editing hel1685;
editing hel1681 beyond :332/:343; fixing unrelated flakes.

## Decisions

**D1. Reuse, never duplicate.** Conversions call `waitForPanelGrid`/`waitForPanelStack` or scope reads with
`LIVE_GRID_ITEMS`/`LIVE_STACK_ITEMS`. If a spec needs "real card N is up" without knowing the total count, prefer
scoping the read to the live layer (e.g. `page.locator(LIVE_GRID_ITEMS).locator(".panel-grid-card")` or
`page.locator(".crossfade__layer:not(.crossfade__skeleton) .panel-grid-card")`) over inventing a new wait. A new export
in `panelGridReady.ts` is allowed only if three or more call sites would otherwise inline the same selector, and must
then sit next to the existing ones with a doc comment.

**D2. Per-hit classification (each hit gets exactly one verdict and a line reference).** Sweep command:
`git grep -n "panel-grid-card" HEAD -- e2e` re-run on the branch base AND after the change (both counts recorded).
- FIX - a bare `.panel-grid-card` count / `.first()` / `.nth()` / box / `evaluate`/`querySelectorAll` read reached
  after a navigation, reload, viewport change or dashboard switch, with no earlier wait in the same test that already
  excludes the skeleton. Includes reads scoped only by a skeleton-shared ancestor (`.panel-grid-shell`,
  `.mobile-panel-stack`, `.react-grid-item` without the live-layer prefix).
- OK-filtered - filtered by panel content only real cards carry: `hasText`, a title, a `data-*` attribute, or a
  real-card-only class (`__handle`, `__title`). Cite the filter. A filter on a skeleton-shared class (`__top`,
  `__footer`, `__title-area`, `__body-skeleton`, `.mobile-panel-stack__item`) is NOT OK-filtered.
- OK-settled - an earlier wait in the same test (cite its line) already excluded the skeleton (a live-layer count,
  `waitForPanelGrid`/`waitForPanelStack`, or a `Loading panels` count 0 that follows a positive real-content anchor)
  and no load happened between that wait and the read.
- OK-not-a-read - a comment, or a string used in a filter on recorded animation records (e.g. `r.target.includes`),
  not a DOM read.
- OK-scoped - the locator is already scoped inside a real-only element (an `item` that came from `LIVE_GRID_ITEMS`,
  an article located by `hasText`). Cite where `item` comes from.
A verdict that is a category name with no line reference does not count. A `Loading panels` count 0 that is NOT
preceded by ANY mounted-state anchor is vacuous and does not make a read OK-settled. Consistent with HEL-1633's sweep
(archive sweep.md:111, hel1028 `openDashboard`): an anchor the skeleton itself can satisfy (e.g. a bare
`.react-grid-item` count) followed by `Loading panels` count 0 DOES qualify, because a mounted skeleton proves loading
started, so the later count 0 means the skeleton has unmounted rather than not yet mounted. Cite both lines.

**D3. hel1028:310 (xs test).** After `goto`, call `waitForPanelStack(page, <seeded panel count>)` (the seed loop at :39
creates 2 panels, so `waitForPanelStack(page, 2)`), then keep the two count-0 assertions. Red-first proof: a mutation in the
product phone stack (e.g. add a `<span className="panel-grid-card__handle" />` to each real
`MobilePanelStack` card) that the OLD spec passes vacuously-or-not and the NEW spec fails. Record both runs: the new
spec under the mutation must be RED, failing on the handle count assertion with a NONZERO received count (e.g.
"Received: 2"), which is the evidence that this lane's dev server actually served the mutated module (constraint C2);
a failure inside the wait, or a received count of 0, does not qualify. The new spec without the mutation must be
GREEN. Also record the old spec under the same mutation; if it is green that is the vacuity demonstrated, if
it is red say so plainly (the proof required by the AC is only that the new assertion can fail). The mutation is
reverted before commit (`git diff` shows no product change). Transcripts go in `mutation-hel1028.md` in this change.

**D4. hel1681 :332/:343 minimal.** Both hits are in 1280 px (desktop) tests. Replace each bare `.first()` visible read
with a live-layer scoped read (`LIVE_GRID_ITEMS`) or `waitForPanelGrid`; no phone helper applies. The vacuous
`.mobile-panel-stack` count 0 at :330-331 is not a `.panel-grid-card` hit and is left as is (HEL-1692 overlap); it is
listed in the sweep record as a follow-up candidate. No other line in hel1681 changes. The PR body
names this file as an overlap risk with lane HEL-1692.

**D5. Verification runs (constraint C1).** Servers via `scripts/concertino/start-servers.sh` on this lane's ports
(DEV_PORT 7155, BACKEND_PORT 10062, from workflow-state.md). Every Playwright invocation is pinned to them:
`DEV_PORT=7155 BACKEND_PORT=10062 nice -n 19 npx playwright test <files> --workers=2 --trace retain-on-failure`.
Without `DEV_PORT`, `playwright.config.ts:8` falls back to `localhost:5173` (another checkout's server, CON-165), so
an unpinned run, including every run of the D3 mutation proof, is not evidence. Each recorded transcript (in
`sweep.md` and `mutation-hel1028.md`) shows the command line and shows that the `[playwright.config] DEV_PORT is
unset` warning is absent. Every edited spec file runs once, plus `--repeat-each 3` for hel1028 and hel1681.
Pass/fail summary lines go into the sweep record. No e2e flock lock exists; none is used.

## Risks / Trade-offs

- [A conversion changes what a test asserts] -> conversions only add a wait or a live-layer prefix; the asserted
  value/condition is unchanged. Any spec where that is not enough is reported, not rewritten.
- [hel1681 merge conflict with HEL-1692] -> two-line edit, named in the PR.
- [Phone vs desktop helper mismatch times out] -> each conversion uses the helper matching the test's viewport;
  every converted spec is run.
- [Fade-observing motion specs (hel1584, hel1573) intentionally read during the crossfade] -> such reads are
  classified with the reason (e.g. OK-scoped / justified as intentional), not converted blindly. A conversion there
  must not remove the timing window the test measures.

## Planner Notes

- Self-approved: test-only, no new dependency, no API change, `skip_specs: true`.
