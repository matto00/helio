## Context

See proposal.md - Why. `frontend/src/features/panels/ui/form/FormPanelView.tsx` (481 lines) holds the schema fetch,
the compact counter's burst/reconcile machinery (`handleImmediateStep` + `reconciliationTail`, ~130 lines), the
multi-field `handleSubmit`, and three render branches. At lines 225-228 a non-owner's quiesced burst calls only
`onReconcileFailed`; `onReconciled` (HEL-1819's clear, gated on `burstRejectedRef`) is reachable only on the owner's
aggregate-fetch path. The grid minimum is one `panelGridConfig.itemHeights.min = 4` for every kind
(`panelGridConfig.ts:91-118`), while the backend auto-layout packer already clamps `form` to `minH = 5`
(`backend/.../panels/PanelPacker.scala:44`, spec `form-panel-rendering` "A form panel is sized for a grid cell").

## Goals / Non-Goals

**Goals:** behaviour-preserving split; non-owner stale-error clear; live before/after measurement; owner-chosen fit fix.
**Non-Goals:** owner reconcile semantics, HEL-1818 rendering, backend changes, mobile stack sizing.

## Decisions

### D1 — Split shape (commit 1, no behaviour change)
Extract the compact counter's immediate-step machinery into a hook `useCompactCounterSubmit` (owns
`pendingDeltasRef`, `reconcileGenerationRef`, `burstRejectedRef`, `pendingCount`, returns `{ step, busy }`; inputs
include but are not limited to `schema`, `config`, `panelId`, `isFormOwner`, `values`, the alert/status setters and
`pushDenialToastIfAny`), and the two render branches into
`CompactCounterFormBody` / `MultiFieldFormBody` presentational components. `FormPanelView` keeps the schema fetch,
shared alert/status state, `handleSubmit` and branch selection. Exact boundaries are the executor's call provided
every file ends under ~400 lines, all comments that carry design rationale move with their code, and the DOM output
is identical. Alternative (move only render branches) rejected: leaves the 130-line async handler, the real bulk.
Proof set (derived with `grep -lE "kind: *['\"]form['\"]|type: *['\"]form['\"]|panelType: *['\"]form['\"]|
createFormPanel|\"form\"" e2e/*.spec.ts` and `grep -rlE "ui/form/|\.\./form/" frontend/src --include=*.test.ts*` plus
`ls frontend/src/features/panels/ui/form/*.test.*`; `hel1756-popover-viewport-fit` matched only `form.popover__panel`
and is excluded after the executor confirms it creates no form panel). Jest: `ui/form/FormPanelView.test.tsx`,
`ui/form/FormPanelView.nonOwner.test.tsx`, `ui/form/FormFieldControl.test.tsx`, `ui/form/useFormPanelValues.test.ts`,
`ui/form/CounterControl.css.test.ts`, `ui/form/FormPanel.css.test.ts`, `ui/renderers/FormRenderer.roles.test.tsx`,
`ui/PanelContent.test.tsx`, `PanelCardHeader.refreshFullscreen.test.tsx` (both render the real view via `FormRenderer`).
E2E: `hel1085-form-field-renderers-keyboard`, `hel1087-form-submit-path`, `hel1088-compact-counter-chrome`,
`hel1090-form-panel-assembled-a11y`, `hel1094-sse-fan-out-panel-refresh`, `hel1095-optimistic-pending-writing-panel-a11y`,
`hel1096-run-to-update-affordance`, `hel1169-network-vs-rejection-reconcile-a11y`, `hel1784-editor-form-submit`,
`hel1791-compact-counter-stack-height`, `hel1818-compact-counter-single-error`, `hel1819-form-live-region-gap`.
Pass/fail/skip counts recorded and committed before the split and equal after. No test file is edited in the split commit.

### D2 — Non-owner clear signal
The non-owner path has no authoritative read (HEL-1784 forbids the aggregate), so its only signal is "this burst
quiesced and no definite rejection settled within it" — exactly the `burstRejectedRef` guard HEL-1819 uses. On the
non-owner quiesce branch, call the same clear the owner's `onReconciled` makes (`if (!burstRejectedRef.current)
values.setExternalErrors({})`), alongside the existing `onReconcileFailed` announcement. Implemented by passing a
second callback for the non-owner branch rather than reusing `onReconciled` (which means "a fetched total was
applied" and must stay owner-only). Alternative "a reconcile the editor is allowed to make" rejected: no editor-
readable aggregate exists; adding one is a backend/API change out of scope. Clearing is safe: the earlier rejected
step was already rolled back, so its error describes no current state. Owner/non-owner asymmetry (deliberate): an owner whose reconcile fetch fails KEEPS the stale error (HEL-1819 ruling)
because a successful fetch is still possible on the owner's next burst, so the error is cleared by real evidence
later; a non-owner can never reconcile, so under that rule the error could never clear except by a success, which is
the defect the owner asked to fix ("whatever signal that path has"). The non-owner's signal is the burst settling
with no rejection in it; the indeterminate step is still announced as unconfirmed in the alert region. The spec delta
MODIFIES the rollback requirement's "cleared only by" sentence and scopes HEL-1819's requirement to the owner.
Red first: a test in
`FormPanelView.nonOwner.test.tsx` (reject, then no-response; assert `aria-invalid` absent), committed failing.
Mutation: removing the clear turns the red-first test red; dropping the `burstRejectedRef` guard turns the same-burst
test red. The same-burst test passes today, so it is labelled a GUARD (failable by that mutation), and it must make the
indeterminate step settle AFTER the rejection, or the guard mutation proves nothing.

### D3 — Minimum-height fit: owner ruling (2026-11-23, recorded via `concertino answer`, channel chat)
Owner chose `min-height-5-rows`: on the desktop grid a form panel cannot be placed or resized below 5 rows at every
breakpoint the grid minimum applies to (lg/md/sm/xs in `createLayouts`), matching `PanelPacker`'s `Form minH = 5`. A
compact counter (exactly one field, `control: "counter"`) keeps the global 4-row minimum: it fits (0 px hidden). A
form already saved below 5 rows stays as saved: nothing bumps it or writes the layout on load; the minimum applies
on the next resize or placement. Width minimums are unchanged. Live measurement (task 3, `measurements.md`): at
1280 px (sm, 6 cols) a 4-row 2-field form hides 21 px; 3-field 88 px; 1-field and compact counter 0.

### D4 — How the 5-row minimum is enforced
- A pure helper `formPanelMinRows(panel)` (or equivalent) in `ui/grid/` returns 5 for a `form` panel that is not a
  compact counter, else `panelGridConfig.itemHeights.min`; one named constant `FORM_MIN_ROWS = 5`. `createLayouts`
  takes a per-panel min-height lookup (`DesktopPanelGrid.tsx:133` passes it from its panels; `DesktopPanelGridSkeleton.tsx:50` holds
  stub panels with no kind, passes none and gets the default 4, harmless as drag/resize are disabled there); the global constant stays for every other kind.
- Enforcement (owner ruling 2 of 2026-11-23, `lift-when-free`, recorded via `concertino answer`): a form panel
  (not a compact counter) whose stored h >= 5 gets `minH = FORM_MIN_ROWS` (5, strict; RGL clamps during the drag). A
  form whose stored h < 5 gets `minH = panelGridConfig.itemHeights.min` (4) — exactly today's minimum, so it resizes
  as today and RGL never clamps it to 5 or collision-reverts it. Unit case: stored h=3 form gets minH 4.
- Lift (where): applied to `next` inside `handleLayoutChange`'s committed branch, BEFORE `markLayoutChanged` and
  `commitInteractionLayout`, so the lift and the resize are ONE store write equal to `localCommitRef` (a second write
  after the commit would be classed as an external change by `useLayoutSave`, re-baselining `persistedLayoutRef`
  and silently dropping the save). The resized item's id comes from `onResizeStop`'s `newItem.i` (held in a ref for
  the committing `onLayoutChange`), never inferred. Rule: if that item is a non-counter form whose final h < 5, set
  h = 5 only when a pure helper `isSpaceBelowFree(layout, item, rows)` reports every cell in columns x..x+w-1, rows
  y+h..y+4 free of other items at that breakpoint; else keep the final h. No other panel moves. A resize that ends
  where it started fires no `onLayoutChange`, so nothing lifts — accepted. Nothing changes on load.
- Probe (guard): a jest test mounts a saved 4-row form and asserts neither the rendered h nor the pending flag changes.
- Placement: the executor enumerates every path that places a panel on the desktop grid (create, duplicate, import,
  template/first-run, auto-layout, assistant/proposal apply), records each path's form height in `measurements.md`,
  and fixes any frontend path that can place a form below 5 rows. A backend path that does so is reported, not
  silently changed (scope check with the orchestrator).
- `DesktopPanelGrid.tsx:141` short-card rhythm (`h <= itemHeights.min`) is unchanged: a saved 4-row form keeps it.
- Proof: unit tests for the helper and `createLayouts` (form 5, compact counter 4, others 4); a Playwright resize
  test that drags a multi-field form's handle up and asserts it stops at 5 rows, a compact counter still reaches 4, a saved 4-row form with free space
  below ends at 5 after a width-only resize AND the persisted layout (Save-now PATCH body or reload) has h=5, the same
  form with a panel directly below resizes in width and the persisted layout has it at h=4 with the new w and the
  neighbour unchanged; `isSpaceBelowFree` unit tests (free, one-column overlap, blocked at row y+4, bottom edge),
  and a saved 4-row form renders at 4 and the layout is not marked pending on load. That no-bump test passes on today's code, so
  it is a GUARD, failable by the mutation `createLayouts` emitting `h: Math.max(item.h, minH)` for forms. Red first
  with mutations (min back to 4 turns the resize test red; dropping the compact-counter exception turns the counter
  test red; the `Math.max` mutation turns the no-bump guard red; lifting without the free-cell check turns the
  blocked-neighbour test red; removing the lift turns the free-space lift test red;
  dispatching the lift as a separate store write after the commit turns the persisted-h assertion red while the
  rendered-h assertion stays green).
- After: re-measure live at 1280 px, light and dark, Comfortable and Compact, the same panels at their new minimum
  (form 5 rows, counter 4), plus a saved 4-row form; before/after table in `measurements.md`. A 3-field form still
  scrolls 48 px (Comfortable) / 44 px (Compact) at 5 rows, measured (not the ~24 px first predicted as 88 - 64: the extra row adds 64 px of card but only 40 px of scroller, because the short-card rhythm that tightens a 4-row card is dropped at 5 rows); within the AC (two fields), stated in the table, not a regression.

## Risks / Trade-offs

- [Split silently changes render order or effect timing] → identical DOM checked by unchanged tests + equal counts.
- [Non-owner clear hides a real error] → only an earlier burst's error; a current-burst rejection keeps it (D2 test).
- [Measurements drift with density] → measure Comfortable (default) and note Compact for the 2-field case.

## Planner Notes

- Self-approved: D1 hook/component split shape; D2 signal (owner delegated "whatever signal that path has").
- D3 option and the no-bump rule are the owner's rulings; D4 mechanics are self-approved.
