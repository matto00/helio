## Standing Constraints

## 1. Red first

- [x] 1.1 Add `backend/src/test/scala/com/helio/services/pipelines/Hel1503EditorRunGapsSpec.scala` on
      `VerifiedEmbeddedPostgres.start`, connecting as a NOSUPERUSER NOBYPASSRLS role (mirror `PipelineRunEditorPersistenceSpec`), with
      the D6 cases (a)-(h) and seams S1/S2 from design.md
- [x] 1.2 Run it against unchanged code; capture the red output (expected red: a, b if it asserts literal `[]` vs NULL, c, d, e, f, g; b2/h are pins — label each truthfully) into
      `openspec/changes/editor-run-baseline-status-codes/red-run.md`; `[hel1468-guard]` must appear

## 2. Item 1 — schema-drift baseline for editor runs

- [x] 2.1 `PipelineRepository.updateLastSourceSchemaInternal` (system context, inline justification comment)
- [x] 2.2 `DataSourceRepository.findByIdOwnedByInternal(id, ownerId)`; `PipelineRunSucceededWrites` reads the source with
      the PIPELINE owner's id on both branches (D2, thread `pipeline.ownerId`); branch the write (D1) on `ownerRun`
- [x] 2.3 Update HEL-462 doc comments that describe the baseline write as owner-only

## 3. Item 4 — mid-submit deletion

- [x] 3.1 `ConcurrencyCapResult.PipelineGone`; plain-SQL `FOR KEY SHARE` owner_id read first in both admission
      transactions, before the advisory lock (D3); no 23503 mapping
- [x] 3.2 `PipelineRunExecutor`: `PipelineGone` → `ServiceError.NotFound("Pipeline not found: <id>")`; empty-roots branch
      checks `pipelineRepo.findByIdInternal` → 404 when gone, 422 unchanged otherwise
      (`PipelineRunExecutor` has no `pipelineRepo` today: inject it or add the read to the support class; add the caller to
      `PipelineRepository.findByIdInternal`'s permitted-callers doc)
- [x] 3.2b Invert `PipelineRunEditorPersistenceSpec.scala:427-432` to `PipelineGone` on both paths
- [x] 3.3 Verify `FOR KEY SHARE` works under the owner's RLS context (NOBYPASSRLS harness, D6 e); D6(e)'s third-session
      DELETE runs through the privileged role and, after release, asserts exactly 1 row deleted (never an RLS-filtered 0)
- [x] 3.4 `ExistenceNotLeakedRoutesSpec.expectedForbiddenProducers` `PipelineRunExecutor.scala` 1 → 2 (classified in D4)

## 4. Item 5 — dry-run re-verification

- [x] 4.1 `checkRunAuthorizationInternal` → new sealed `RunAuthorization` (`Authorized`|`NotAuthorized`|`PipelineGone`)
- [x] 4.2 `PipelineRunExecutor`: call it for every dry run after the rate-limit check and before the `queued`/`running`
      events and `backend.execute`; skip when `pipelineRunRepo == null`; map per D4

## 5. Item 6 — spec text

- [x] 5.1 Edit `openspec/specs/pipeline-run-guard/spec.md` Purpose (owner's budget, not "a single user")
- [x] 5.2 Write `openspec/specs/pipeline-run-execution/spec.md` Purpose (replace the TBD placeholder)

## 6. Verify

- [x] 6.1 Invert (never delete) tests pinning old behaviour; each new guard assertion shown failable by its named mutation
      (record mutation → failing test in `red-run.md`)
- [x] 6.2 `nice -n 19 sbt testFull` green with `[hel1468-guard]` in output; shut down any sbt server started
- [x] 6.3 `files-modified.md`: bulleted, backticked, repo-relative paths, one per line
