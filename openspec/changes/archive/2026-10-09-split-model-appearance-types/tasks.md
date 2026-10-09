## Standing Constraints

- [C1] Zero edits to existing files under `backend/src/test`; the only test change is the added golden spec (D5).
- [C2] Package stays `com.helio.domain.model`; no caller file edited.
- [C3] Moved lines are byte-identical to base b409172a; only package/import/blank scaffold lines are new (D2).
- [C4] `javap -public` of every moved class/companion (incl. `Patch`) differs only in its `Compiled from` line (mapped per D1)
  and in per-file renumbering of synthetic `$anonfun$...$N` suffixes (same types, same order); class-file name set unchanged.
- [C5] Per-suite `sbt testFull` counts for every pre-existing suite equal the baseline; defects found become follow-ups.
- [C6] sbt runs only under `nice -n 19` with capped JVM parallelism; never pkill/pgrep/killall.

### Backend

## 1. Baseline

- [x] 1.1 On the unmodified worktree run `nice -n 19 sbt testFull` to a scratchpad log; record total + per-suite counts
- [x] 1.2 Record `javap -public` of the D6b classes and the `com/helio/domain/model/` class-file name list from the base build
- [x] 1.3 Write the D5 golden spec with goldens captured from base code; green; red run recorded; commit it alone

## 2. Split

- [x] 2.1 Create `ChartAppearance.scala` with lines 206-216 and 220-374 moved verbatim (D1); compiles
- [x] 2.2 Create `PanelAppearance.scala` with lines 218 and 399-491 moved verbatim (D1); compiles
- [x] 2.3 Remove the moved spans and the two now-unused imports from model.scala (D3); compiles with no new warnings
- [x] 2.4 Update `domain/model/README.md`'s file list to the full current set; `node scripts/check-scala-quality.mjs` passes; interpolations eyeballed

### Tests

## 3. Evidence

- [x] 3.1 Write `move-evidence.md` (D6a): forward + positional reverse + coverage checker, two red runs, color-moved summary
- [x] 3.2 Write `api-evidence.md` (D6b): javap diff = only per-D1 `Compiled from` lines, class-name set equal, red run
- [x] 3.3 Run `nice -n 19 sbt testFull` again; write `test-count-evidence.md` (D6c) incl. golden spec + MergeSpec green
- [x] 3.4 Confirm `git diff b409172a...HEAD -- backend/src/test` touches only the new golden spec; pre-commit hooks pass
- [x] 3.5 List any defects/oddities found during the move as follow-up candidates in `files-modified.md` (not fixed)
