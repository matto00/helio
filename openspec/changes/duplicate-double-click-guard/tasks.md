### Frontend

- [x] 1.1 Add `frontend/src/hooks/useInFlightGuard.ts` implementing `useInFlightGuard<K>()`
      with a `useRef<Set<K>>` synchronous guard mirrored into `useState` for rendering,
      exposing `isPending(key)` and `guardedRun(key, fn)` per design.md Decision 1
      (including the `.catch(() => {}).finally(...)` cleanup contract).
- [x] 1.2 `PanelCard.tsx`: change `handleDuplicate` to return the dispatch promise
      (drop the `void` operator) and wrap it in `guardedRun(panel.id, ...)`; pass
      `disabled: isPending(panel.id)` into the "Duplicate" `ActionsMenuItem`.
- [x] 1.3 `DashboardList.tsx`: wrap `handleDuplicateDashboard`'s body in
      `guardedRun(dashboard.id, ...)`; pass `disabled: isPending(dashboard.id)` into the
      "Duplicate" `ActionsMenuItem`.
- [x] 1.4 `usePipelineDetailPage.ts`: wrap `handleDuplicateStep`'s body in
      `guardedRun(stepId, ...)`; expose `duplicatingStepIds: ReadonlySet<string>`
      (the hook's pending-state, not a function) alongside `handleDuplicateStep`.
- [x] 1.5 Thread `duplicatingStepIds` from `PipelineDetailPage.tsx` into
      `PipelineRiverView.tsx`, exactly like the existing `onDuplicateStep` prop, and
      from there into `RootColumn.tsx` and `LaneColumn.tsx` (including their recursive
      fan-out to nested lanes) purely as a pass-through — `RootColumn.tsx` renders no
      `StepCard` itself, only `LaneColumn`. At each of the three actual
      `<StepCard onDuplicate=... />` call sites (`PipelineRiverView.tsx`'s
      primary-steps render, and `LaneColumn.tsx`'s tail-chain and lane-column renders),
      add `isDuplicating={duplicatingStepIds.has(step.id)}` as a plain boolean — not a
      function prop, since `StepCard` is `React.memo`-wrapped. Add the `isDuplicating`
      prop to `StepCard.tsx`'s own props interface and use it (only) to disable the
      "Duplicate step" `<button>`, distinct from the existing step enable/disable
      toggle.

### Tests

- [x] 2.1 `frontend/src/hooks/useInFlightGuard.test.ts` — unit tests for the hook itself:
      two synchronous `guardedRun` calls with the same key in one tick invoke `fn` once;
      calls with different keys are independent; `isPending` clears after both a
      resolved and a rejected `fn` promise (assert no unhandled-rejection warning is
      raised for the rejected case).
- [x] 2.2 `PanelCard.test.tsx` — hold the `duplicatePanel` dispatch pending (a
      controlled/deferred promise). `ActionsMenu` closes itself before invoking an
      item's `onClick` (design.md Decision 3), so a genuine double-activation here is
      "activate Duplicate, reopen the menu, activate Duplicate again" — not two clicks
      on the same still-open item. With the first request still pending, reopen the
      menu and click "Duplicate" again; assert `duplicatePanel` was dispatched exactly
      once. Separately: let the pending promise resolve (and, in a second case,
      reject), reopen the menu, and assert the "Duplicate" item is enabled again and a
      further click issues a new dispatch. Confirm each of these tests fails
      (dispatches twice / stays disabled) with the guard wiring removed.
- [x] 2.3 `DashboardList.test.tsx` — same shape as 2.2 (reopen the menu between
      activations, per `ActionsMenu`'s close-on-click behavior) for
      `duplicateDashboard`. Confirm both the double-activation and the
      re-enable-after-settle (success and failure) tests fail with the guard wiring
      removed, same as 2.2.
- [x] 2.4 `PipelineDetailPage.test.tsx` (or a dedicated
      `usePipelineDetailPage.test.ts` if step-duplicate logic is more directly testable
      there) — hold the duplicate call pending, activate "Duplicate step" on the same
      step twice in the same tick, and assert the duplicate call fires exactly once;
      separately confirm the button re-enables (and a subsequent activation fires a new
      call) after the pending call resolves and, in a second case, rejects. To confirm
      the same-tick test actually fails with the guard removed (design-gate skeptic
      round-3 note): fire both activations before any re-render commits (e.g. two
      synchronous `fireEvent.click` calls in the same test tick, or call the handler
      directly twice) rather than relying on the rendered `isDuplicating`-disabled
      button to block the second click — a real disabled DOM button blocks the second
      click on its own regardless of whether the ref-based guard exists, so that path
      alone wouldn't prove the synchronous check is doing anything (task 2.1's direct
      hook test already covers that check regardless).

## Standing Constraints

- [C1] Guard must be re-entry-proof against synchronous double-activation in the same tick (ref-based, not React-state-only)
- [C2] Models: sonnet for executor/evaluator, opus for skeptic (driver-mandated override)
- [C3] Budget exhaustion (any cycle/gate-round bound) is a mandatory escalation to the driver, never self-approval
