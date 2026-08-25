## 1. Reproduction (must happen before any fix)

- [x] 1.1 Reproduce the crash on unmodified `main` via a real interaction path (open a panel's detail
      modal, delete that panel via `PanelCard`'s own inline delete-confirm), and capture the actual
      console error / stack trace / `ErrorBoundary` state as evidence.
- [x] 1.2 Widen the trigger search: probe and record the outcome (crash / no crash) for each of —
      deleting the panel from a different surface while the modal is open; the panel being deleted by
      another actor (a second tab, an MCP/agent apply, a proposal apply) while the modal is open; the
      parent dashboard being deleted with the modal open; the panel's bound DataType or pipeline being
      deleted while the modal is open. **Recorded durably in `trigger-path-probe.md`** (added cycle 2,
      per the final-gate skeptic's `skeptic-final-1.md` change request 1 — cycle 1 checked this box
      without a surviving artifact; all four outcomes are now on disk with live evidence.)

## 2. Frontend

- [x] 2.1 In `frontend/src/features/panels/ui/grid/DesktopPanelGrid.tsx`, replace the non-null-asserted
      `panels.find((p) => p.id === detailPanelId)!` panel lookup with a derived `detailPanel` value
      (`Panel | undefined`). Render the modal only when `detailPanel` is defined (unconditional render
      guard). Add a `useEffect`, keyed on `[detailPanelId, detailPanel, panelsStatus]`, that calls
      `setDetailPanelId(null)` only when `detailPanelId !== null`, `detailPanel === undefined`, AND
      `panelsStatus === "succeeded"` (read `panelsSlice`'s `status` alongside `items`) — this excludes a
      transient `fetchPanels` "loading"/"failed" window (`panelsSlice.ts:149-152` empties `items` on
      `rejected`) from clearing `detailPanelId` during that window, so the modal is not permanently
      dismissed by a transient failure (it reopens once the panel is confirmed still present after a
      successful reload). This does NOT preserve unsaved edit-mode state — the unconditional render
      guard unmounts `PanelDetailModal` (destroying its local `useState`) regardless of this gate.
      Per `design.md`'s corrected Decision (design-gate round 2).
- [x] 2.2 If the widened trigger search (1.2) surfaces a crash outside this guard's coverage (e.g. a
      different code path for DataType/pipeline deletion), fix that path too if it shares this same
      root cause, or report it explicitly as out-of-scope/follow-up if it does not.

## 3. Tests

- [x] 3.1 **Primary, gated regression coverage — Jest.** Add a component test on `DesktopPanelGrid`
      (in the existing Jest suite, run by the `npm test` gate and CI — NOT Playwright, which no gate or
      CI workflow executes): render with the detail modal open and `panelsStatus: "succeeded"`, then
      re-render with the backing panel removed from `panels`; assert the modal unmounts, `detailPanelId`
      resets, and nothing throws. Demonstrate this test RED against the pre-fix `!` lookup, then GREEN
      after 2.1.
- [x] 3.2 **Live crash capture — Playwright, evidence only, not the regression gate.** Exercise the
      real interaction path from 1.1 (open detail modal, delete that panel from `PanelCard`'s own
      delete-confirm) against the pre-fix code and capture the actual console error / stack trace /
      `ErrorBoundary` state. Re-run the same script after the fix and confirm it is GREEN (modal closes,
      no console error, dashboard remains interactive). This satisfies the ticket's "capture the crash
      as evidence" AC; `3.1`'s Jest test is what actually gates regressions. **Evidence note (cycle
      2):** the pre-fix/post-fix console output and screenshots described in the executor's cycle-1
      report were captured live but no static log file was persisted to the change dir. Per
      `skeptic-final-1.md` change request 4, this is NOT being redone — the skeptic's own independent
      pre-fix Jest run (mutating `DesktopPanelGrid.tsx` back to `git show main:...` and re-running
      `DesktopPanelGrid.test.tsx`) reproduces the exact same `TypeError` mechanically and more strongly
      satisfies this AC's substance than a static screenshot log would.
- [x] 3.3 Add coverage for the widened trigger paths from 1.2 that are in scope for this guard, per
      `design.md`'s "Executor/Test simulation for cross-actor removal" section:
      - Jest: simulate the *result* of an external/cross-actor removal (panel absent from `panels`,
        `panelsStatus: "succeeded"`) — same shape as 3.1, covers "another actor deleted it" generically
        regardless of cause, since a literal two-tab script is not reachable (`panelsSlice.items` is
        only replaced by `fetchPanels.fulfilled`, dispatched on dashboard (re)selection — no live sync;
        `panel-polling` covers panel data only, not the panel list).
      - Playwright (supplementary): delete the panel via the API directly (out-of-band, simulating
        another actor), then trigger a same-tab action that re-dispatches `fetchPanels` (e.g. dashboard
        re-selection) while the modal is open — assert the modal closes with no console error.
      - Jest, explicit non-crash + recovery case (revised — design-gate round 2, observable assertions
        only; the render guard unmounts the modal during a transient window, it does not render it
        "blank", so a DOM-level "still present" assertion is not valid — see `design.md`'s corrected
        Decision): render with the modal open and the panel present (`panelsStatus: "succeeded"`),
        re-render with `panelsStatus: "loading"` and the panel absent from `panels` (nothing throws, no
        error boundary trips), then re-render with `panelsStatus: "failed"` and the panel still absent
        (still nothing throws), then re-render with `panelsStatus: "succeeded"` and the panel **present
        again** — assert the modal is shown again for that panel. This demonstrates the effect did NOT
        fire (and clear `detailPanelId`) during the transient "loading"/"failed" window — the modal's
        reappearance once the panel is confirmed present is the observable proxy for that, since
        `detailPanelId` itself has no test-visible surface — while also proving the transient window
        itself never crashes.
