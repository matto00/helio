## Standing Constraints

- [C1] If task 1.2 sees 0 errors, widen the repro (1280 viewport, both themes, form vs text, narrowing via the UI) before concluding; still none -> return ESCALATION, never ship a test that is green from the start.
- [C2] Use the React component stack to confirm WHICH Responsive loops (DesktopPanelGrid vs DesktopPanelGridSkeleton) before instrumenting; an "other" cause is fixed at the confirmed cause in helio or escalated.
- [C3] The e2e "no PATCH during load" window ends well before the 30 s auto-save and counts only layout PATCHes to /api/dashboards/:id; the PR claims no more than was measured.

## 1. Investigation

- [x] 1.1 `cd frontend && nice -n 19 npm ci`; start lane servers on helio_hel1835; verify /health
- [x] 1.2 Reproduce on main with a lane copy of the HEL-1618 probe (lane ports, sm viewport); record error count x3
- [x] 1.3 Reduce to the minimal reproducing layout (text panels; column gap vs narrowing vs first measure); record it
- [x] 1.4 Instrument (uncommitted) the props passed to `Responsive` per render plus the React component stack; record
      the trace and name the confirmed hypothesis (H1/H2/H3/other) in `.concertino/runs/HEL-1835/evidence/root-cause.md`
- [x] 1.5 If the cause is inside RGL and no helio prop sequence avoids it, stop and return ESCALATION with the repro

### Tests

- [x] 2.1 Write `e2e/hel1835-*.spec.ts` (D3): zero "Maximum update depth", zero layout PATCH, stored sm positions, md/lg
- [x] 2.2 Run it red on unfixed code 3 times; commit the red output as `.txt` evidence before any fix
- [x] 2.3 Add a jest guard reproducing the cause in jsdom if possible (red first), else record why not

### Frontend

- [x] 3.1 Implement the D2 fix for the confirmed cause; verify the new e2e is green 3 times
- [x] 3.2 Mutation: revert the fix, confirm the e2e (and jest guard) go red; record as evidence
- [x] 3.3 Run `e2e/hel1575-*.spec.ts` and `e2e/hel1624-direct-load-selection.spec.ts`; all green
- [x] 3.4 Run the grid jest folder, lint, typecheck, format:check; all green
- [x] 3.5 Before/after screenshots at sm in both themes of the reproducing dashboard; positions identical (D4) (evidence/before-after)
