## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Re-derived from code, not from the round-1 report or the revision narrative.

- **CR1 (gated regression test) — SATISFIED.** `tasks.md` 3.1 now mandates a Jest component test
  on `DesktopPanelGrid` as the primary gated coverage, RED-before/GREEN-after, and explicitly
  demotes Playwright (3.2) to evidence-only. `concertino.config.json` gates include `npm test`;
  sibling Jest suites `frontend/src/features/panels/ui/grid/PanelGrid.test.tsx` and
  `MobilePanelStack.test.tsx` exist, so the test is feasible where planned. `design.md`'s Risks
  section was corrected to match.
- **CR2 (cross-actor premise) — SATISFIED.** `design.md`'s new accepted-risk bullet and the
  "Executor/Test simulation for cross-actor removal" subsection state the real data flow
  (`panelsSlice.ts:144` `fetchPanels.fulfilled` is the only `items` replacement for this path;
  dispatched from `PanelList.tsx` on dashboard (re)selection) and replace the unreachable literal
  two-tab script with (a) a Jest simulation of the *result* and (b) a same-tab
  `fetchPanels`-retriggering Playwright probe. `tasks.md` 3.3 matches. Verified against the slice:
  `fetchPanels.fulfilled` (:144-148) and `duplicateDashboard`/`importDashboard.fulfilled`
  (:~222-233) are the only full-list replacements; `deletePanel.fulfilled` (:167-169) filters
  `items` and does **not** touch `status`.
- **`panelsStatus` gate is real and correctly typed.** `panelsSlice.ts:34` —
  `status: "idle" | "loading" | "succeeded" | "failed"`. `fetchPanels.rejected` (:149-152) does set
  `items = []` and `status = "failed"`, exactly as the design claims. After a normal load status is
  `"succeeded"` and `deletePanel.fulfilled` leaves it there, so the literal ticket repro path does
  reach the gated effect. The gate is implementable and does not break the primary case.
- **Crash site unchanged.** `DesktopPanelGrid.tsx:302-312` still renders under a bare
  `{detailPanelId !== null ? ...}` with `panels.find(...)!`. The derived-`detailPanel` +
  unconditional render guard remains the right fix.
- **CR3 (transient-failure auto-close) — NOT satisfied as written.** See Change Request 1: the
  status gate was added, but the rationale the revision rests on is contradicted by the code, and
  the derived spec scenario / task assertion are consequently not implementable as stated.

### Verdict: REFUTE

Two of three round-1 change requests are genuinely satisfied. CR3's fix is half-right: gating the
*effect* on `panelsStatus === "succeeded"` is a fine decision, but `design.md` justifies it with a
claim about the code that is false, and `tasks.md` 3.3 / the new spec scenario encode that false
claim as an assertion an executor cannot make pass. This must be corrected before execution, or the
executor will either write a test that fails for the right reason and then "fix" it wrongly, or
weaken it into a vacuous assertion.

### Change Requests

1. **`design.md` Decisions + Risks — "the modal reappears with no data loss" is false; the render
   guard unmounts the modal and destroys the unsaved edit state the status gate was added to
   protect.** `design.md`'s Decision says: *"during a transient 'loading'/'failed' window the
   modal's `detailPanel` is `undefined` so the render guard prevents rendering it ... `detailPanelId`
   is left untouched ... once the list reloads successfully, if the panel is back, `detailPanel`
   resolves again and the modal reappears with no data loss"*, and the Risk bullet says only that
   the modal "will render blank". Both are wrong about the mechanism. The render guard is
   `{detailPanel ? <PanelDetailModal .../> : null}` — that **unmounts** the modal, it does not
   render it blank. Every piece of edit-mode state lives in `PanelDetailModal`'s own local
   `useState` (`PanelDetailModal.tsx:81,97-101,126-127,132`: `modalMode`, `title`, `background`,
   `color`, `transparency`, `chartAppearance`, `subtypeDirty`, `showDiscardWarning`), and the modal
   is additionally `key`ed by `detailPanelId` (`DesktopPanelGrid.tsx:307`), so on remount every
   field re-seeds from `initial*`. A transient `fetchPanels.rejected` therefore discards unsaved
   edits **regardless of the status gate** — the gate buys "the modal comes back" but not "with the
   user's edits". Revise the Decision and Risk text to state what the gate actually achieves
   (`detailPanelId` is not cleared, so the modal reopens after recovery, and the app never crashes)
   and to record honestly that unsaved edit-mode state is lost on any transient empty-`items`
   window because the render guard unmounts. If preserving those edits is desired, that is a
   different (larger) design and should be explicitly declared out of scope here rather than
   implied to be already handled.

2. **`tasks.md` 3.3 (third bullet) — "assert the modal does NOT force-close" is not observable and,
   read literally at the DOM level, is false.** As written the executor must, with
   `panelsStatus: "loading" | "failed"` and the panel absent, *"assert the modal does NOT
   force-close ... and `detailPanelId` is left untouched"*. With the unconditional render guard the
   modal **is** absent from the DOM in that state, so a DOM-level "modal still present" assertion
   cannot pass; and `detailPanelId` is `DesktopPanelGrid`-local `useState` with no test-visible
   surface, so "left untouched" cannot be asserted directly either. Restate the task with the
   assertion the executor can actually make: with `panelsStatus: "loading"/"failed"` and the panel
   absent, (a) nothing throws and no error boundary trips, and (b) after a subsequent re-render with
   `panelsStatus: "succeeded"` and the panel **present again**, the modal is rendered again — which
   is exactly the observable consequence of `detailPanelId` having survived, and which would fail if
   the effect were ungated. That gives a genuinely RED-able test of the gate instead of an
   unobservable one.

3. **`specs/panel-detail-modal/spec.md` — the transient-failure scenario's THEN clause encodes the
   same unobservable/misleading claim.** Scenario *"Modal does not crash or force-close during a
   transient panels-list refetch failure"* asserts *"the modal is not force-closed during that
   transient state"*, while the requirement text above it simultaneously says the modal *"SHALL NOT
   render with an undefined backing panel at any time, including during a transient panels-list
   loading or failed-refetch state"* — i.e. the spec requires the modal to be both not-rendered and
   not-closed in the same state, which reads as a contradiction to anyone implementing or verifying
   it. Rewrite the scenario in terms of the observable recovery behavior, e.g. THEN no error is
   thrown, AND the modal is not permanently dismissed — WHEN the panels list subsequently loads
   successfully with the panel still present, THEN the modal is shown again. Adjust the requirement
   prose to distinguish "not rendered while the backing panel is unresolvable" from "not
   permanently closed".

### Non-blocking notes

- Round 1's prose/snippet keying inconsistency is resolved (`tasks.md` 2.1 and the `design.md`
  snippet both use `[detailPanelId, detailPanel, panelsStatus]`).
- `DesktopPanelGrid.tsx` currently imports only `useAppDispatch` from `hooks/reduxHooks`; reading
  `panelsStatus` adds the component's first `useAppSelector`. Harmless, but 3.1/3.3's Jest tests now
  require a store-providing render (the existing `PanelGrid.test.tsx` harness should cover this) —
  worth the executor confirming before writing the RED test.
- Uncovered edge (informational, not blocking): `markDashboardPanelsStale` sets `status = "idle"`
  **without** clearing `items` (`panelsSlice.ts:112-120`). A panel removal observed while status is
  `"idle"` will not fire the gated effect, so `detailPanelId` stays stale until the next successful
  fetch. No crash (render guard covers it), and the modal is not visible, so this is state hygiene
  only — but the design's Decision text implies `"succeeded"` is the only non-transient state, which
  `"idle"` quietly is not.
- `tasks.md` 3.1's "assert `detailPanelId` resets" has the same observability caveat as CR2; the
  modal unmounting is the practical proxy and is sufficient there, so this is a wording nit rather
  than a defect in the deletion case.
