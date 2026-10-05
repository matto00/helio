# HEL-1265 repro findings (executor)

Own servers: backend 9604, frontend 6697, both on this worktree (cwd verified via /proc). Fresh user registered for the
run, deleted at the end by exact id.

## Premise: CONFIRMED live (pre-fix, red)

Pipeline over CSV source A; `upsertsource` step targeting a SEPARATE owned CSV B (a target equal to the pipeline's own
root source is refused by the cycle check, so the ticket's claim needs a distinct CSV).

| Surface | Pre-fix result |
|---|---|
| POST step (create) | 201 |
| analyze | 200, step `validationError` absent |
| step preview | 200 |
| dry run | 200 |
| real run | 422 `Step (upsertsource): Data source is not a dataset: <id>` (unnamed, generic body, no `code`) |

Unit/route red: `UpsertTargetWritableRoutesSpec` + `UpsertTargetWritableRlsSpec` 14 failed of 23 tests;
`PipelineApplyProposalUpsertTargetSpec` and the new `PatchSetApplyServiceSpec` case failed pre-fix (logs in
/tmp/claude-1000/h1265/red2.log, red3.log, red4.log, not committed). Tests that are GUARDS (green pre-fix on purpose):
foreign/unknown 404 identical, stored step lists cleanly, sibling-branch preview 200, HEL-1252 delete still blocked,
dataset control, enabled-only update on a stored invalid step.

## Post-fix (green), same servers restarted on the new code

- Stored pre-fix invalid step: list 200 (clean), analyze `validationError` names target, concise analyze likewise,
  step preview / dry run / real run each 422 `STEP_CONFIG_INVALID` with `stepId`, `stepKind: upsertsource`, `reason`.
- Fresh add of a step targeting CSV: 422 `Upsert target '<name>' (<id>) is a csv source; an existing-source target must be a dataset.`
- Dataset control: add 201, preview 200, dry run 200, real run 200, 2 rows written to the target dataset.

## Ids created in the shared dev DB (all deleted by exact id; pipelines/sources via DELETE API, run-rate-window rows and the user via exact-id SQL)

- user 42bea1c8-0bc0-4ffa-85e8-56247b6f4924 (h1265-1887523@helio.test)
- sources: c3d80c23-1785-4fa9-921b-c8d916d19b30, c316574d-256e-420b-bd64-59dd007ec0c4, 9c9a496e-0adc-4d4d-99eb-90994c80532d,
  3883cec2-481a-4f3a-9e4e-e8221ae06429, d9f345b9-b1aa-47ba-aadd-cb4d2118498b, 1342d1f2-9524-4136-bca7-f308af3f71d5,
  f9b57d2a-ebe3-44d3-8470-458a5e231aa7
- pipelines: 5af1788c-a802-471c-b147-ddd22d55336f, 3f705a92-bc66-4aec-8810-e07d3a2817e5,
  99215ff9-4a3b-475f-bdc9-04d9f7817549, 8ef71bf0-255a-49e3-86c0-e086033419ea
- steps: 5cbc0504-066b-424a-bb34-b400f3bc0b69, a5c45279-cafd-43ba-bda0-2e7326ee4966

## 4.9 Dev DB count (read-only, `default_transaction_read_only=on`)

Pre-existing stored `upsertsource` steps with a non-dataset existing-source target: **0**. At query time the only
`upsertsource` row in the whole dev DB was this run's own repro step (5cbc0504..., since deleted), i.e. dev has 0
pre-existing upsert steps at all, so 0 invalid, 0 missing targets, 0 foreign-owner. Query (config is TEXT: cast guarded):

```sql
WITH parsed AS (
  SELECT id, pipeline_id,
         CASE WHEN config ~ '^\s*\{' THEN (config::jsonb)->'target'->>'kind' END AS target_kind,
         CASE WHEN config ~ '^\s*\{' THEN (config::jsonb)->'target'->>'dataSourceId' END AS target_id
  FROM pipeline_steps WHERE op = 'upsertsource')
SELECT count(*) AS upsert_steps,
       count(*) FILTER (WHERE p.target_kind = 'existingSource' AND coalesce(p.target_id,'') <> '') AS existing_targets,
       count(*) FILTER (WHERE p.target_kind = 'existingSource' AND ds.id IS NULL AND coalesce(p.target_id,'') <> '') AS target_missing,
       count(*) FILTER (WHERE ds.id IS NOT NULL AND ds.source_type NOT IN ('dataset','static')) AS non_dataset_targets,
       count(*) FILTER (WHERE ds.id IS NOT NULL AND ds.source_type NOT IN ('dataset','static') AND pl.owner_id <> ds.owner_id) AS non_dataset_foreign_owner
FROM parsed p LEFT JOIN pipelines pl ON pl.id = p.pipeline_id LEFT JOIN data_sources ds ON ds.id = p.target_id;
```

Stored invalid steps read back cleanly (the kind is not part of the config, decode is unaffected); they are flagged by analyze and refused at execution.

## Mutation (4.8)

`DataSourceKind.isWritableDataset` neutered to `= true`: 16 tests red across save (route + service + proposal + patch-set),
analyze, step/Output preview, dry run, real run, evaluate (RLS spec) and the predicate/check unit tests. Restored (git diff shows only the intended +5 lines).

## Notes

- 5.1: evaluate builds `AuthenticatedUser(UserId(ctx.ownerUserId))` (default source/tokenId), the same construction as `upsertOwnershipCheckF`; `ownerUserId = None` fails closed with a plain not-found IAE.
- 5.2: only `UpsertSourceStepSpec`'s pure evaluate test built a ctx with `ExistingSource` and a null repo; classified fixture-shape (switched to `NewSource`; ExistingSource evaluate is covered with a real repo in `UpsertTargetWritableRlsSpec`).
- 4.7: `UpsertSourceConfigSpec`'s old `validateTargetOwnership` tests were behaviour-pinning for a removed method; rewritten against `UpsertTargetCheck.check`. Its "accept an owned target" case used a REST source and so pinned the exact bug; repointed to a dataset, with a new refuse-REST case. No other existing spec used a non-dataset existing-source target (full `sbt testFull` green).
- 5.4: disclosure: the 422 / `STEP_CONFIG_INVALID` reason names the source's name and kind to anyone who can save or preview steps on the owner's pipeline (editor grantees included). Safe because it is produced only after `findByIdOwned` as the pipeline owner succeeded; foreign/unknown ids never reach the kind branch (asserted in the route and RLS specs).
- 5.5: patch-set apply with an invalid upsert target reports the failure and rolls back the earlier pipeline rename; no step persisted.
- D9: patch-set preview does not pre-check upsert targets (only secondaryDataSourceId), so no `services/patchsets` main change. Only a test was added to `PatchSetApplyServiceSpec`.
- 3.2: UI step editor: `useStepCardState.persist(..., captureErrors=true)` for upsertsource surfaces the PATCH's backend message through `saveError`, so the new 422 text is shown with no frontend change (not exercised in a browser; picker already lists datasets only).
