# HEL-1424: Show blank categories as "(blank)" instead of "null" in charts, history and selection headers; stored schemas say nullable:false for all-blank columns

## Description

origin_kind: followup
origin_ticket: HEL-1408

Filed per owner ruling Q7 on HEL-1408 (accept the "null" label now, follow up with "(blank)").

1. Since HEL-1408 (7ed15758), a group of blank CSV values is labelled "null" in aggregated charts and history. Show "(blank)" (DESIGN.md copy) in chart categories, history labels and the empty "team: " cross-filter selection header. Keep click-to-select and "Filter dashboard" working on blank rows (HEL-1408 made those match null; don't regress them).
2. Pre-existing, found by HEL-1408's final skeptic: stored CSV and Output schemas say `nullable:false` even for all-blank columns. Correct nullability inference.
3. Test nits from HEL-1408's evaluator: add the timestamp cast to the `eq ""` snapshot test; add an explicit null-row count assertion to the lookup test.

## Acceptance Criteria

- AC1: Null/blank category groups display the owner-pinned blank label (not "null") on every owner-pinned surface (chart categories, history labels, cross-filter selection header), while click-to-select and "Filter dashboard" on blank rows keep matching null rows exactly as HEL-1408 made them.
- AC2: Stored CSV and Output schema nullability is correct: a column with blank/null values (including all-blank) reports `nullable: true` wherever the API reports schema nullability for that source/Output.
- AC3: `CsvBlankCellsNullSnapshotSpec`'s `eq ""` test covers `SortCast.AsTimestamp`; the `CsvBlankCellsNullStepsSpec` lookup test asserts an explicit null-row count.

## Driver constraints

- Stay clear of the shared timestamp parser and cast output (HEL-1502 in flight, PR #985).
- Any backfill migration of stored schemas is an owner product call; next free migration is V130 (re-check before claiming). If a data migration ships, the PR body carries a read-only prod count query.
