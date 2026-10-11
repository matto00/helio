## 1. Baseline (unmodified worktree at BASE; re-pinned in cycle 2 from 6d298d5f8 to 55b53be4a after merging HEL-1480, D7)

- [x] 1.1 Check free memory (>= ~15 GB available) and that no other lane's `testFull` is running before any full sbt run; `nice -n 19`, `-J-Xmx3g`; shut down every sbt server you start. (evidence: free 33 GB, no other testFull)
- [x] 1.2 Run `sbt testFull` at BASE in the background to a log under `/home/matt/Development/helio/.concertino/runs/HEL-1479/`; poll with `scripts/concertino/await-sentinel.sh`; record total, per-suite results and the `[hel1468-guard]` line in `test-count-evidence.md`. (evidence: test-count-evidence.md)
- [x] 1.3 Capture BASE `javap -public` of `PatchSetApplyResolvers` and `PatchSetApplyResolvers$` (raw + D6b-filtered). (evidence: move-check/javap-base.*)

## 2. Move

- [x] 2.1 Write the D6a inventory (every BASE object-body block -> one destination, exact span, widened or not) in `move-evidence.md`. (evidence: move-evidence.md)
- [x] 2.2 Create the five D2 collaborator files, bodies byte-identical (D3), named member imports, `private` -> `private[patchsets]` only where D2 says. (evidence: gen.py + check.py PASS)
- [x] 2.3 Reduce `PatchSetApplyResolvers.scala` to D1: kept members verbatim, named imports for the dispatch, `PatchSetResolverSupport` as a second top-level object; prune unused imports. (evidence: check.py PASS)
- [x] 2.4 Update `services/patchsets/README.md`'s "Holds" list. (evidence: README Holds list)
- [x] 2.5 Compile `main` and `test` with zero new warnings; `npm run check:scala-quality` passes. (evidence: compile-after.log: no new warnings; guard-evidence.txt: check:scala-quality exit 0)

## 3. Evidence

- [x] 3.1 Move checker (forward, reverse, coverage, block rule) PASS; both red runs recorded (D6a). (evidence: move-check/check-green.txt, red-runs.txt)
- [x] 3.2 `javap -public` filtered diff empty; raw/dropped counts recorded; red run recorded (D6b). (evidence: api-evidence.md)
- [x] 3.3 Grep guards recorded (D6c). (evidence: guard-evidence.txt)
- [x] 3.4 Six behaviour mutation red runs, then green (D6d). (evidence: mutation-evidence.md)
- [x] 3.5 Four ExistenceNotLeakedRoutesSpec guard red runs, then green (D6f). (evidence: move-evidence.md (G1-G4))
- [x] 3.6 `sbt testFull` after: per-suite identical to 1.2, `[hel1468-guard]` present; `git diff BASE...HEAD -- backend/src/test` empty (D6e). (evidence: test-count-evidence.md)
- [x] 3.7 Record follow-up candidates in `move-evidence.md`; fix none: stale positional comment words and doc links in moved code; stale prose mentions (`PatchSetPreviewProjection.scala:355`, `RefinementEditShapeSpec.scala:31`, `PatchSetPreviewServiceSpec.scala:504`, `PatchSetUndoService.scala:245-246`); output rows' `sites` label (D5); any file over the 250-line soft budget; any coverage gap from 3.4; any defect noticed. (evidence: move-evidence.md Follow-up candidates)

- [x] 3.8 Evidence scripts take BASE as a variable; if origin/main moves (HEL-1480), follow design.md D7. (evidence: HEL-1480 merged first; D7 followed in cycle 2: merge 46c0ba9b4, BASE re-pinned to 55b53be4a, D6a/D6b/D6c/D6f regenerated, testFull re-baselined; superseded 6d298d5f8 evidence labelled in move-check/superseded-6d298d5f8/)
- [x] 3.9 Foreign-id gate mutations for the 12 `PatchSetApplyResolvers.scala` rows of `ExistenceNotLeakedRoutesSpec` (panel, step, output gates), each shown red then reverted; reverse-direction dispatch probe G5. (evidence: mutation-evidence.md "Foreign-id gate mutations", move-evidence.md G5)
- [x] 3.10 Record cycle-2 follow-up candidates: stale `PipelineService` citations inside moved resolver code; `PipelineProtocol.scala:60`'s `PipelineService.resolveInlineOrExistingRoot`. (evidence: move-evidence.md candidates 8-9)

## Standing Constraints

- [C1] Zero diff under `backend/src/test`; per-suite test results equal the BASE baseline.
- [C2] `PatchSetApplyResolvers.scala` keeps exactly 4 `ServiceError.Forbidden(` code lines, 2 `requireAccess(` code lines and every `case ("kind", "op")` dispatch line; no new file contains a producer or access-helper call.
- [C3] Moved bodies are byte-identical apart from D3's listed categories; defects found become follow-ups, not fixes.
- [C4] No edits inside any moved or kept comment; the only in-member substitution is `private` -> `private[patchsets]` on D1/D2's named declarations.
- [C5] Filtered (D6b) `javap -public` of `PatchSetApplyResolvers` and `PatchSetApplyResolvers$` is unchanged.
