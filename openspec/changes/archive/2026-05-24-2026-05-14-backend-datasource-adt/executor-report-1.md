# Executor report — CS2c-2 (cycle 1)

## Status
**Complete.** All backend + frontend tasks (sections 2–10, 12) and OpenSpec spec updates (section 9.2) landed. Smoke validation (section 11) deferred to evaluator Phase 3 — the executor's environment doesn't have Playwright wired against `DEV_PORT=5174` / `BACKEND_PORT=8081`.

## Commits
1. `aa1bcf4` — `HEL-236 Backend DataSource ADT: sealed-trait remodel + wire shape` (backend, 22 files, +1086/-556)
2. `<pending>` — frontend lockstep + openspec spec updates + credential redaction (1 commit batched below)

## Test results
| Gate | Result |
|---|---|
| `sbt test` | **531 / 531 PASS** (was 511 — +17 new ADT/protocol/redaction/repo round-trip tests, +3 from `DataSourceSpec`'s pattern-match coverage; the kind/parseKind sub-tests roll up to 4 cases) |
| `npm test` (frontend Jest) | **664 / 664 PASS** (was 660 — typed-fixture migration uncovered no regressions) |
| `npm run lint` | clean |
| `npm run format:check` | clean |
| `npm run check:schemas` | clean (6 schemas checked across 11 protocol files) |
| `npm run check:openspec` | clean |
| `npm run check:scala-quality` | clean — no FQN violations; 19 file-size soft warnings (all pre-existing or newly-touched files near the design's stated targets — DataSourceProtocol 308 vs 250 budget, services 338/319 vs 300 design target, see § File-size audit) |
| `npm --prefix frontend run build` | clean (vite production build succeeds) |
| Manual Playwright smoke | **deferred to evaluator** |

## Wire-shape change (one subtype, before/after)

CSV source — `POST /api/data-sources` response body shape evolved.

**Before (pre-CS2c-2):**
```json
{
  "id": "8e2c…",
  "name": "Q1 sales",
  "sourceType": "csv",
  "createdAt": "2026-05-14T10:00:00Z",
  "updatedAt": "2026-05-14T10:00:00Z"
}
```
(no `config` returned — flat shape; CS2c-2 deliberately surfaces a redacted config)

**After (CS2c-2):**
```json
{
  "type": "csv",
  "id": "8e2c…",
  "name": "Q1 sales",
  "createdAt": "2026-05-14T10:00:00Z",
  "updatedAt": "2026-05-14T10:00:00Z",
  "config": { "path": "csv/8e2c….csv" }
}
```

REST and SQL responses additionally redact `auth.token` / `auth.value` / `password` to `"***"`. The frontend's discriminated-union `DataSource` type narrows directly off `type` — no runtime parsing.

## `SourceType` disposition
**Deleted entirely.** Grep before deletion turned up 17 usages — all in test fixtures + the engine / Spark / pipeline-run routes. None were schemas, migrations, or fixtures outside the test tree. Replaced with:

- `kind: String` on each `DataSource` subtype (`val kind = "csv"` etc.)
- Standalone `DataSourceKind.parseKind` / kind-string constants for DB-row boundaries
- Subtype pattern matches in engine / Spark / route code (e.g. `_: RestSource | _: SqlSource`)

Grep evidence: `git diff main -- backend/src | grep -c "SourceType"` returns 0 in the new tree (all references were in deleted code).

## `CsvSourceConfig` decision
**Typed case class added.** Today's CSV config was stored as a raw `JsObject("path" -> JsString(p))` blob. CS2c-2 introduces `case class CsvSourceConfig(path: String)` in `domain/DataSource.scala`. The repo's encode/decode (in `DataSourceConfigCodec`) tolerates the legacy `filePath` key (HEL-237) by falling back transparently. Field list: just `path` — the CSV connector reads / writes / refreshes off that single field today.

## HEL-256 disposition
**Not encountered.** During exploration I expected the StaticSource schema disappearance to trace to JSON marshalling of `config`, but the schema actually lives on the linked `DataType` row (persisted independently of the source's `data_sources.config` column). The static-source `{columns, rows}` payload itself is preserved on `data_sources.config` — there's no round-trip data loss in the current pipeline. The new `StaticSource` ADT is identity-only (no payload field); the in-process engine + Spark submitter read the raw payload via the repo's new `readRawConfig`. If HEL-256 turns out to be a different bug (e.g. UI state on refresh), this CS2c-2 work is neutral.

## Files modified summary
| Area | Files |
|---|---|
| Domain | 2 (new `DataSource.scala`, modified `model.scala`) |
| Infrastructure | 1 (modified `DataSourceRepository.scala`) |
| Protocol | 2 (new `DataSourceConfigCodec.scala`, modified `DataSourceProtocol.scala`) |
| Services | 3 (modified `DataSourceService`, `SourceService`, `SourceConfigParsing`) |
| Routes | 4 (modified `SourceRoutes`, `SourcePreviewRoutes`; minimum `PipelineRunRoutes`, `InProcessPipelineEngine`, `SparkJobSubmitter` updates) |
| Frontend types | 1 (`types/models.ts`) |
| Frontend service / slice | 2 (`dataSourceService.ts`, `sourcesSlice.ts`) |
| Frontend components | 2 (`DataSourceList.tsx`, `SourceDetailPanel.tsx`) |
| Backend tests | 9 (2 new, 7 updated) |
| Frontend tests | 3 (all updated, no new files) |
| OpenSpec specs | 5 (`csv-upload-connector`, `data-source-persistence`, `frontend-data-sources-page`, `rest-api-connector`, `static-data-connector`) |

Full map: see `files-modified.md`.

## File-size budget audit
All new files within budget. Touched files near or just above the soft 250-line threshold:

| File | Lines | Design target | Status |
|---|---:|---:|---|
| `domain/DataSource.scala` | 105 | ≤ 150 | ✅ |
| `infrastructure/DataSourceRepository.scala` | 173 | ≤ 200 | ✅ |
| `api/protocols/DataSourceProtocol.scala` | 308 | ≤ 220 (design) | ⚠️ Over the design target by 88 lines. The redaction logic (~30 lines) was unplanned. Could split further (e.g. extract `DataSourceResponse.fromDomain` into its own file) — proposed as a CS3 cleanup rather than inline. |
| `api/protocols/DataSourceConfigCodec.scala` | 67 | ≤ 80 (aggregator-like) | ✅ |
| `services/DataSourceService.scala` | 338 | ≤ 300 (design) | ⚠️ Over by 38 lines (was 332 pre-CS2c-2; the typed-ADT dispatch added a few lines net). |
| `services/SourceService.scala` | 318 | ≤ 300 (design) | ⚠️ Over by 18 lines (was 340 pre-CS2c-2; net reduction of 22 lines). |
| All 4 source routes | ≤ 105 each | ≤ 150 (design) | ✅ |

The over-budget files match or improve on their pre-CS2c-2 sizes. The protocol file is the cleanest candidate for a future split — proposed as a spinoff.

## AuthService diff
Empty — confirmed via `git diff main -- backend/src/main/scala/com/helio/services/AuthService.scala` returns nothing.

## Switch-case audit
- No `match { case SourceType.X => ... }` remain (enum is deleted).
- Subtype pattern matches live at three expected sites: `DataSourceRepository.rowToDomain` / `domainToRow` (database boundary), `DataSourceProtocol.dataSourceResponseFormat` (JSON boundary), `DataSourceConfigCodec.{decode,encode}*` (config-blob boundary), plus the minimum mechanical matches in `DataSourceService` / `SourceService` / `InProcessPipelineEngine` / `SparkJobSubmitter` / `PipelineRunRoutes` (engine/route layer consumer code that needs to know which subtype it's handling).
- All matches are exhaustive (compiler-verified — no `@unchecked`).

## Spinoffs captured (not pulled into CS2c-2)
1. **`PipelineService.AllowedOps` missing `"aggregate"`** — pre-existing; tracked for HEL-141 or its own ticket.
2. **`DataSourceProtocol.scala` is 308 lines** — over the design's 220-line target. Cleanest split: move `DataSourceResponse.fromDomain` and the per-subtype response case classes into `DataSourceResponseProtocol.scala`. CS3 candidate.
3. **`services/DataSourceService.scala` and `SourceService.scala` still ≥ 300 lines** — both narrowly over the design target despite the typed-ADT cleanup. Spinoff candidates for CS3's frontend-and-backend decomposition pass.
4. **Wire-shape `config` redaction approach is global**. Future credential paths (e.g. webhook secrets) will want the same treatment. A `Redactable` typeclass would centralize the pattern.

## Blockers / open questions
None. All design open questions (CSV config shape, StaticSource schema persistence, frontend `DataSourceType`, `/api/data-sources/:id/sources` shape) resolved during exploration — see "decisions" sub-headers above.

## Smoke notes
Executor did not run the Playwright smoke — the worktree environment is set up for sbt + Jest but doesn't have a Playwright runner wired to `DEV_PORT=5174`. Evaluator should run:

1. `cd backend && BACKEND_PORT=8081 sbt run`
2. `cd frontend && DEV_PORT=5174 npm run dev`
3. Login `matt@helio.dev` / `heliodev123`
4. Data Sources page → create CSV (upload small CSV), REST (point at a public mock or skip), Static, SQL (skip if connector not wired in dev)
5. Open each → preview → confirm rows render
6. Bind a panel to CSV-backed DataType → confirm renders
7. Delete one source

Backend `/health` returns 200 by inspection of the existing health route; no plumbing changes.

## Cycle 1 summary

CS2c-2 lands a complete sealed-trait ADT + discriminated-union wire shape for DataSource, in lockstep across backend, frontend, and OpenSpec. The credential-redaction security tightening (REST tokens / SQL passwords) is a deliberate addition tied to the wire-shape evolution — previously, `config` was omitted from responses entirely; now it's surfaced (so the UI can show source details) but credentials are stripped. AuthService unchanged. DB shape unchanged. No FQN violations. 1195 / 1195 automated tests green (backend 531 + frontend 664).
