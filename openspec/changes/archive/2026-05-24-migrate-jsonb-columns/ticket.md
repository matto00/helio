# HEL-132 — Migrate TEXT JSON columns to JSONB

## Title
Migrate TEXT JSON columns to JSONB

## Description
Several columns store JSON as plain `TEXT`, requiring manual serialization/deserialization on every read and write. Switching to PostgreSQL's native `JSONB` type removes parse overhead, validates JSON at the DB level, and enables GIN indexing if needed in future.

## Affected Columns

| Table | Column | Used in |
| -- | -- | -- |
| `dashboards` | `appearance`, `layout` | `DashboardRepository.scala` |
| `panels` | `appearance`, `field_mapping` | `PanelRepository.scala` |
| `data_sources` | `config` | `DataSourceRepository.scala` |
| `data_types` | `fields`, `computed_fields` | `DataTypeRepository.scala` |

## Tasks

* Add a Flyway migration to `ALTER COLUMN ... TYPE JSONB USING ...::jsonb` for each column above
* Update Slick table definitions to use a custom `JdbcType` mapping (or `String` columns with a `JSONB` cast) — Slick doesn't have native JSONB support so the typical approach is a `MappedColumnType` that maps `String <-> JSONB`
* Remove manual `.parseJson` / `.toJson.compactPrint` calls in each repository; serialization should happen once at the mapping boundary

## Notes

* This is a non-trivial migration — test against a copy of the prod DB before rolling out
* No API contract changes; purely internal storage format

## Priority
Medium

## Project
Helio v1.3.1 — Polish & Hardening

## Constraints (from orchestrator)
- Commit messages prefixed with HEL-132
- Keep schema updates in the same change as related client/server code
- Structural refactors must be behavior-preserving
- NO inline fully-qualified names (hard-fails the pre-commit hook)
- Do NOT modify AuthService (security-sensitive, off-limits)
- Base off main; three open PRs (#169 HEL-131, #170 HEL-127, #171 HEL-278) are open but do not overlap with DashboardRepository.scala, PanelRepository.scala, DataSourceRepository.scala, DataTypeRepository.scala

## Open PR Overlap Note
HEL-131 (PR #169) touches DataTypeRepository.scala and PanelService.scala.
HEL-132 also touches DataTypeRepository.scala — flag in PR that a rebase may be needed after HEL-131 merges.
