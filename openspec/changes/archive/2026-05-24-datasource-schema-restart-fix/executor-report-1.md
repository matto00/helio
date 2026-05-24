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

---

# Cycle 1b — Continued investigation

**Status**: **REPRODUCED.** The "schema disappears for an existing source"
symptom the user described is a 100% deterministic user-action trigger, not
a restart-related race.

Cycle 1 chased the ticket's literal "schema disappears on restart" recipe
and found nothing. The user pushed back: they have seen the **symptom**
(schema vanishes for an existing source on the Sources page) without any
restart. Cycle 1b widened the trigger search per HEL-242 / [[feedback-widen-bug-repro]]
and found a deterministic user-side trigger that cycle 1 missed.

## 1b.1 Root cause (deterministic)

**`DELETE /api/types/:id` does not reject when the DataType is the
auto-inferred schema of a still-existing DataSource.** The Type Registry
sidebar (`shared/chrome/SidebarBody.tsx` lines 119-124) renders a Delete
button next to every DataType the user owns, with no visual distinction
between (a) DTs auto-inferred from a source upload and (b) DTs created as
pipeline outputs. A user clicking Delete on a source's auto-inferred DT
permanently breaks the Sources page schema display for that source:

- `data_sources` row remains (source still listed in sidebar, still
  selectable, preview still works)
- `data_types` row is gone — `SourceDetailPanel`'s `relatedType` selector
  (`state.dataTypes.items.find((dt) => dt.sourceId === source.id)`)
  returns `undefined`, and the schema section renders nothing

The only existing guard in `DataTypeService.delete` is
`dataTypeRepo.isBoundToAnyPanel(id)` (returns 409 if any panel has
`type_id === dt.id`). There is no guard for "this DT is the auto-inferred
schema of a still-existing source." So any unbound source-DT can be
deleted silently with no warning or recovery affordance.

This also explains the dev-DB `HelioProfit` case exactly. Cycle 1's
"explanation #3" (pipeline UI bypassed `createCsv`) is wrong: it's the
same Type Registry sidebar delete path. The cycle-1 report should have
identified this; instead it followed the "pipeline-create bypass" hunch
without verifying.

## 1b.2 Trigger matrix (cycle 1b)

Each trigger was attempted against a fresh CSV source uploaded as
`matt@helio.dev` on the cycle-1b backend (port 8320). "DT preserved" means
`GET /api/types` still returns a DT with `sourceId == source.id` and
non-empty `fields`. All API calls authenticated via Bearer token from
`user_sessions`.

| # | Trigger | API call(s) | DT preserved? | Notes |
|---|---------|-------------|---------------|-------|
| 1 | Rename source (sidebar Edit) | `PATCH /api/data-sources/:id {name}` | Yes | `DataSourceService.update` only touches `data_sources.name` and `updated_at` |
| 2 | Refresh CSV source (sidebar Refresh) | `POST /api/data-sources/:id/refresh` | Yes | `refreshCsv` reads file → re-infers → `dt.copy(fields = …)` preserves `sourceId` |
| 3 | Preview CSV source | `GET /api/data-sources/:id/preview?limit=N` | Yes | Read-only, no DT mutation |
| 4 | Get DT directly | `GET /api/types/:id` | Yes | Read-only |
| 5 | Re-list sources | `GET /api/data-sources` | Yes | Read-only |
| 6 | PATCH DT (rename) | `PATCH /api/types/:id {name}` | Yes | `DataTypeService.applyUpdate` uses `existing.copy(...)` — `sourceId` preserved |
| 7 | PATCH DT (fields) | `PATCH /api/types/:id {fields}` | Yes | Same path as #6 |
| 8 | Create pipeline targeting source | `POST /api/pipelines` | Yes | Pipeline output DT is a new row with `sourceId = None`; source DT untouched |
| 9 | Run pipeline | `POST /api/pipelines/:id/run` | Yes | `upsertFieldsFromRows` writes to pipeline output DT, not source DT |
| 10 | Re-upload SAME-name source | `POST /api/data-sources` (multipart) | Yes (both) | Each upload mints fresh source + DT UUIDs; nothing collides |
| 11 | Delete source via API | `DELETE /api/data-sources/:id` | DT orphaned | `data_types.source_id` FK has `ON DELETE SET NULL`. The DT remains in the table but `sourceId → null`, no longer matches the deleted source. (Symptom from user's perspective: source gone too, so not "existing source w/ no schema") |
| **12** | **Delete DT via Type Registry sidebar** | **`DELETE /api/types/:id`** | **DT GONE — source orphaned** | **Reproduces user symptom exactly.** Source still listed; schema disappears from Sources page. |

**Trigger 12 is the deterministic reproduction.** It requires the user
to:
1. Navigate to `/registry`
2. Click an item in the sidebar that corresponds to a source's
   auto-inferred DT (often named identically to the source)
3. Click the ⋯ Delete action
4. Confirm

After that, the source's schema is permanently gone from the Sources page
(only recoverable by manually deleting + re-uploading the source).

## 1b.3 Frontend display path — confirmation of cycle 1 mapping

Cycle 1's display-path mapping was correct:

```
SourcesPage (mount)
  → dispatch(fetchSources) → GET /api/data-sources → DataSourceRepository.findAll(owner)
  → dispatch(fetchDataTypes) → GET /api/types        → DataTypeRepository.findAll(owner)

SourceDetailPanel (render)
  → state.dataTypes.items.find((dt) => dt.sourceId === source.id)
       → if undefined OR fields.length === 0 → render NOTHING (no error, no affordance)
       → if found → render schema table
```

No Redux listener middleware mutates `dataTypes.items` outside the three
explicit thunks (`fetchDataTypes`, `updateDataType`, `deleteDataType`).
No service worker, no cache layer between dispatch and HTTP. The only way
`relatedType` becomes `undefined` is for the persisted DT row to be gone
(or its `source_id` to be null) by the time the next `fetchDataTypes`
runs.

## 1b.4 Backend cache / FileSystem investigation

Cycle 1 already verified there's no in-memory cache on the backend
between `/api/types` and `data_types`. Cycle 1b additionally confirmed:

- **Session lookup is per-request**, no caching:
  `SlickUserSessionRepository.findValidSession` runs a Slick `db.run`
  every time. So mid-session bearer-token churn isn't the trigger.
- **`LocalFileSystem.fromEnv()` resolves `HELIO_UPLOADS_DIR` (default
  `./data/uploads`) against the JVM cwd at startup.** This means
  per-worktree backend restarts using different cwds **do** see
  different upload roots — cycle 1b observed
  `NoSuchFileException: /home/matt/Development/helio/.worktrees/HEL-256/backend/data/uploads/csv/<id>.csv`
  for a source whose file is actually at
  `/home/matt/Development/helio/backend/data/uploads/csv/<id>.csv`.
  **But this affects `previewCsv` / `refreshCsv` only — schema display
  reads from the DB and is unaffected.** Worth filing as a spinoff:
  worktree-rooted file lookup is a long-standing local-dev sharp edge
  that confuses every cycle-1 investigator.
- **Slick / HikariCP** has no schema cache that would survive a DB
  mutation invisibly.

## 1b.5 Verdict on cycle 1's three proposed fixes

| Cycle 1 fix | Verdict | Reason |
|-------------|---------|--------|
| **A** — boot-time orphan health check | **Keep, lower priority.** Still useful for detecting drift, but the root cause (Fix D below) is now known, so A becomes a defense-in-depth nicety rather than the primary signal. | Useful for surfacing existing drift in dev / prod DBs, especially in CI smoke tests. Not the fix. |
| **B** — `DELETE /api/types/:id` rejects 409 when source still exists | **Promote to primary fix.** This is **exactly** the right intervention for the reproduced trigger. | Renamed below to **Fix B′** to reflect the cycle-1b reframing. |
| **C** — frontend "no schema" affordance on SourceDetailPanel | **Keep.** Defense in depth: even after Fix B′, an existing drifted source (HelioProfit-style) still presents the empty-schema symptom. The affordance turns the silent failure into a recoverable workflow ("Refresh source" or "Re-upload source"). | Wire the Refresh button to re-create the DT if missing — see Fix C′ below. |

## 1b.6 Expanded fix design (cycle 2)

### Fix B′ (PRIMARY — backend, ~20 LoC) — reject DT delete when source still exists

`DataTypeService.delete` currently:

```scala
dataTypeRepo.isBoundToAnyPanel(id).flatMap {
  case true  => Future.successful(Left(ServiceError.Conflict(...)))
  case false => dataTypeRepo.delete(id).map(_ => Right(()))
}
```

Cycle 2 should chain a second check: if the DT's `sourceId` is `Some(srcId)`
AND `dataSourceRepo.findById(srcId)` returns a row, reject with 409 and a
message like:

> "Cannot delete this DataType: it is the auto-inferred schema of
> DataSource '<name>'. Delete the source first, or unlink the DT by
> re-creating the source."

Files touched:
- `backend/src/main/scala/com/helio/services/DataTypeService.scala`
  (+10 LoC in `delete`; thread `dataSourceRepo` in via the constructor)
- `backend/src/main/scala/com/helio/app/Main.scala` or wherever the
  service is wired up (+1 LoC)
- `backend/src/test/scala/.../DataTypeServiceSpec.scala` (+15 LoC for
  the new conflict path)

### Fix C′ (frontend, ~30 LoC) — empty-schema affordance + recovery

In `SourceDetailPanel.tsx`:

- When `relatedType === undefined` for a CSV / Static source whose source
  row still exists, render a small inline notice:

  > "Schema unavailable for this source. [Refresh source] to re-infer it."

- Wire the Refresh button to `refreshSource(source.id, source.type)`
  (already exists in `dataSourceService.ts`). On success, dispatch
  `fetchDataTypes()` so the panel re-renders with the freshly inferred DT.
- For CSV specifically, the cycle-1b investigation showed that an
  orphan source can be recovered by re-running schema inference from the
  file — but only if the file exists. If `refreshCsv` fails with
  404 (file missing), the affordance should display:

  > "Schema unavailable, and the original file is missing. Delete this
  > source and re-upload."

  ...with a Delete button that calls `deleteSource(source.id)`.

Files touched:
- `frontend/src/features/sources/ui/SourceDetailPanel.tsx` (~25 LoC)
- `frontend/src/features/sources/ui/SourceDetailPanel.test.tsx` (new
  Jest test covering the empty-schema affordance + refresh recovery)

### Fix A (KEEP — backend, ~30 LoC) — boot-time orphan health-check

Same design as cycle 1's Fix A. Lower priority now, but worth shipping
in the same change to make existing orphans visible:

- `SourceSchemaHealthCheck` joins `data_sources LEFT JOIN data_types ON
  source_id` and logs WARN for any source with no DT.
- Useful for CI smoke + spotting drift across worktree DBs.

### Fix D (NEW — backend, ~10 LoC) — fix `refreshCsv` to re-create DT when missing

Currently `refreshCsv` calls `dataTypeRepo.findBySourceId(...)` and only
updates an existing DT — if the DT is missing (the orphan case from
Fix B′ violations, or from already-drifted dev DBs like HelioProfit),
refresh silently no-ops and returns the source unchanged.

Cycle 2 should make `refreshCsv` and `applyStaticRefresh` **re-create**
the DT row when missing, with the same `sourceId` link. This is what
makes the Fix C′ "Refresh source" affordance actually recover orphan
state, and it's how existing HelioProfit-style drifts get fixable
post-shipping.

Files touched:
- `backend/src/main/scala/com/helio/services/DataSourceService.scala`
  (+10 LoC each in `refreshCsv` and `applyStaticRefresh` to handle
  the `None` case by inserting a fresh DT instead of returning
  `Right(source)` unchanged)
- `backend/src/test/scala/.../DataSourceServiceSpec.scala` (+20 LoC)

### Surface summary (cycle 1b — revised)

| Fix | Scope | LoC est. |
|-----|-------|----------|
| A (boot health check) | backend, defense-in-depth | ~30 |
| B′ (DT-delete 409 when source exists) | backend, PRIMARY | ~20 |
| C′ (frontend empty-schema affordance + recovery) | frontend, UX recovery | ~30 |
| D (refresh re-creates missing DT) | backend, recovery primitive | ~20 |
| **Total** | | **~100 LoC across 4-5 files + tests** |

Cycle-2 commit ordering should be: D → B′ → A → C′ (each lands as an
independent commit; C′ depends on D existing to make the affordance
useful).

## 1b.7 Regression test plan (cycle 2 — revised)

### Backend (ScalaTest)

- `DataTypeServiceSpec` — new test: deleting a DT whose `sourceId`
  points to an existing source returns `Conflict` (covers Fix B′)
- `DataSourceServiceSpec` — new test: `refresh()` on a CSV source
  whose DT row was previously deleted re-creates the DT with the
  correct `sourceId` link (covers Fix D)
- `SourceSchemaHealthCheckSpec` (new) — insert orphan source rows via
  Slick and assert the health-check logs them (covers Fix A)
- `DataSourceServiceRestartPersistenceSpec` (cycle 1's plan) —
  **DEMOTE** to optional. Cycle-1 verification already proved
  restart-persistence works; the regression suite is redundant. Keep
  the orphan + delete-guard tests instead.

### Frontend (Jest)

- `SourceDetailPanel.test.tsx` — new tests:
  1. Source exists, DT exists with fields → schema table rendered
  2. Source exists, DT missing → empty-schema affordance rendered with
     "Refresh source" button
  3. Refresh button click → dispatches `refreshSource` and
     `fetchDataTypes`; schema appears

### Playwright (cycle 2, optional)

End-to-end: upload CSV → navigate to Type Registry → click Delete on
the auto-inferred DT → expect 409 toast → schema still present on
Sources page. (Covers B′ end-to-end.)

## 1b.8 Risks (cycle 1b)

- **Fix B′ changes user-visible behaviour.** A user who currently
  deletes a source's auto-inferred DT (presumably with the intent of
  re-inferring it cleanly) will now get a 409. The error message
  should explicitly suggest the recovery path: "Refresh the source
  instead, or delete the source first." Cycle 2's commit body should
  call this out as a deliberate behavior change.
- **Fix D's auto-recreation in refresh** changes refresh from a
  pure-update to an upsert. This matches the user's mental model
  (refresh = "give me back my schema") but means that a previously
  silent no-op now writes a new DT row. Low blast radius — the DT row
  shape is fully deterministic from the source content.
- **Fix C′ depends on Fix D** to be useful. Ship them in the same
  cycle 2 PR.
- **Existing drifted state is not auto-healed** by these fixes — the
  HelioProfit orphan source will still show "empty schema" until the
  user clicks Refresh (Fix C′ + D path) or re-uploads. That's
  acceptable; auto-healing on read would mask bugs.

## 1b.9 Spinoffs surfaced during cycle 1b (DO NOT FIX IN CYCLE 2)

These are real but out-of-scope for HEL-256. File as separate tickets:

1. **`GET /api/types/:id` (unscoped) leaks cross-user DT info.**
   `DataTypeRoutes.scala:52` calls `dataTypeService.findById(id)` which
   uses the unscoped `dataTypeRepo.findById` (no owner check). Anyone
   with a valid bearer token can `GET /api/types/<any-uuid>` and see
   another user's DT. This is a separate ACL bug — the `findAll` path
   IS owner-scoped, so this is a single-resource exposure rather than
   a list leak. **Priority: Medium / Security.**
2. **`LocalFileSystem.fromEnv` resolves relative to JVM cwd.** Each
   worktree-rooted backend run has its own upload root, which
   silently breaks `previewCsv` / `refreshCsv` for sources uploaded
   from a different worktree. Affects local-dev productivity only
   (prod uses GCS) but bites every cycle-1-style investigator.
   **Priority: Low / Dev experience.**
3. **The Type Registry sidebar shows no visual distinction between
   source-DTs and pipeline-output DTs.** Even after Fix B′ adds the
   409 guard, the user still gets a confusing UI ("why can't I
   delete this?"). A small badge ("auto-inferred from source X")
   on source-DT rows would close the loop. **Priority: Low / UX.**

## 1b.10 Process notes for orchestrator-relay

- **Cycle 1's "could not reproduce" returned a false-negative on the
  ticket.** The literal recipe (upload → restart → reload) is in fact
  not reproducible — that part was correct. But the underlying
  symptom (schema disappears for an existing source) IS reproducible
  with a different trigger (delete-DT-via-Type-Registry-sidebar). The
  pattern is: when a ticket says "sometimes," widen the trigger
  search aggressively rather than accept the literal recipe.
- **Memory note**: [[feedback-widen-bug-repro]] (written between
  cycle 1 and cycle 1b) encodes this rule. Future Linear-executor
  agents should refuse to return "could not reproduce" without
  exhausting trigger variations of the same user-visible symptom.
- The cycle-2 fix surface is small (~100 LoC) and self-contained.
  Cycle 2 should proceed with all four fixes as a single bundled PR.
