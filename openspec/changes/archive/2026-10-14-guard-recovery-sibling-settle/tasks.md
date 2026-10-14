## Standing Constraints

- [C1] Every forced ordering uses promises the test or a seam completes; no `Thread.sleep`, retry or `eventually` added to force an ordering. The only time bound added is the D3 step-4 absence window, which never decides an ordering in unmodified code.
- [C2] No committed production (`backend/src/main`) change; the D4 mutation is temporary and reverted, `git diff backend/src/main` empty at commit.
- [C3] Every test-run claim in evidence (green, red mutation, repeats) shows this worktree's own paths and executed test counts or failing test names, never only an exit code (HEL-1595: sbt 2 may replay cached output).
- [C4] New seam state follows HEL-1565 capture-at-call-start and is reset in `resetSeams()`.
- [C5] Each new captured seam field (`binarySettled`, `nodeWriteFailed`; `binaryEntered` too if it is per-test state) gets a `LateFinisherSeamIsolationSpec` test that is red when its capture is reverted (design-gate skeptic note 3).

## 1. Seams

### Tests

- [x] 1.1 Add `binarySettled`, `binaryEntered` (HookBinaryRepo) and `nodeWriteFailed` (HookSnapshotRepo) per design D2, captured at call start, reset in `resetSeams()`; failed node writes re-fail unchanged
- [x] 1.2 Add `submitAsync` and refactor `submitWith` onto it (one wiring); existing late-finisher specs still compile and pass

## 2. Test

### Tests

- [x] 2.1 Add the design D3 test on the won + deleted recovery path; green on unmodified production code

## 3. Proof

### Tests

- [x] 3.1 D4 mutation: remove `settle(siblings)` temporarily, record the red, revert, show `git diff backend/src/main` empty
- [x] 3.2 D4 non-vacuity mutation: un-held sibling makes the absence assertion fail; record it
- [x] 3.3 Extend `LateFinisherSeamIsolationSpec` with one test per new captured field (C5), each red when its capture is reverted; record in evidence.md

## 4. Verification

### Tests

- [x] 4.1 Run `LateFinisherRunSpec`, `LateFinisherDeleteAfterWonSpec`, `LateFinisherSeamIsolationSpec` together 5 times, foreground, `nice -n 19`; record counts and paths in evidence.md
- [x] 4.2 Backend format/code-quality gates for touched files pass (the checks the pre-commit hook runs)
