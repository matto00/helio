## Standing Constraints

- [C1] No lock is added to an existing writer without a race spec that is red without it (probe first, iron law).
- [C2] Every required spec (race per writer class, deadlock, non-BYPASSRLS RLS, fault injection) is shown red by a
  recorded mutation or lock removal before it counts.
- [C3] If H cannot meet G1-G3, escalate with probe evidence and options; never weaken a guarantee or add SERIALIZABLE.
- [C4] A race spec counts only with both orders choreographed and red recorded writer-first; only pre-read locks protect.
- [C5] Writer locks must not lock zero rows silently under RLS; app-pool writers are raced as an editor on the non-BYPASSRLS role.
- [C6] `40P01` is a failure in every race and deadlock spec; every G2 participant has an order argument or is in the deadlock spec.
- [C7] `ofAction` runs on the privileged pool at every call site.
- [C8] The save body is the final tree: never delete a step the draft keeps; every writer locking (3) over a set it read gets a three-session race, red first.

### Backend

## 1. Phase A: verify before building
- [x] 1.1 `evidence/g1-writers.md`: G1 writers + every txn taking locks (1)-(5) (snapshot txn, `updateSchemaInternal`, `writeLastRun`, reaper, HEL-1518 guard, alert evaluator, `applyWriteBacks`, teardown), file:line, pool, lock sequence; plus every `data_sources` row locker (`lockSource` callers DataSourceRepository :586/:665/:720/:775/:823/:986/:1089, dataset row inserts, teardown :166 panels-before-source, root add) and each writer's raced-delete handling (drop-and-continue vs not-found); each gets an order argument or joins 6.4
- [x] 1.2 Reproduce the §8.3 earlier-order deadlock and check H's order on embedded Postgres; record transcripts
- [x] 1.3 Probe D5 targets (a)-(e) for lock-order cycles; record results and any H amendment with cause

## 2. Composable writes and fingerprint
- [x] 2.1 Extract `updateAction`/`reorderTrunkAction` and lock-free delete cores; Future wrappers keep `lockForDeletion`, existing specs green
- [x] 2.2 `ofAction(pipelineId)` re-reading name/tag/roots, privileged pool at every call site; `of` delegates; parity spec
- [x] 2.3 `fingerprint` on `GET /api/pipelines/:id` (one REPEATABLE READ snapshot) and `?definition=true` steps/outputs
- [x] 2.4 V137 `hel1629_lock_pipelines` SECURITY DEFINER helper (count-returning) + repo wrapper asserting count

## 3. Save endpoint
- [x] 3.1 Request/response protocols and route `POST /api/pipelines/:id/draft/save`
- [x] 3.2 Pure `DraftDiff.plan`: removed = current minus draft exactly, forest validation, clientId resolution, explicit-id gate, FK-safe apply order (D2)
- [x] 3.3 Locks per verified protocol (one `lockForDeletion`, advisory never after pipeline row), re-plan, in-tx compare → 409
- [x] 3.4 Validation (rawConfigProblem, cross-owner refs, upsert target, lane/pipeline cycle) and cascade 422 under locks
- [x] 3.5 Apply chain, journal row (DBIO create + prune) and one audit row in the same transaction
- [x] 3.6 Run after save via unchanged `PipelineRunService.submit`; 200 with `run.started=false` on rejection

## 4. Writer instrumentation and undo
- [x] 4.1 ONLY after 6.3 records a writer-first red for that writer (C1/C4): add the helper lock to it, in the verified order
- [x] 4.2 Undo dispatch for `pipelineDefinition`: 409 naming panels/alert rules, else atomic restore (original ids, derived confirmation)

### Frontend

## 5. Contract
- [x] 5.1 Schemas: draft-save request/response, `fingerprint` on pipeline summary, stale body `currentFingerprint`
- [x] 5.2 Frontend types + service function (no UI wiring) and a seam test validating both sides against the schemas

### Tests

## 6. Required specs
- [x] 6.1 Save specs: atomic whole draft, stale 409 writes nothing, cascade 422, ACL, validation rollback; keep head child, keep a tail child moved elsewhere, Output on a removed step (400 / cascade), invalid forest 400
- [x] 6.2 Fault injection mid-chain leaves definition and fingerprint unchanged; red when the transaction is split; exactly one `hel1498_lock_panels` per save
- [x] 6.3 Race specs BEFORE 4.1, both orders, writer-first red recorded, 40P01 = failure, app-pool writers as editor (C4/C5), one per writer: panel `insertPlaced`, `duplicate`, `batchUpdate`, `insertBatchPlaced`, `PanelRepository.replace`/`delete`, dashboard duplicate, import, `replaceContents`, dashboard delete; alert-rule insert/update/delete; step PATCH/insert/delete/reorder/splice/attach; Output create/update/delete; root add/remove; schedule upsert/delete; pipeline rename/delete; source delete; `rewriteUpsertTargetAction` (grouping only by proven identical lock path)
- [x] 6.3b Three-session race per set-reading writer (root add grows the set, source delete, save), red first, then green under H′
- [x] 6.4 Deadlock spec (incl. root add + source delete on one source): the ticket's five + every newly-locking writer + the rewrite + the node-snapshot txn (reversed position/id Outputs fixture) + an advisory-taking save; no 40P01; red under the earlier order
- [x] 6.5 RLS spec on non-BYPASSRLS `TwoUserRlsApiFixture`: owner, editor, viewer, stranger, journal ownership, undo by another user; editor GET then unchanged save = 200 with a panel on a third user's dashboard + an alert rule
- [x] 6.6 Undo specs: reorder + unbound delete restored under original ids; undo of a save that deleted a branching step; later edit 409; bound cascade 409 naming each
- [x] 6.7 Run-after-save guard rejection: 200 `started:false` + `retryAfterSeconds`, save persists; editor counts against owner cap
- [x] 6.8 Document the verified protocol with evidence in `docs/live-draft-preview.md` §8.3; update `specs/pipeline-definition-lock-protocol` G2 order to the VERIFIED order (incl. any source-row prefix)
