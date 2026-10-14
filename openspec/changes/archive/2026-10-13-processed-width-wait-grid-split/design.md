## Context

See proposal.md (Why). Ground truth on origin/main 9c569fc60:

- `DesktopPanelGrid.tsx` is 436 lines. It holds five concerns: title-edit state (lines 106-115, 196-247), detail-modal
  state + HEL-651 auto-close effect + card click/mousedown (99-105, 116, 134-161, 249-274), the HEL-1028 commit flag +
  drag/resize start/stop + HEL-1023/HEL-1457 `handleLayoutChange` (165-185, 276-312, 331-370), the HEL-1413
  processed-width state (314-329), and the RGL render (372-435). `useLayoutSave` (354 lines) owns I1 and
  rebase-on-409; the file header forbids calling it from anywhere but `DesktopPanelGrid.tsx` (HEL-301 hazard §4.1).
- `--panel-grid-processed-width` is read inline in exactly two specs: `hel1023-breakpoint-layout-derivation.spec.ts`
  (exact `${containerWidth}px` + `settleTransitions(page, 5_000)`; `.panel-grid` count 0 below 768) and
  `hel1392-remount-request-burst.spec.ts` `crossTo` (matches `/^\d+px$/`, i.e. ANY px value, including a stale one).
- `setViewportSize` appears in 9 specs that touch `.panel-grid`. Most set the viewport before `goto` (not a live
  resize). Live resizes after load: hel1023 `openAt`, hel1392-burst `crossTo`, hel1392-remount-staleness
  `setViewport`, hel588 breakpoint sweep (1440/1100/768/430, measures the filter indicator), hel1398 phone/320
  (phone stack only). The executor's audit (task 1.1) re-derives this list; it is not trusted as given.
- HEL-1413 evidence.md item 3 documents a deterministic red harness: an init script delaying every ResizeObserver
  callback by 900 ms reproduced the CI failure 4/4.

## Goals / Non-Goals

**Goals:** one shared, exact processed-width wait; an auditable classification of every live resize; a split that is
provably behaviour-preserving (unchanged unit tests, unchanged hook call order).

**Non-Goals:** touching `useLayoutSave.ts`/`dashboardsSlice`; product behaviour; replacing sleeps that do not gate on
RGL width; backend anything.

## Decisions

**D1 — Helper shape.** `e2e/support/gridProcessedWidth.ts` exports `waitForGridWidth(page, containerWidth, opts?)`:
below `panelGridConfig.breakpoints.sm` (768) it waits for `.panel-grid` count 0; otherwise it polls
`--panel-grid-processed-width` until it equals exactly `${containerWidth}px`, then `settleTransitions(page, 5_000)`
(skippable via `opts`). This is hel1023's existing logic lifted verbatim, so hel1023's migration is a pure refactor.
Alternative rejected: a regex/"any px" wait (hel1392-burst's current form) — it is satisfied by the PRE-resize width.
Alternative rejected: deriving the expected width inside the helper from `.panel-grid`'s CSS box — reintroduces the
very box-width read HEL-1413 removed as a gate; callers pass the expected container width (known from the layout:
container = window - sidebar, as hel1023's table records) or the helper reads it from the zoom container only as the
*expected* value, never as the gate. The executor picks one and states it; the gate is always the processed width. The helper's timeout failure message
includes the last observed processed-width value.
**hel1023's own box poll (l.255-257, `readRects(page).container.w` == `containerWidth`) stays in hel1023 (option a):**
it is retained as an assertion that the viewport resize produced the expected container width (and, below 768, the
stack width) before the readiness wait, not as the readiness gate; the readiness gate is the helper. It is a named
exemption in the AC2 grep proof. hel1023's migration is therefore semantics-identical (C1 needs same-result evidence
only).

**D2 — Which specs migrate.** A spec migrates iff it resizes the viewport after the page has loaded AND then reads
desktop-grid geometry/width or relies on the grid having re-laid-out. Pre-load viewports (`setViewportSize` before
`goto`), phone-stack-only resizes, and resizes followed only by non-grid measurements (e.g. hel588's indicator box)
are left with a recorded reason. hel1392-remount-staleness's desktop return gates on request counts, not geometry;
the audit decides it with a reason.

**D3 — Red before green for semantic changes (driver constraint).** Every spec the audit marks "migrate" other than
hel1023 is a semantic change and gets its own red probe BEFORE its edit, recorded per spec in evidence.md (old wait
under the probe: red, or the explicit statement "no red obtained" with what was observed). Likely outcome for
hel1392-burst, to be confirmed not assumed: phone->desktop mounts a fresh grid whose `processedWidth` initialises to
the mount width, so the old regex may not be racy there. hel1023's migration is semantics-identical (no
red required; evidence = same pass). hel1392-burst's change from `/^\d+px$/` to an exact width IS a semantic change:
before editing it, run it under the HEL-1413 delayed-ResizeObserver init script (or an equivalent probe that delays
RGL's width delivery) and show the old wait resolves on a stale value / the spec's post-wait assumption fails; then
show the new wait passes under the same probe. If the probe shows the old wait is NOT racy (e.g. because the
desktop grid mounts fresh with the new width on a phone->desktop cross), record that finding and keep the migration
as a refactor-with-tightening, stating plainly that no red was obtained — never claim a red that was not observed.

**D4 — Split.** Extract hooks, keep JSX and the `useLayoutSave` call in `DesktopPanelGrid.tsx`:
- `usePanelTitleEditing()` → title-edit state/refs/handlers (+ exposes a `cancel`/reset used by `handleStartEdit`).
- `usePanelDetailState(panels, panelsStatus)` → detail id/mode, HEL-651 auto-close effect, mousedown/card-click/
  `handleDetail`, delete-confirm state stays with whichever hook `handleStartEdit` needs (it clears detail + confirm).
- `useGridLayoutInteraction({...})` → HEL-1028 commit flag, drag/resize start/stop, `handleLayoutChange` (HEL-1023
  derive-vs-edit, HEL-1457 kept-items), `isDragging`. It receives `latestLayoutRef`/`markLayoutChanged`/
  `commitInteractionLayout` from the component's `useLayoutSave` call; it never imports `useLayoutSave`.
- `useProcessedWidth(width)` → HEL-1413 state + `gridStyle`.
Files live beside the component in `ui/grid/` (grid-private), each with the moved comments intact.
**Effect-order preservation (bound):** effects/cleanups run in declaration order. Today: editingTitleRef sync,
HEL-651 auto-close, commit-flag cleanup, then `useLayoutSave`'s effects; on unmount the commit-timer cleanup runs
before `useLayoutSave`'s unmount flush. So the interaction concern is split in two: `useCommitFlag()` (ref, timer,
`armCommitFlag`/`clearCommitFlag`, cleanup effect) is called BEFORE `useLayoutSave`; `useGridLayoutInteraction({...})`
is called AFTER it and receives `latestLayoutRef`, `markLayoutChanged`, `commitInteractionLayout` (already stable,
useLayoutSave.ts ~334-351) and the flag functions as plain arguments — never via refs. Call order in the component:
title hook, detail hook, `useCommitFlag`, `useLayoutSave`, `useGridLayoutInteraction`, `useProcessedWidth`.
**Order proof = recorded argument + existing test:** evidence.md lists the before/after hook and effect declaration
order with line numbers, and `PanelGrid.test.tsx`'s unmount-flush test (~696) and every DesktopPanelGrid*.test.tsx
pass unedited. No new order-specific test is required.
Alternative rejected: moving `useLayoutSave` into the interaction hook — breaks the HEL-301 "called only here" rule.

**D5 — Behaviour proof.** All existing `DesktopPanelGrid*.test.tsx`, `PanelGrid*.test.tsx`, and `useLayoutSave`-
dependent tests pass with zero edits to test files; `git diff` on `useLayoutSave.ts`/`dashboardsSlice.ts` is empty.

## Risks / Trade-offs

- [Effect reordering silently changes unmount-flush timing] → D4's bound call order, recorded before/after in
  evidence.md; the existing PanelGrid unmount-flush test (PanelGrid.test.tsx ~696) must stay green.
- [`useCallback` deps change identities, re-rendering every PanelCard] → keep handler identities stable (same deps).
- [Helper's expected width wrong under zoom/sidebar changes] → callers pass container width; helper fails loudly with
  the observed value on timeout.
- [Editing an archived change trips the OpenSpec hygiene hook] → run the hook; if it objects, record and escalate
  rather than bypass.

## Planner Notes

- Self-approved: `skip_specs: true` (no spec-level behaviour change); hooks colocated in `ui/grid/`.
- Premise drift recorded in premise-validation.md (436 not 428 lines; two inline copies already exist; most other
  specs gate on sleeps or pre-load viewports, not CSS box width) — minor-staleness, no escalation.
