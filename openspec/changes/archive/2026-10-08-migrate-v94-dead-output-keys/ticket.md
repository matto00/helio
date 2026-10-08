# HEL-1387: V94-migrated Outputs hold dead config keys → label, unit, annotation, density, widths, timeline sort, collection layout silently lost

## Description

origin_kind: followup / origin_ticket: HEL-1313

HEL-1313's key enumeration found that migration V94 wrote Output config keys that nothing reads: `metricLabel`, `metricUnit`, `chartAnnotation`, `columnWidths`, `tableDensity`, `collectionOptions`, `timelineOptions`. HEL-877 also left dead `legend`, `tooltip`, `seriesColors` and `axisLabels`. Outputs created by that migration silently lose those settings at render. HEL-1313 (e93bebc32) keeps them readable (reads never validate, and a write may re-send them unchanged) but rejects adding or changing them.

Options offered: (1) a Flyway migration that renames each dead key to its live equivalent where the live key is absent, and drops keys with no live equivalent; (2) measure first; (3) leave as is.

## Owner ruling (Matt, 2026-10-08)

Option 1: write the migration. A Flyway migration renames each V94/HEL-877 dead key to its live equivalent where the live key is absent, never overwrites a live key, is idempotent, and drops keys that have no live equivalent. Proven RLS-safe as the non-BYPASSRLS role, with a test using a real pre-V94-shape fixture. Flyway version **V117** is assigned by the driver.

## Acceptance Criteria

1. A Flyway migration `V117__...sql` with the full dead→live mapping table in its header comment.
2. Idempotent: re-running its statements on already-migrated data changes nothing.
3. Never overwrites a live key.
4. Drops dead keys that have no live equivalent.
5. A test using a real pre-V94-shape fixture (`hel904-real-dump.sql` lineage), proving the rename/drop outcomes.
6. RLS-safe: proven applying as a non-superuser, non-BYPASSRLS, table-owning role (the prod `helio` shape; MISTAKES.md "RLS policies never run in dev or CI").
7. After the migration, HEL-1313's write validation accepts a re-sent (round-tripped) config of a migrated Output.
8. The PR reports the read-only dev-DB count of affected rows per dead key (prod count is owner-only).
