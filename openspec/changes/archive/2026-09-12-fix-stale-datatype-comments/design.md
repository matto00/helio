## Gate-Chain Implications Checklist

N/A — this change does not touch `.husky/**` or any commit-gate script.

## Decisions

**Decision 1 — item 1 is a confirm-only, not a fix.** Verified during Setup premise validation
(see `.concertino/runs/HEL-1118/evidence/premise-validation.md`) that the ticket's literal quoted
defect no longer exists on main: HEL-1073 renamed `StaticSource`->`DatasetSource`, HEL-1074
rewrote the scaladoc to describe the `dataset_schema`+`dataset_rows` path exclusively. The executor
does not touch `DataSource.scala`'s `DatasetSource` scaladoc for this reason — it is already correct
— but must independently verify `DataSource.scala:44`'s inferredSchema-backfill claim against
current behavior (grep `DataSourceService`/migration code for whether the "pre-existing call site"
backfill described there has actually landed), and note the finding either way.

**Decision 2 — triage methodology.** Grep case-insensitively for `DataType\b|type registry|
snapshot.?row` across `backend/src/main/**/*.scala`. For each hit, read enough surrounding context
(the whole doc comment / declaration) to classify as:
- `accurate-historical`: correctly describes something that WAS true and was removed (e.g. "X was
  retired by HEL-904").
- `unrelated-identifier`: the string match is a false positive — a real, live, differently-named
  concept (e.g. `@param dataType` on an unrelated method, `DataTypeService`-shape references that
  are just describing a similarly-named but unrelated live class).
- `genuinely-stale`: describes DataType/type-registry/snapshot-row as though it were a *live*
  mechanism, when it is not.
- `uncertain`: ambiguous enough that a human call is better than a guess.
Only `genuinely-stale` hits get edited. `uncertain` hits are listed, not edited, and escalated
back through the orchestrator if the uncertain+genuinely-stale count is large (more than ~15,
sized against the measured 225 raw grep hits across 77 files, matching ticket.md).

**Decision 3 — wire-literal fix.** `helio-mcp/src/helioApi.ts:456`'s `type: "static"` becomes
`type: "dataset"`. This is a behavior-preserving change: the backend's `DataSourceKind.canonicalize`
already accepts both wire values, so this only stops the MCP client from relying on a one-release
alias it doesn't need to. `helioApi.ts:93`'s `CSV_LIKE_TYPES` is untouched (deliberate read-side
alias per its own comment).

## Non-goals

Not re-litigating HEL-1073/HEL-1074/HEL-1075's own decisions. Not renaming/removing the `"static"`
wire alias itself (that's HEL-1073's own sunset timeline, not this ticket's scope).
