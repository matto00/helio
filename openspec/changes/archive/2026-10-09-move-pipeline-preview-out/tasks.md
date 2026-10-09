## Standing Constraints

- [C1] No behaviour change: full-suite per-suite counts equal the ecaa1a53 baseline; defects found become follow-ups.
- [C2] Forbidden producers: exactly one in PipelineRunService.scala, one in PipelineRunPreview.scala, none elsewhere new.
- [C3] Moved code is byte-identical apart from D1's listed substitutions; whitespace commit is bytecode-identical.
- [C4] Test-source diff limited to the pin map, the run-status row site, and comment lines (describe/it names untouched).
- [C5] Synthetic-filtered `javap -public` of the entry point, companion, CachedRunStatus, TriggerSource unchanged.

### Backend

## 1. Baseline

- [x] 1.1 Run baseline `nice -n 19 sbt testFull` on the unmodified worktree (backgrounded, bounded polling); save per-suite counts
- [x] 1.2 Capture baseline synthetic-filtered `javap -public`; record ecaa1a53 hit count of the D7 closing grep

## 2. Move preview (commit a)

- [x] 2.1 Create PipelineRunPreview.scala and move previewStep/previewOutputs/previewAtNode byte-identical (design D1)
- [x] 2.2 Replace entry-point bodies with one-line delegations; wire `preview` val after `backend`/`support`; drop unused imports
- [x] 2.3 Update ExistenceNotLeakedRoutesSpec pin map (D2) and run-status row site to PipelineRunQueries.scala
- [x] 2.4 Run adapted move checker + both red runs (D4); write move-evidence.md
- [x] 2.5 Pin red check: third producer in PipelineRunPreview.scala and in a new file each fail the pin test; revert

## 3. Reindent (commit b)

- [x] 3.0 At commit (a) capture `javap -c -p -l` of PipelineRunPreview and PipelineRunTerminalWrites
- [x] 3.1 Reindent executeRunFailure body and previewAtNode's two blocks; prove `git diff -w` empty and javap -c -p -l identical

## 4. Dead member (commit c)

- [x] 4.1 Zero-caller grep, delete resolvePrimaryDataSourceInternal, fix the two doc refs to it

## 5. Docs and comments (commit d)

- [x] 5.1 Fix ALL item-4 stale member refs in main comments/docs + README per D7 (incl. CR2 must-fix sites)
- [x] 5.2 Fix item-5 comment in PipelineRunService.scala and PipelineRunBackfill.scala after checking call sites (D8)
- [x] 5.3 Fix stale test comments (line citations, moved-member refs, OutputRoutesSpec MUTATION PROOF); leave describe names
- [x] 5.4 Write stale-refs-evidence.md: wording table (incl. "sibling"), closing grep before/after counts, exclusions

### Tests

## 6. Behaviour proof

- [x] 6.1 Full `nice -n 19 sbt testFull` after all commits; per-suite counts identical to 1.1 (flake rule in D9)
- [x] 6.2 Filtered javap -public diff empty + red run (D9 ii); write api-evidence.md
- [x] 6.3 Show test-source diff line by line satisfies C4; write test-count-evidence.md
