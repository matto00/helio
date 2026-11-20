## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file; never run env-dumping commands; never copy .env files or trees containing them (scripts/concertino/.concertino.env may be read by scripts, never printed).
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with stop-servers.sh; delete test residue by exact id.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; sbt testFull in shards that fit; never background a run past the tool timeout.
- [C6] Red first with mutations; run full spec files; commit the red run before implementation code.
- [C7] Scratch in .concertino/scratch/HEL-1722/; follow-up evidence in .concertino/runs/HEL-1722/evidence/.
- [C8] Do not edit PatchSetUndoService, PatchSetUndoConflictCheck or undo specs (HEL-1720); no migration; no live model call (ANTHROPIC_API_KEY empty).
- [C9] Apply accepts exactly what it accepts today; a non-trivial bug found on the way becomes a follow-up, not scope.

## 0. Tests (red first)

- [x] 0.1 Write `check-inventory.md`: every `addStep`/`updateStep`/`createStatic`/`update` pre-write check with file:line, classified dry-run (shared fn) or apply-only with reason (D6, D7)
- [x] 0.2 Write `PatchSetPreviewWriteParitySpec` per design D8 (service is the oracle; all four gaps, rejectIfReparents, D7 same-set entries; helio_app_test)
- [x] 0.3 Run it on unmodified main code, record `red-run.md` (each gap's failing entries named), commit spec + red run

## 1. Backend: step checks

- [x] 1.1 Add `PipelineStepWriteChecks` with `checkAdd` (D1); `addStepReporting` calls it, then `persistNewStep`
- [x] 1.2 Add `checkUpdate` (D2); `updateStep` calls it, then the repo update
- [x] 1.3 Wire it in `PipelineService` and add `stepWriteChecks` to `PatchSetApplyContext` + `build` (D3)
- [x] 1.4 `resolvePipelineStepCreate`/`resolvePipelineStepUpdate` call `checkAdd`/`checkUpdate`; delete their private copies; one `prefixedWithEdit`
- [x] 1.5 `resolveAll` tracks pipelines an earlier step edit touches and passes `GraphChecks.Skip` for later step edits on them (D7)

## 2. Backend: data sources and roots-only create

- [x] 2.1 `resolveDataSourceCreate` calls `DataSourceService.validateStatic(req, DatasetMaxRows)` (D4)
- [x] 2.2 Add `DataSourceService.validateUpdate`; `update` and `resolveDataSourceUpdate` call it first, before ownership (D4)
- [x] 2.3 `resolvePipelineCreate` runs `rootSchemas()` on `preflight == Right(None)` (D5)

## 3. Tests (green and proofs)

- [x] 3.1 Parity spec green; update old-wording assertions in existing patch-set specs, listing each in the inventory
- [x] 3.2 Mutations (D9) each turn named entries red; record in `mutations.md`
- [x] 3.3 Run every spec under `services/patchsets`, `services/pipelines`, `services/sources`, `services/proposals` in full; plus `PatchSetUndo*`/rollback specs (read-only); then `sbt testFull` in shards
- [x] 3.4 Update the HEL-1638 inventory pointer: mark its deferred row resolved by this change in `check-inventory.md`
