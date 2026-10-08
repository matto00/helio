## Standing Constraints

- [C1] Zero diff under `backend/src/test`; test totals equal the 24f6de4cf baseline and all pass.
- [C2] Public API (`javap -public`, raw diff classified per design D5b(b)) of `OutputService`(+companion) and
  `NodeSnapshotRepository`(+companion, nested types) unchanged; no `$$` name added; only the two named `$$` removals.
- [C3] Moved bodies byte-identical apart from design D5's categories; defects found become follow-ups, not fixes.
- [C4] The single `ServiceError.Forbidden(` producer stays in `OutputService.scala`; guard exemptions unchanged.
- [C5] `services/pipelines/README.md` line 5 untouched; edits >=1 unchanged line away; trial merge with ca3f5619 clean.

## 1. Baseline

- [x] 1.1 On the unmodified worktree run `nice -n 19 sbt testFull` backgrounded to a scratchpad log; record totals + D5b(d) suite counts
- [x] 1.2 Record `javap -public` of the D5b(b) classes from the baseline build to the scratchpad
- [x] 1.3 Write the D5b(a) member inventory (every original member of both files -> destination)

### Backend

## 2. Split

- [x] 2.1 Create `NodeSnapshotFilterSql` (D4) with members moved verbatim; repository imports it; compiles
- [x] 2.2 Add `NodeSnapshotFilterSql.scala` to `TARGET_FILES` in `scripts/check-node-root-encoding.mjs`; check passes
- [x] 2.3 Create `OutputRowReads` (D1) and wire delegations; compiles
- [x] 2.4 Create `OutputRootResolution` (D2) and wire the member import; compiles
- [x] 2.5 Move the three validators into `OutputConfigValidation` (D3) and reduce the companion to forwarders; compiles
- [x] 2.6 Update persistence README Holds line; add a services README paragraph after line 11 (C5) and trial-merge ca3f5619 clean; `npm run check:scala-quality` passes, `s"${...}"` eyeballed

### Tests

## 3. Evidence

- [x] 3.1 Write `move-evidence.md` (D5b a) with forward + positional reverse checker and both red runs
- [x] 3.2 Write `api-evidence.md` (D5b b): raw diff + classification, no added `$$`, only the 2 named removals, both red runs
- [x] 3.3 Write `mutation-evidence.md` (D5b c): one mutation per new/receiving file, red via public methods, reverted
- [x] 3.4 `npm run check:node-root-encoding` green + red run against the new file (D5b e), reverted, recorded
- [x] 3.5 Run `nice -n 19 sbt testFull` again; totals equal baseline and all pass; write `test-count-evidence.md`
- [x] 3.6 Confirm `git diff 24f6de4cf...HEAD -- backend/src/test` empty and `grep -c "ServiceError.Forbidden("` per file unchanged
- [x] 3.7 List defects/oddities found during the move as follow-up candidates in `files-modified.md` (not fixed)
