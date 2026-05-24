## Context

Four repository files currently store JSON as `TEXT` in PostgreSQL and manually serialize/
deserialize on every read and write. The current Slick table definitions declare affected
columns as `column[String]`, and each `rowToDomain` / `domainToRow` call invokes
`.parseJson.convertTo[...]` and `.toJson.compactPrint` respectively.

The latest Flyway migration is `V32__pipelines_owner.sql` — the new migration will be `V33`.

Existing `MappedColumnType` patterns already exist in `DashboardRepository.scala`,
`PanelRepository.scala`, `DataSourceRepository.scala`, and `DataTypeRepository.scala` for the
`Instant ↔ java.sql.Timestamp` mapping. The JSONB mapping will follow the same local `implicit
val` pattern placed in each repository's companion object, keeping one mapping per file rather than
a shared `JsonbSupport` object (see Decision 2 below).

## Goals / Non-Goals

**Goals:**
- A single Flyway migration that `ALTER COLUMN ... TYPE JSONB USING ...::jsonb` for all seven
  columns across four tables
- A `MappedColumnType` (`jsonbStringType`) placed in each affected repository's companion object
  that maps `String ↔ JSONB` at the Slick boundary so the rest of the column type surface
  (`PanelRow`, `DashboardRow`, etc.) stays `String` — no domain type changes
- Remove all `.parseJson` / `.toJson.compactPrint` serialization calls that exist **only** to
  shuttle data to/from the DB; serialization that exists for other purposes (e.g. API response
  formatting) is untouched

**Non-Goals:**
- GIN index creation (deferred)
- Domain model or API contract changes
- Shared utility object / cross-file `JsonbSupport` (see Decision 2)

## Decisions

### Decision 1 — `MappedColumnType` keeps row fields as `String`
**Chosen**: Keep `*Row` case class fields typed `String`; define a Slick `MappedColumnType` that
maps `String` to the JSONB driver column. The mapping is transparent to every caller above the
repository layer.

**Alternative considered**: Change `*Row.appearance` etc. to `JsValue`/`JsObject`. Rejected
because it would require cascading type changes in `PanelRowMapper`, `DashboardRepository`, and
callers of `DataSourceRepository.parseStaticPayload` / `readRawConfig` — scope beyond this ticket.

### Decision 2 — Local `implicit val` per companion object, not a shared file
**Chosen**: Each repository companion object (e.g. `object DashboardRepository`) defines its own
`implicit val jsonbStringType` alongside the existing `implicit val instantColumnType`. This
follows the exact pattern already in use and keeps files self-contained.

**Alternative considered**: A shared `JsonbSupport` trait/object imported everywhere. Rejected
because it adds a new structural dependency for a four-line mapping — over-engineered for the
scope, and the inline pattern is already established for `Instant`.

### Decision 3 — Single Flyway migration for all four tables
All seven `ALTER COLUMN ... TYPE JSONB` statements go in one migration (`V33`). This is atomic at
the Flyway level and keeps the schema change reviewable as a single diff.

### Decision 4 — `PanelRowMapper` serialization removal
`PanelRowMapper.rowToDomain` calls `row.appearance.parseJson.convertTo[PanelAppearance]` and
`domainToRow` calls `p.appearance.toJson.compactPrint`. Both are replaced by direct use of the
`PanelAppearance` Spray JSON codec via the `jsonbStringType` mapping — the `String` that comes
out of Slick is still valid JSON (JSONB stores/returns lossless JSON text), so the parsing
layer is unchanged; only the responsibility moves from call site to mapping boundary.

## Risks / Trade-offs

- **Risk**: `ALTER COLUMN ... TYPE JSONB USING ...::jsonb` will fail if any row contains invalid
  JSON text in those columns. → Mitigation: run `SELECT COUNT(*) FROM <table> WHERE <col> IS NOT
  NULL AND <col>::text !~ '^[\[\{]'` against prod snapshot before deploying.
- **Risk**: Slick's JDBC metadata may not recognise `JSONB` as a known type; the driver maps it
  to `OTHER`. The `MappedColumnType` handles this — Slick sends/receives the value via
  `setString` / `getString`, which PostgreSQL JDBC accepts for JSONB columns.
- **Risk**: HEL-131 (PR #169) also modifies `DataTypeRepository.scala`. If both branches target
  main simultaneously, a merge conflict will occur on that file. → Mitigation: documented in PR;
  rebase after HEL-131 merges.
- **Trade-off**: Row fields stay `String`, so null-safety for JSONB is not improved. A future
  ticket can tighten this if needed.

## Migration Plan

1. Flyway `V33__jsonb_columns.sql` — `ALTER COLUMN` for all seven columns in one transaction
2. Backend code changes (four repos + `PanelRowMapper`) committed in the same change as the
   migration
3. Deploy: `sbt run` applies V33 on startup; no manual step required
4. Rollback: a `V34__jsonb_revert.sql` that casts each column back to `TEXT` would be needed
   if a hotfix is required — not included in this ticket

## Open Questions

- None; all decisions are self-approved per proposal scope.

## Planner Notes

Self-approved. No new external dependencies. No API contract changes. No AuthService
modifications. Overlap with HEL-131 on `DataTypeRepository.scala` is noted and will be
documented in the PR description.
