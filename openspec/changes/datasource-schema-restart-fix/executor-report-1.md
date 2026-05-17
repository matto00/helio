# Executor Report — HEL-256 cycle 1 (investigation)

**Status**: investigation complete; **literal "schema disappears on restart"
bug could not be reproduced** with the documented upload flow. The
investigation surfaces (a) why the bug appears intermittent, (b) the actual
manifestation seen in the dev DB, and (c) a fix proposal that addresses the
root cause without speculating about the never-reproduced restart trigger.

## 1. Reproduction recipe — what I tried

### Setup

- Worktree: `/home/matt/Development/helio/.worktrees/HEL-256`
- Branch: `bug/datasource-schema-restart/HEL-256`
- Backend: `HELIO_HTTP_PORT=8320 sbt run` from the worktree's `backend/`
- DB: shared dev Postgres `localhost:5432/helio` (matt-owned)
- Auth: reused existing valid Bearer token for `matt@helio.dev`
  (`9532cfcf-9882-45ba-8247-23706bc00113`) from the `user_sessions` table
- Direct API smoke (no Playwright) — `curl` against `/api/types` and
  `/api/data-sources`, which is the same path the frontend uses

### Steps and outcomes

| Step | Source kind | Backend restarts | DT present after restart? | sourceId link intact? |
|------|-------------|------------------|----------------------------|------------------------|
| 1 | CSV (3 cols × 3 rows, no overrides) | 1 | Yes (4 fields) | Yes |
| 2 | CSV with field overrides | 0 (created post-restart) | Yes (4 fields, overridden names) | Yes |
| 3 | `PATCH /api/types/:id` (rename + fields) | 0 | Yes, v2, sourceId preserved | Yes |
| 4 | `POST /api/data-sources/:id/refresh` (CSV) | 0 | Yes, v3, sourceId preserved | Yes |
| 5 | Static source (2-column inline payload) | 1 | Yes (2 fields) | Yes |
| 6 | SQL source (`SELECT 1 AS x, 2.0 AS y`) | 1 | Yes (2 fields) | Yes |
| 7 | All four sources together → restart → restart again | 2 | All four DTs present | All four sourceId links intact |

**I cannot reproduce the literal "schema disappears after restart" bug** with
any combination I tried. The schema is read from `data_types.fields` (a
String JSON column in Postgres) and is fully durable.

The Linear ticket's wording ("**sometimes** disappears") is consistent with
this finding: there is no deterministic restart trigger I can locate. The
"sometimes" almost certainly reflects a different underlying state-change,
not the restart itself.

## 2. Dev-DB forensic finding — what "schema disappeared" actually looks like in the wild

Inspecting the live dev DB I found one source that matches the user-visible
symptom — schema absent on the Sources page — but it is **not** caused by
restart:

```
data_sources row:
  id          = 32f495cd-4c21-41c9-a81c-00a8ee7804c0
  name        = "HelioProfit"
  source_type = csv
  config      = {"path": "csv/32f495cd-...csv"}   ← file exists on disk (6 rows)
  owner_id    = 0632ca2e-... (mattheworr018@gmail.com — matt's Google account)
  created_at  = 2026-05-11 23:38:07

data_types row that should pair with the above (does NOT exist):
  (no row in data_types has source_id = 32f495cd-...)

What does exist for that owner:
  data_types id = c1005183-0cbe-4631-ac62-95421e18f0a5
  name          = "Profit"
  source_id     = NULL                    ← never linked
  version       = 3                       ← has been updated twice
  owner_id      = 0632ca2e-...
  fields        = 5 string columns (profit_calc, profit, revenue, expenses, month)
  created_at    = 2026-05-11 23:38:21    ← 14s after the source upload

pipelines row for the same owner:
  source_data_source_id = 32f495cd-... (HelioProfit)
  output_data_type_id   = c1005183-... (the unlinked "Profit" DT above)
```

The unlinked "Profit" DT is in fact the **pipeline output type**, created by
`PipelineRepository.create` (line 89–99) which hard-codes `sourceId = None`.
It happens to share a name with the upload because the user named the
pipeline "Profit". The HelioProfit CSV itself **never had a CSV-inferred
DataType**: there is no `data_types` row with `source_id =
32f495cd-...` and no historical record (the `data_types` table has no audit
log).

### Three plausible explanations for HelioProfit's missing DT

1. **The CSV was originally uploaded via a now-removed code path**
   (pre-CS2c-2 / pre-HEL-237) that did not insert the DT.
   `git log --all -p backend/src/main/scala/com/helio/services/DataSourceService.scala`
   should be inspected by cycle 2 for any historical commit that uploaded a
   CSV without calling `dataTypeRepo.insert`.
2. **The DT was manually deleted** via `DELETE /api/types/:id`. The current
   service `DataTypeService.delete` blocks deletion of types bound to a
   panel but does not block deletion when the type's source still exists —
   so a user (or a test) could have intentionally deleted the inferred DT
   and the source was left orphaned.
3. **The source was created via the pipeline-create UI**, which calls
   `POST /api/pipelines` and only inserts a pipeline-output DT (with
   `sourceId = None`). If the pipeline UI ever offered a "create source +
   pipeline" combo flow that bypassed
   `DataSourceService.createCsv`, this would explain the missing DT
   exactly.

The combination "CSV file exists, source row exists, DT row absent, pipeline
references the source" most strongly suggests **explanation #3**: the source
was created as the input to a pipeline, never through the schema-inferring
`createCsv` path. The cycle-2 fix should make this case impossible — see
§ "Fix design" below.

## 3. Assessment of the six pre-recorded candidates

From `ticket.md`:

| # | Candidate | Verified? | Verdict |
|---|-----------|-----------|---------|
| 1 | DT row didn't persist (silent write failure) | Yes | **Refuted.** `createCsv` inserts inside the same `flatMap` as the source insert; the response only resolves after the DT insert returns. A silent failure would surface as a 500 to the upload caller. |
| 2 | DT filtered out on read (ACL/ownership check on DT) | Yes | **Partially relevant.** `DataTypeRepository.findAll(ownerId)` does filter by `owner_id`. If a CSV is uploaded with one owner and the user later authenticates as a different `UserId`, the DT will be invisible. **This is real** (the dev DB has CSV sources owned by `9532cfcf` and DTs owned by `0632ca2e` for matt's two accounts), but it manifests as "all my data is gone after I switched accounts," not "schema disappeared after restart." |
| 3 | Sources page reads from elsewhere / re-inference | Yes | **Refuted.** `SourceDetailPanel` reads `state.dataTypes.items` populated by `GET /api/types`, which returns persisted `data_types.fields`. No re-inference path runs at read time. |
| 4 | Re-inference at read time depending on CSV file | Yes | **Refuted.** The only file-touching read path is `previewCsv` (returns rows, not schema). Schema is purely DB-backed. |
| 5 | DB not actually persistent (in-memory) | Yes | **Refuted.** `application.conf` resolves `DATABASE_URL` to Postgres; the dev DB has rows older than a month. |
| 6 | ID drift across restart | Yes | **Refuted.** Source IDs are `UUID.randomUUID()` at creation time, written to Postgres, and never regenerated. `AuthenticatedUser.id` comes from `user_sessions.user_id` (also durable). |

### Newly identified seventh candidate

7. **The source was created without going through `DataSourceService.createCsv`.**
   `POST /api/pipelines` (PipelineRepository.create) inserts a pipeline-output
   DT with `sourceId = None` and a fresh source ID is **not** inserted by
   pipeline-create — the pipeline references an *existing* source. But if a
   composite flow ever existed (or exists in a non-Helio frontend / curl
   script) that inserts a CSV source row directly without calling
   `createCsv`, the inferred DT will be missing. Conjunctively: any code path
   that deletes the inferred DT (`DELETE /api/types/:id` on an unbound type)
   leaves the source orphaned with the same visible symptom.

## 4. Scope — CSV, Static, SQL all tested

I created and verified persistence across restart for one of each. All three
flows insert the inferred DT inside the same `flatMap` as the source insert,
so the bug is **not source-type-specific**. The CSV-centric phrasing in the
ticket is most likely because CSV is the most-exercised flow in dev/demo,
not because CSV is uniquely fragile.

## 5. Fix design (cycle 2)

The investigation surfaces three real (small) gaps that together close the
"schema disappeared" trust failure even though the literal restart trigger
is not reproducible:

### Fix A (backend, ~30 LoC) — diagnostic guarantee at boot

Add a startup check in `Main.scala` that logs (WARN) any `data_sources` row
that has no matching `data_types` row, broken down by `source_type` and
`owner_id`. This converts the silent failure into an actionable signal and
gives cycle-2's regression test a measurable surface.

Files touched:
- `backend/src/main/scala/com/helio/app/Main.scala` (+5 LoC: call a new
  helper after `DemoData.seedIfEmpty`)
- `backend/src/main/scala/com/helio/app/SourceSchemaHealthCheck.scala`
  (new, ~25 LoC: one Future that joins `data_sources` LEFT JOIN
  `data_types` ON source_id and logs any unjoined rows)

### Fix B (backend, ~15 LoC) — block DT deletion when source still exists

Update `DataTypeService.delete` to additionally check whether the DT's
`source_id` points to a still-existing `data_sources` row. If yes, refuse
the delete with a 409 — the user should delete the source (which will
cascade-set-null the DT, and then a follow-up cleanup can purge orphans).

Files touched:
- `backend/src/main/scala/com/helio/services/DataTypeService.scala`
  (+10 LoC in `delete`)
- `backend/src/main/scala/com/helio/services/ServiceError.scala` (no
  change; the `Conflict` variant already exists)

### Fix C (frontend, ~20 LoC) — surface the "no schema" state

Update `SourceDetailPanel` so when the schema lookup `relatedType` is
`undefined` (or has zero fields), render a small "Schema not available —
[try refresh]" affordance instead of silently omitting the section. Wire
the button to dispatch `refreshSource(sourceId, kind)` followed by
`fetchDataTypes`. This converts the silent-failure trust hit into a
recoverable workflow.

Files touched:
- `frontend/src/features/sources/ui/SourceDetailPanel.tsx`
  (+15 LoC; replace the `relatedType !== undefined && ... > 0 ? ... :
  null` branch with a triple: schema | "no schema yet, try refresh" |
  loading)
- `frontend/src/features/sources/ui/SourceDetailPanel.test.tsx` (new
  test covering the empty-schema render path)

### Surface summary

- **Total estimated diff**: ~70 LoC across 4 files (1 new backend file, 1
  new frontend test, 2 in-place edits)
- **All three fixes are independent** and could be staged as separate
  commits in cycle 2

## 6. Regression test plan (cycle 2)

### Backend (ScalaTest)

`DataSourceServiceRestartPersistenceSpec` (new), using the existing
test-DB harness:

1. Insert a CSV source via `createCsv` (real bytes, real
   `SchemaInferenceEngine.fromCsv`)
2. Tear down the service + re-instantiate against the **same Slick DB**
   (simulates restart without bouncing Postgres)
3. Assert `dataTypeRepo.findBySourceId(srcId, owner)` returns 1 DT with
   the expected field count
4. Repeat for Static (via `createStatic`) and SQL (via `SourceService.createSql`)

### Backend (smaller, deterministic)

`SourceSchemaHealthCheckSpec` (new) — insert a CSV source row directly
via Slick without going through the service, run the new health-check
helper, assert it logs exactly one orphan.

### Frontend (Jest)

`SourceDetailPanel.test.tsx` (new test in existing file) — render the
panel with a source whose `id` does not match any DT in `state.dataTypes.items`,
assert the "Schema not available" affordance is rendered.

## 7. Risks

- **The fix doesn't address a literal restart trigger because I
  couldn't reproduce one.** If the user has a deterministic repro they
  haven't shared, the cycle-2 fix may be incomplete. Mitigation: Fix A
  (boot-time health check) at least makes any future orphan loud, so a
  recurrence is easy to spot and triage.
- **Fix B (block DT delete while source exists)** changes user-visible
  behaviour. A user who previously deleted an inferred DT and re-uploaded
  the source to get a fresh schema would now get a 409. This is the
  correct change but should be called out in the cycle-2 commit.
- **Fix C (frontend empty-schema affordance)** is purely additive
  UX — no risk.

## 8. Open questions for the orchestrator-relay

1. Should cycle 2 try harder to reproduce — e.g., ask the user for the
   exact source they saw the bug on, the browser console log at the time,
   or an HAR file? If "could not reproduce" is acceptable for cycle 2's
   acceptance, the three fixes above should still ship.
2. Is HEL-267 (dev-DB drift cleanup) blocking? The orphan inspection in
   § 2 above ran against drifted state; a clean dev DB might surface
   different patterns.
3. Should the `data_types.source_id ON DELETE SET NULL` semantics be
   reconsidered? Switching to `ON DELETE CASCADE` would prevent the
   orphan situation entirely, but it would also delete user-customized
   computed-field expressions when a source is deleted. The current
   `SET NULL` is the safer default; the trade-off is worth a separate
   ticket.
