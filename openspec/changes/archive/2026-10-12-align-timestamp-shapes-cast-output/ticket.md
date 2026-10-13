# HEL-1502: After HEL-1314: timestamptz "+00" shape; scientific-notation epoch cast; cast vs datebucket/compute shape divergence; shared disclosure-summary CSS

## Description

These follow-ups came from HEL-1314 (matto00/helio#952, 48931ae90), which added `seconds_between`/`date_trunc`/`add_days` and the shared `TimestampParsing.parseInstant` (used by cast, datebucket, compute and the window day frames).

1. **Postgres `timestamptz` text** such as `"2026-07-01 12:00:00+00"` (no colon in the offset) isn't an accepted shape, so compute, datebucket and window day frames read it as null. This is common in SQL-sourced data. Decide whether to accept it (a product call on the accepted shapes; the owner ruled "datebucket shapes" for HEL-1314).
2. **Casting a JSON-number epoch to timestamp** emits scientific notation (`"1.7712864E9"`). It parses, but it's ugly in output. Emit ISO instead.
3. **Cast keeps `MM/dd/yyyy` and region-zoned ISO strings,** which datebucket and compute read as null (HEL-1436 D3 divergence). Decide whether to align them.
4. **One shared disclosure-summary CSS recipe:** the compute Functions summary duplicates `.usage-card__summary`, and both have marker and 44px touch-floor gaps.
5. **Minor:** `"-9223372036854775808"` (`Long.MinValue`) now parses as epoch milliseconds (it used to throw).
6. **UI nit:** in the Functions list, the spacing between entries equals the spacing inside an entry. Use `--space-2` between entries.

HEL-1491 already covers the fillnull mean/median and union type spinoffs.

## Acceptance Criteria

Each numbered item above is either delivered or explicitly resolved by an owner ruling recorded in this change (see design.md "Owner rulings"). Product calls (items 1, 2's canonical output shape, 3, 5) are decided by the owner, not assumed.

## Premise validation (orchestrator, 2026-10-12, against 000c1dfa5)

Item 4 is partially stale: the compute Functions summary already has an explicit chevron marker and `tap-expand-44`; `.usage-card__summary` has neither. Every other item reproduces on main. See `.concertino/runs/HEL-1502/evidence/premise-validation.md`.
