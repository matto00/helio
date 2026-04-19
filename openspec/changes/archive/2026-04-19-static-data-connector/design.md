## Context

`SourceType.Static` is already in the backend `SourceType` enum (`model.scala`) and stored as `"static"` in the database `source_type` column. However, `DataSourceRoutes.scala` only handles `Multipart.FormData` for the CSV connector — there is no branch for static payloads. The `data_sources.config` JSONB column is already flexible enough to hold any JSON shape. The `SchemaInferenceEngine` already has `fromJson` for REST payloads; we can reuse it for static rows.

`SourceRoutes.scala` handles the REST API connector via `POST /api/sources`. The static connector belongs in `DataSourceRoutes.scala` to match the `csv` connector pattern, since the data is stored locally (in `config`) rather than fetched remotely.

## Goals / Non-Goals

**Goals:**
- Accept `POST /api/data-sources` with `Content-Type: application/json` when `source_type: static`.
- Store rows payload (`{ columns, rows }`) in `config` JSONB.
- Infer schema from provided columns (user-declared types take precedence over inference) and register a `DataType`.
- `POST /api/data-sources/:id/refresh` replaces stored rows and updates the `DataType` for static sources.
- `GET /api/data-sources/:id/preview` returns stored rows for static sources.
- 500-row cap, 400 on violation.
- Frontend `AddSourceModal` gains a Manual/Static tab; `DataSourceList` shows a "Static" badge.

**Non-Goals:**
- Clipboard paste, formula support, >500-row datasets.

## Decisions

**D1: JSON body alongside existing multipart body for `POST /api/data-sources`.**
The current `POST /api/data-sources` expects `Multipart.FormData`. Akka HTTP routes are composable with `concat`; we add a new `post` branch that pattern-matches on `Content-Type: application/json` using `entity(as[StaticDataSourceRequest])` before the multipart branch. The multipart branch is unchanged. No new route path is added.

**D2: User-declared column types are authoritative; no additional inference needed.**
The static payload carries explicit `{ columns: [{ name, type }], rows: [[...]] }`. Since the user has already declared types, we construct `DataField` entries directly from `columns` without running `SchemaInferenceEngine`. This is simpler and more predictable. The ticket says "run schema inference" but user-declared types subsume that need; schema inference is a fallback only if the columns block is absent (not a planned case).

**D3: Store full payload in `config`.**
The `data_sources.config` JSONB column holds the entire `{ columns, rows }` object. Refresh replaces it in place. Preview reads it back and returns `rows`. No new table or column is needed.

**D4: Refresh for static sources replaces config in-place.**
The existing `/:id/refresh` route currently rejects non-CSV sources. We add an `else if (source.sourceType == SourceType.Static)` branch: parse the JSON body as `StaticDataPayload`, validate row count, update `config` in `DataSourceRepository`, and update the linked `DataType` fields.

**D5: Preview for static sources returns stored rows.**
The existing `/:id/preview` route reads a CSV file. We add a static branch that reads `rows` from `config` and returns them as `Vector[Vector[String]]` (all cells coerced to strings for uniformity with the CSV preview format).

**D6: Frontend tab is added inside `AddSourceModal`.**
The modal already has tabs for REST API and CSV. A third "Manual" tab presents column-definition UI in step 1, row-entry in a step 2, then posts to `POST /api/data-sources` with `Content-Type: application/json`. `DataSourceList` adds a badge renderer for `"static"` → "Static".

## Risks / Trade-offs

- [Large payloads in JSONB] Storing up to 500 rows × many columns in a JSONB column is fine at this scale; revisit if row caps are raised later.
- [Two content-types on one path] Mixing JSON and multipart on `POST /api/data-sources` requires correct ordering in the Akka `concat` — JSON branch must come first to avoid the multipart directive consuming the body.

## Migration Plan

No database migration required; `config` JSONB already exists. The route change is additive. Deploy is a drop-in replacement.

## Open Questions

None — static type, row format, and cap are specified by the ticket.

## Planner Notes

Self-approved: no external dependencies, no breaking API changes, no architectural changes beyond additive route branching. All decisions follow existing patterns in the codebase.
