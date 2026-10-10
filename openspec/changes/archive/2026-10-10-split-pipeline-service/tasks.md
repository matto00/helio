## 1. Baseline (on the unmodified worktree at BASE 1b765f59d)

- [x] 1.1 Check free memory (>= ~15 GB available) before any sbt run; `nice -n 19`, `-J-Xmx3g`, no sbt server left running.
- [x] 1.2 Run `sbt testFull` at BASE in the background to a log under `.concertino/runs/HEL-1463/` (main checkout evidence dir); poll with `scripts/concertino/await-sentinel.sh`; record total and per-suite results and the `[hel1468-guard]` line in `test-count-evidence.md`.
- [x] 1.3 Capture BASE `javap -public` of `PipelineService` and `PipelineService$` (raw + D6b-filtered).

## 2. Move

- [x] 2.1 Write the D6a inventory (every base class-body member -> one destination) in `move-evidence.md`.
- [x] 2.2 Create the nine D2 collaborator files with bodies byte-identical (D3), D5 logger, D2a `requireEditorAccess` parameter.
- [x] 2.3 Reduce `PipelineService.scala` to D1: kept members verbatim, one-line delegations, D4 wiring; prune unused imports.
- [x] 2.4 Update the package README's file list (`services/pipelines/README.md`).
- [x] 2.5 Compile `main` and `test` with zero new warnings; `npm run check:scala-quality` passes.

## 3. Evidence

- [x] 3.1 Move checker (forward, reverse, coverage) PASS; both red runs recorded (D6a).
- [x] 3.2 `javap -public` filtered diff empty; raw/dropped counts recorded; red run recorded (D6b).
- [x] 3.3 Grep guards recorded: logger, Forbidden/access-helper, inline FQN (D6c).
- [x] 3.4 Nine test-exercise mutation red runs, then green (D6d).
- [x] 3.5 `sbt testFull` after: per-suite identical to 1.2, `[hel1468-guard]` present; `git diff BASE...HEAD -- backend/src/test` empty (D6e).
- [x] 3.6 Record follow-up candidates in `move-evidence.md`; fix none: stale positional comment words and doc links; stale `PipelineService.scala` line citations in test comments (`PipelineCreateTransactionalSpec`) and main comments (`PatchSetApplyResolvers.scala:178`, `PatchSetPreviewProjection.scala:286`, `PipelineStepRepository.scala:1092`); dead `stepAddress`; entry `log` left unused; collaborators over the 250-line soft budget (named, with sizes); any defect noticed.

## Standing Constraints

- [C1] Zero diff under `backend/src/test`; per-suite test results equal the BASE baseline.
- [C2] `ServiceError.Forbidden(` appears in `PipelineService.scala` exactly once (in `requireEditorAccess`) and in no new file; no new file calls an access helper.
- [C3] Moved code logs via the `classOf[PipelineService]` logger.
- [C4] Moved bodies are byte-identical apart from D3's listed categories; defects found become follow-ups, not fixes.
- [C5] Filtered (D6b) `javap -public` of `PipelineService` and `PipelineService$` is unchanged.
- [C6] No edits inside any moved or kept comment; the only permitted in-member substitution is `private` -> `private[pipelines]`.
