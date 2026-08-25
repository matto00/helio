## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read all planning artifacts: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/panel-detail-modal/spec.md`, `workflow-state.md`.
- **Crash site is real and as described.** `frontend/src/features/panels/ui/grid/DesktopPanelGrid.tsx:302-312`
  still renders `panel={panels.find((p) => p.id === detailPanelId)!}` under a bare
  `{detailPanelId !== null ? ... }`. `frontend/src/features/panels/hooks/usePanelData.ts:37-39`
  dereferences `state.panels.paginationState[panel.id]` unconditionally. The proposed
  derived-`detailPanel` + render-guard shape is a correct fix for that call site.
- **Mobile sibling already implements the proposed shape.** `MobilePanelStack.tsx:71` derives
  `detailPanel` and `:128` renders `{detailPanel ? <PanelDetailModal .../> : null}` with no `!`.
  So the design's chosen pattern matches existing in-repo precedent (good), and mobile is not
  a second crash site.
- **Discard-confirm interaction checked.** `PanelDetailModal.tsx:183-190, 396-408` funnel all
  ordinary closes through `attemptClose` (unsaved-changes discard banner). The proposed guard
  unmounts the modal directly, bypassing that banner. I consider this correct (the panel is gone,
  nothing to save) — design's Non-Goals reason about it explicitly.
- **Panels-list refresh mechanism checked (this is where the plan breaks).**
  `panelsSlice.ts` only replaces `state.items` on `fetchPanels.fulfilled` (:144),
  and `fetchPanels` is dispatched from `PanelList.tsx:377` on dashboard selection —
  there is no websocket/live sync and `panel-polling` (`openspec/specs/panel-polling/spec.md`)
  polls **panel data only**, never the panel list.
- **`fetchPanels.rejected` empties the list.** `panelsSlice.ts:149-152` sets `state.items = []`
  on a *failed* refetch, and `PanelList.tsx:427-435` still renders `PanelGrid` in the non-skeleton
  branch. The proposed guard cannot distinguish "panel deleted" from "refetch failed".
- **Test harness checked.** Playwright exists (`playwright.config.ts`, `e2e/`), but
  `concertino.config.json → gates` runs `npm test` (Jest) only, and `grep -rn "e2e\|playwright"
  .github/workflows/*.yml` returns nothing — no gate and no CI job executes `e2e/`.
  Jest component tests for these grids do exist (`MobilePanelStack.test.tsx`, `PanelGrid.test.tsx`),
  so a gated regression test is straightforwardly feasible.
- Note (non-blocking, environmental): this worktree's `scripts/concertino/` predates
  `next-report-number.sh`/`persist-evidence.sh`; I used the main-repo copies with absolute paths.

### Verdict: REFUTE

The core fix shape (derive `Panel | undefined`, render-guard, drop the `!`) is sound and I would
confirm it on its own. What fails the gate is everything around it: the regression test as planned
is not executed by any gate, one of the mandated trigger paths rests on a premise contradicted by
the code, and the guard has an unconsidered false-positive.

### Change Requests

1. **`tasks.md` §3 — the regression test must live in a gated suite.** As written (3.1–3.3),
   the only regression test is Playwright, which no gate (`concertino.config.json` gates =
   lint/format/`npm test`/build) and no CI workflow runs; it also requires live dev+backend
   servers. That makes `design.md`'s own risk mitigation ("any regression at any layer fails the
   test") false in practice. Revise §3 to require a **Jest component test on `DesktopPanelGrid`**
   as the durable regression test — render with the modal open, re-render with the backing panel
   removed from `panels`, assert the modal unmounts and nothing throws, and demonstrate it RED
   against the pre-fix `!` lookup. A Playwright test may remain as *additional* live evidence for
   the ticket's "capture the crash" AC, but must not be the only regression coverage.

2. **`tasks.md` 1.2 / 3.3 and `design.md` — the "second tab / MCP apply / proposal apply" premise
   is contradicted by the code and must be restated before the executor tries to script it.**
   `state.items` is only replaced by `fetchPanels.fulfilled`, dispatched from `PanelList.tsx:377`
   on dashboard selection; there is no live sync and `panel-polling` covers panel *data* only.
   A literal two-tab Playwright test (delete in tab B, expect tab A to react) therefore cannot pass
   or fail meaningfully — tab A never learns about the deletion while the modal stays mounted.
   Revise to: (a) state in `design.md` that the guard is driven purely by the `panels` prop and is
   therefore correct for *whatever* updates it, and (b) specify the concrete, reachable simulation
   the executor must use — a store/component-level removal of the panel from `panels` (Jest), plus
   an in-browser probe of a same-tab refetch path (e.g. dashboard re-selection / post-apply
   refetch) — instead of an unreachable cross-tab script. Keep 1.2's probe-and-report of the other
   paths as-is.

3. **`design.md` Decisions / Risks — the guard silently auto-closes the modal on a *failed* panel
   refetch, not just a deletion.** `panelsSlice.ts:149-152` sets `items = []` on
   `fetchPanels.rejected`, and `PanelList.tsx:427-435` keeps rendering `PanelGrid` in that branch,
   so a transient network failure while the modal is open would evaluate `detailPanel === undefined`
   and close the modal (discarding any unsaved edit-mode state, with no user feedback). Either gate
   the auto-close on the panels list actually being in a loaded state (e.g. do not fire while
   `status === "loading" | "failed"`), or record the trade-off explicitly as an accepted risk with
   the reasoning. It must not be an unexamined side effect — the render guard alone is enough to
   prevent the crash, so the *effect* is the piece that needs this decision.

### Non-blocking notes

- `design.md` prose says the effect is "keyed on `[detailPanelId, panels]`" while its own snippet
  uses `[detailPanelId, detailPanel]`. Harmless (derived value), but worth making consistent.
- The spec delta's requirement text asserts the behavior holds "regardless of which mode (view or
  edit) the modal was in", but neither scenario exercises edit mode with unsaved changes — the case
  that bypasses `PanelDetailModal`'s discard-confirm banner (`PanelDetailModal.tsx:396-408`).
  Consider a third scenario so the strongest clause in the requirement is actually testable.
- `MobilePanelStack.tsx:71` already satisfies the new spec requirement at the DOM level but never
  clears `detailPanelId` (the "state hygiene" argument `design.md` uses to justify the effect on
  desktop). Not a bug and not in this ticket's traced root cause; just be aware the two grids will
  differ, and say so rather than opportunistically editing mobile.
