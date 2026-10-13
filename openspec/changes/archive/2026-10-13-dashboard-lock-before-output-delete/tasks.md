## Standing Constraints

## 1. Red first
- [x] 1.1 Re-verify the D4 interleave premise by reading the create path (`PanelMutationRepository.insertPlaced` /
      `PanelLayoutPlacement.insertAndAppend`) and the W4-W8 delete paths; enumerate D3's O-then-D writers.
- [x] 1.2 Write `OutputDeleteRacesPanelCreateSpec` (D4) on `LockRaceSupport`; add helpers to `LockRaceSupport` only if
      shared.
- [x] 1.3 Run it with no V130 present; capture the 40P01 (W4 at minimum) in `red-evidence.md` with the exact command
      and output; label every case PROOF (red) or GUARD (green pre-fix, with reason).

## 2. Fix
- [x] 2.1 Re-check max migration on origin/main; create `V130__lock_dashboards_for_output_deletion.sql` (D1).
- [x] 2.2 Update `PanelRowLocks` doc (order now panels -> dashboards -> Outputs; D2 residual).
- [x] 2.3 Remove `OutputRepository.deleteInternal` if it has no main caller (or cover it in the spec).

## 3. Green
- [x] 3.1 New spec green; existing HEL-1485/1498/1526 race specs and migration specs green; record in
      `green-evidence.md`.
- [x] 3.2 Full backend gate (`sbt testFull`, capped per CLAUDE.md local caps) and pre-commit hooks pass.
