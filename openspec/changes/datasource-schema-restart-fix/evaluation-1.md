## Evaluation Report — Cycle 2

Independent verification by the linear-evaluator of HEL-256 cycle-2 delivery.
The executor explicitly deferred Playwright Phase 3; this report fills that
gap with a live end-to-end exercise of all four fixes (B′ / D / A / C′) on
the dev DB through the worktree's backend + frontend.

### Phase 1: Spec Review — PASS

- Linear AC #1 (CSV upload → restart → schema intact) covered by `DataSourceServiceRestartPersistenceSpec` (CSV case) and by the surviving smoke sources rendering correctly after backend bounce.
- Linear AC #2 (regression test for CSV + static + SQL) covered by the three explicit cases in `DataSourceServiceRestartPersistenceSpec`.
- Linear AC #3 (root cause documented) covered by cycle-1b appendix in `executor-report-1.md`, by `design.md` §"Cycle 1b — Updated root cause and fix design", and by each fix's commit message.
- `tasks.md` cycle-2 checklist is fully `[x]` except the optional Playwright item — which this evaluator just performed.
- No scope creep: the diff touches only the four fixes' files plus their tests and the change folder. The three cycle-1b spinoffs (`GET /api/types/:id` ACL, `LocalFileSystem.fromEnv` cwd resolution, sidebar visual distinction) are untouched — confirmed by diff.
- OpenSpec artifacts reflect the final implementation (proposal/design/tasks all updated; executor-report-2 enumerates exactly what landed).

### Phase 2: Code Review — PASS-WITH-NOTES

#### CONTRIBUTING.md compliance — pass

- No inline FQNs; `npm run check:scala-quality` clean. The one place that legitimately spells out a long type (`org.slf4j.Logger` in `Main.scala` callsite) is on a single line and reads naturally.
- File-size table (verified via `wc -l`):

| File | LOC | Budget | Status |
|---|---|---|---|
| `DataSourceService.scala` | 354 | 400 hard cap | pass (was already soft-warned pre-cycle-2; net +17) |
| `DataTypeService.scala` | 162 | 250 soft | pass (+22) |
| `SourceSchemaHealthCheck.scala` | 66 | 250 soft | pass (new) |
| `Main.scala` | 116 | 250 soft | pass (+5) |
| `SourceDetailPanel.tsx` | 134 | 250 soft | pass (+2) |
| `EmptySchemaAffordance.tsx` | 72 | 250 soft | pass (new) |

No new soft warnings introduced.

#### Per-fix diff sanity check

- **Fix B′** (`DataTypeService.scala`): `checkSourceLink` runs before the existing panel-bound check, queries `dataSourceRepo.findById(srcId)`, short-circuits on `sourceId = None` (so the legitimate "source already deleted; cascade SET NULL" path still allows deletion), and returns `Conflict` with a message that names the source and surfaces both Refresh and "delete the source first" recovery paths. Wired through `ApiRoutes` constructor.
- **Fix D** (`DataSourceService.scala`): both `applyStaticRefresh` and `refreshCsv` route through a shared `upsertSourceDataType` helper that branches on `dataTypeRepo.findBySourceId` and inserts a fresh DT with `sourceId = Some(source.id)`, `version = 1` when missing. CSV file-missing is caught at the `fileSystem.read(...)` boundary via `.recover { case _: NoSuchFileException => Left(BadRequest(...)) }`, with the documented "missing on disk … re-upload" message.
- **Fix A** (`SourceSchemaHealthCheck.scala` + `Main.scala`): single-shot `LEFT JOIN data_sources LEFT JOIN data_types ON dt.source_id = ds.id WHERE dt.id IS NULL` query; logs WARN with id / name / owner / kind / actionable recovery hint per orphan, INFO when clean. Wired into `Main` immediately after `DemoData.seedIfEmpty`; doesn't block boot.
- **Fix C′** (`SourceDetailPanel.tsx` + `EmptySchemaAffordance.tsx`): affordance renders when `relatedType` is missing OR `relatedType.fields.length == 0`; "Refresh source" dispatches `refreshSource(source.id, source.type)` and re-fetches `dataTypes` on success; "Delete and re-upload" dispatches `deleteSource`; alert region shows the caught error message.

#### Per-spec sanity check

- `DataTypeServiceSpec` — 3 cases as advertised: (1) 409 on source-linked DT, (2) pipeline-output DT deletes normally (sourceId=None), (3) cascade SET NULL after source delete still allows DT cleanup. Each truly exercises the new code path.
- `DataSourceServiceSpec` — 4 cases: CSV refresh updates linked DT, CSV refresh re-creates missing DT (Fix D), CSV refresh on missing file → BadRequest with the right two substrings, Static refresh re-creates missing DT. Field assertions check the new DT's `sourceId` link.
- `DataSourceServiceRestartPersistenceSpec` (new, AC #2) — 3 cases: CSV / Static / SQL each persist source + DT + sourceId link after the service stack is rebuilt against the same `Database`. Simulating restart via service re-instantiation rather than JVM bounce is a sound choice — the persistence contract is purely DB durability + repository read.
- `SourceSchemaHealthCheckSpec` — 4 effective cases (`findOrphans` × 3 + `run` × 1): healthy DB → empty, mixed DB → returns just the orphans, pipeline-output DTs don't false-flag healthy sources, `.run` exercises the logging path end-to-end without throwing.
- `SourceDetailPanel.test.tsx` — 4 cases: schema render path unchanged, affordance renders with both buttons when DT missing, click dispatches `refreshSource` + re-fetches dataTypes, refresh failure renders error in `[role="alert"]`.

#### Non-blocking finding (Phase 2/3 boundary) — backend message leakage

The Jest test for the failure-alert path mocks `refreshSource` to throw a stock `Error("Source file is missing on disk")`, so the test sees the right text in `[role="alert"]`. But in production, `refreshSource` uses `httpClient` (axios), and axios's `Error.message` for an HTTP failure is the generic `"Request failed with status code 400"` — the backend's actionable `"Source file is missing on disk; the source can no longer be refreshed. Delete this source and re-upload the file."` lives on `err.response.data.message`. The current `EmptySchemaAffordance` catch block reads only `err.message`, so the user sees the generic string instead of the actionable one.

Pattern reference: `authSlice.ts`, `dashboardsSlice.ts`, and others in this codebase use `isAxiosError(err) && typeof err.response?.data?.message === "string" ? err.response.data.message : ...`.

Verified live on the dev backend during Phase 3 scenario 4d — after moving the underlying CSV off disk and clicking Refresh source, the affordance's alert displayed `"Request failed with status code 400"` (see `hel256-error-message-leakage.png`). The 400 status and backend body are correct; only the UI presentation is wrong.

This is a real Fix C′ implementation gap (a fallback affordance message that doesn't surface the recovery hint defeats the affordance's purpose), but it's bounded and small — it doesn't break the happy path or Fix B′, both of which work end-to-end. Recommendation below treats it as a Non-blocking Suggestion that can land in a quick follow-up or be folded into this PR.

#### Other code-review checks

- DRY: shared `upsertSourceDataType` helper de-duplicates two near-identical update blocks (Fix D was a textbook DRY win, not just a fix).
- Type safety: no new `any`; one `unknown` in the affordance catch is correctly narrowed.
- Error handling at boundaries: backend wraps the `NoSuchFileException` at the file-read boundary; frontend wraps the axios reject (modulo the leakage note above).
- No dead code, no leftover TODOs in the changed surfaces.

### Phase 3: UI / Playwright Review — PASS

Executed live against the worktree's backend on port 8320 and frontend on 5413, logged in as `matt@helio.dev`.

| # | Scenario | Result |
|---|----------|--------|
| 1 | Fresh CSV upload (HEL256EvalCsv, 3 cols × 5 rows) → schema renders normally; no affordance. | PASS |
| 1b | `DELETE /api/types/<auto-DT-id>` → returns **409** with body `"Cannot delete this DataType: it is the auto-inferred schema of data source 'HEL256EvalCsv'. Refresh the source to re-infer its schema, or delete the source first."` (Fix B′). | PASS |
| 2a | Manual orphan via direct `DELETE FROM data_types` + page reload → `EmptySchemaAffordance` renders with the dashed border, "Schema not available" heading, both action buttons. `[aria-label="Inferred schema"]` correctly absent. (Fix C′). Screenshot: `hel256-affordance.png` | PASS |
| 2b | Click "Refresh source" → DT recreated (new id `71340b3a-…`), correctly linked to source with all 3 original fields (`product`, `price`, `quantity`), affordance disappears, schema table re-renders. (Fix D + Fix C′ together). | PASS |
| 3 | Real backend boot log on port 8320 emitted: `WARN SourceSchemaHealthCheck: found 1 data source(s) with no linked DataType. …` followed by per-orphan WARN `orphan source id=32f495cd-… name='HelioProfit' owner=0632ca2e-… kind=csv — heal via POST /api/data-sources/32f495cd-…/refresh`. (Fix A). | PASS |
| 4a | Delete a pipeline-output DT (sourceId=None, inserted directly via psql) → **204**. B′ guard correctly short-circuits when `sourceId.isEmpty`. | PASS |
| 4b | Delete source → cascade SET NULL → DT row remains with sourceId=null. Then DELETE that DT → **204**. The cycle 1b-documented cleanup path still works. | PASS |
| 4c | Refresh a healthy source (CSV with linked DT present) → 200, same DT id retained, `version` bumped 1 → 2, fields preserved. Pre-fix update-only behaviour preserved when DT exists. | PASS |
| 4d | CSV refresh after `mv` of the underlying file → backend returns **400** with the exact actionable body: `"Source file is missing on disk; the source can no longer be refreshed. Delete this source and re-upload the file."` (Fix D's BadRequest path). Frontend affordance shows an alert, but it reads "Request failed with status code 400" instead of surfacing the backend message — see Phase 2 non-blocking note. Screenshot: `hel256-error-message-leakage.png` | PASS (backend), PASS-WITH-NOTE (frontend) |
| 5 | Normal upload flow (HEL256RegressCsv, 3 cols × 2 rows) → schema visible, no affordance, no console errors. | PASS |

Console error scan across the whole session: every error was either (a) an intentionally-tested 4xx (409 / 400 / 405) or (b) the pre-existing benign `https://test/snap.png` image 404 from existing seed data. No unhandled runtime exceptions.

#### Static gates (re-verified independently)

| Gate | Result |
|---|---|
| `cd backend && sbt test` | **605/605** passed (exit 0) |
| `npm test` | **673/673** passed (exit 0) |
| `npm run lint` | clean (exit 0) |
| `npm run format:check` | clean (exit 0) |
| `npm run check:schemas` | clean (exit 0) |
| `npm run check:openspec` | clean (exit 0) |
| `npm run check:scala-quality` | clean (exit 0) |
| `npm --prefix frontend run build` | green (exit 0) |

### Behavior-preservation diff scan

Deletions in `*.scala`, `*.ts`, `*.tsx` map 1-to-1 to the documented fix points:

- Fix B′: removed the old `case Some(_) => isBoundToAnyPanel(...)` branch in favour of the source-link check + the unchanged panel check.
- Fix D: removed two near-identical "if DT found, update; else, no-op" blocks in `applyStaticRefresh` and `refreshCsv` in favour of the shared `upsertSourceDataType` helper.
- Fix C′: removed the `: null` branch in `SourceDetailPanel`'s schema JSX in favour of `<EmptySchemaAffordance source={source} />`.
- ApiRoutes: removed the 3-arg `new DataTypeService(...)` in favour of the 4-arg call.

No drive-by deletions. No accidental behaviour changes to ingestion, panel binding, pipelines, ACLs, or `LocalFileSystem`.

### Spinoff scope discipline check

Verified via `git diff main...HEAD -- ...`:

- `LocalFileSystem*` — no changes (HEL-269 untouched).
- `SidebarBody*` — no changes (HEL-270 untouched).
- `DataTypeRoutes.scala` — no changes (HEL-268 untouched). Only `DataTypeRoutesSpec.scala` was updated, and only to pass the new constructor arg.

Clean separation; cycle-2 stayed inside the fix surface.

### Acceptance criteria sweep (Linear ticket)

1. **Upload CSV → restart → schema intact** — covered by the CSV case in `DataSourceServiceRestartPersistenceSpec`, plus live Playwright scenario 5 + 1 against a real backend.
2. **Restart-persistence regression test covers CSV + static + SQL** — covered by the three explicit cases in `DataSourceServiceRestartPersistenceSpec`. SQL case writes directly through `DataTypeRepository` because SQL ingest lives behind `SourceService` rather than `DataSourceService`, which is the right level for the persistence contract.
3. **Root cause documented** — `executor-report-1.md` §1b documents the deterministic trigger (Type Registry DT-delete on a source's auto-inferred DT); commit `afa1f6d` is `HEL-256 cycle 1b: reproduced via Type Registry DT-delete; revised fix design`.

### Overall: PASS-WITH-NOTES

All four fixes work end-to-end on the live worktree. The one Fix C′ UX gap (axios error.message leaks instead of backend message) is bounded, small, and easy to fix; it does not invalidate the headline result that the user-visible orphan symptom now has both a prevention and a recovery path.

### Non-blocking Suggestions

1. **EmptySchemaAffordance error unwrap** — in `frontend/src/features/sources/ui/EmptySchemaAffordance.tsx` `handleRefresh`, replace
   ```ts
   const message = err instanceof Error && err.message ? err.message : "Failed to refresh source.";
   ```
   with the codebase's established axios-aware unwrap (see `authSlice.ts:67-68`, `dashboardsSlice.ts:160-161`):
   ```ts
   const message =
     isAxiosError(err) && typeof err.response?.data?.message === "string"
       ? err.response.data.message
       : err instanceof Error && err.message
         ? err.message
         : "Failed to refresh source.";
   ```
   Then update the Jest test to mock the rejected value as an axios-shaped error (or add a second case) so the unwrap is exercised. Without this, Fix C′'s missing-file fallback message — which is the whole point of the affordance when refresh fails — never reaches the user.

2. **HelioProfit orphan in dev DB** — Fix A's WARN line is already revealing one orphan owned by user `0632ca2e-…` (not matt). Worth a short ops note: just hit `POST /api/data-sources/32f495cd-4c21-41c9-a81c-00a8ee7804c0/refresh` (now an upsert per Fix D) to heal it, or roll it into the HEL-267 dev-DB cleanup.

3. **Cycle-1b spinoffs already filed** (HEL-268 ACL, HEL-269 cwd, HEL-270 sidebar) — confirmed untouched, ready for separate prioritisation.

### Recommendation for orchestrator-relay

**Ready to open PR**, with the suggestion to either fold Suggestion #1 into this PR (small, ~6 LOC + a test) or to file it as an immediate follow-up before merge. The headline fix (Fix B′ closes the deterministic trigger; Fix D + C′ heal historical drift; Fix A surfaces it) is solid and verified live. No cycle 3 needed.
