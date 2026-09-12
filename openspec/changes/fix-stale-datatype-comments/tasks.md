## 1. Confirm item 1 (StaticSource/DatasetSource scaladoc)

- [x] 1.1 Re-verify `DataSource.scala`'s `DatasetSource` scaladoc (lines ~9-19, ~146-158) matches
      current behavior; do NOT edit if already correct (it is, per premise validation) — state so
      in the triage record.
- [x] 1.2 Verify `DataSource.scala:44`'s inferredSchema-backfill claim ("until the data-migration
      step (tasks.md §2.9) backfills it") against current behavior; note whether the backfill has
      landed and whether the comment still needs updating.

## 2. Sweep backend/src/main for stale DataType/type-registry/snapshot-row references

- [x] 2.1 Grep `DataType\b|type registry|snapshot.?row` (case-insensitive) across
      `backend/src/main/**/*.scala`.
- [x] 2.2 Classify every hit: accurate-historical / unrelated-identifier / genuinely-stale /
      uncertain (see design.md Decision 2). Check `DashboardAuthoringService.scala:261` and
      `PanelServiceHelpers.scala:192` first (flagged suspects).
- [x] 2.3 Fix or delete every genuinely-stale hit only.
- [x] 2.4 Write the full classification (per-file or per-hit, with counts per bucket) into
      `openspec/changes/fix-stale-datatype-comments/triage-findings.md`, and include the same
      summary (counts per bucket + genuinely-stale list) in the PR body per AC.
- [x] 2.5 If uncertain+genuinely-stale count is large (>~15), flag for orchestrator escalation
      instead of guessing.

## 3. Fix the MCP wire-literal

- [x] 3.1 Change `helio-mcp/src/helioApi.ts:456` from `type: "static"` to `type: "dataset"`.
- [x] 3.2 Fix the stale docstring one line above it (`helioApi.ts:444`, "Create a `static` data
      source") so it doesn't describe the retired word right next to the fixed literal.
- [x] 3.3 Confirm `helioApi.ts:93`'s `CSV_LIKE_TYPES` is untouched.

## 4. Verify

- [x] 4.1 `sbt compile` / relevant Scala checks (comment-only changes shouldn't break compilation,
      but confirm).
- [x] 4.2 Any helio-mcp build/lint check for the one-line TS change.
- [x] 4.3 Run standard gates before commit.
