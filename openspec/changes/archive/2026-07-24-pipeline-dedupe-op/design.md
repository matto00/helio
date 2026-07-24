## Context

`dedupe` is the fifth leaf of the HEL-336 Pipeline Op Expansion epic. Unlike `pivot`/`unpivot`/
`date-bucket`, it is a pure row filter — no schema change, output schema == input schema — matching
`LimitStep`'s passthrough shape exactly. `SortStep` is the template for stable, order-preserving row
comparisons over a config-driven key list. `backend/src/main/scala/com/helio/domain/PipelineStep.scala`
is the single source of truth for kind registration (`Registry` map + `PipelineStepKind` constant);
`PipelineStepKind.All` is checked against the registry in a kind-parity test.

## Goals / Non-Goals

**Goals:**

- Whole-row distinct (`keys` empty) and key-set distinct (`keys` non-empty), both honoring
  `keep = "first" | "last"` by original input row order, with stable output order.
- Identity schema passthrough on `analyze_pipeline` (no data sampling — same pattern as `limit`).
- Full op-surface wiring so `dedupe` is a first-class op: backend registry, wire protocol, config
  codec, analyze protocol, Flyway CHECK constraint, frontend StepCard editor, MCP tool description.

**Non-Goals:**

- No DAG/branching (chains linearly, per ticket's explicit out-of-scope).
- No fuzzy/approximate dedup (e.g. case-insensitive, whitespace-trimmed) — exact value equality only.
- No UI for large-cardinality key pickers beyond the standard multi-select already used elsewhere.

## Decisions

**Key-tuple equality via `Any` value equality, not JSON re-serialization.** Rows are
`Map[String, Any]` (`PipelineRowJson.Row`) at the engine layer, same as `LimitStep`/`SortStep`. Build
the dedup key as `Vector[Any]` — `keys.map(row.getOrElse(_, null))` when `keys` is non-empty, or the
full row's sorted-by-field-name entries when `keys` is empty (whole-row distinct must be
order-independent of map iteration order, so sort by key before comparing) — and use it as a
`Set`/`Map` lookup key. `null == null` holds for Scala's `Any` equality, so null keys collapse
together by default, matching the ticket's "nulls participate like any other value" guidance. This
avoids the cost and edge cases of `.toJson.compactPrint` for whole-row comparison.

**Single left-to-right pass, not two passes.** For `keep = "first"`: iterate input order, keep a
seen-set of dedup keys, emit a row the first time its key is seen. For `keep = "last"`: precompute
which row *index* is the last occurrence of each key (single pass building a `Map[key, lastIndex]`),
then iterate again and emit rows whose index equals that key's last index. Both preserve original
relative order (unlike a naive "reverse, dedupe-first-occurrence, reverse-again" which is correct but
less direct) and are O(n) — matching `LimitStep`'s O(1)/O(n) simplicity bar, more directly readable
than `SortStep`'s multi-key fold.

**`keep` decode is tolerant, defaults to `"first"`.** Mirrors `LimitConfig.decode`'s tolerant-decode
pattern (missing/malformed fields fall back to a safe default, never throw). Only the literal string
`"last"` (case-sensitive, matching `SortStep`'s `direction` handling style but simpler — no
`equalsIgnoreCase` needed since the UI only ever emits `"first"`/`"last"`) selects last-occurrence;
anything else (including missing) is `"first"`.

**Analyze passthrough joins the existing `filter`/`limit`/`sort` identity group in
`PipelineAnalyzeService`**, not a new dispatch branch — same code path, `outputSchema = inputSchema`,
no `validationError`, per the ticket's explicit instruction to add `'dedupe'` to that group.

**Frontend `DedupeConfig.tsx` reuses the existing multi-select field-picker pattern** already used by
other ops with `Vector[String]` field configs (grep `stepNarrowing.ts`/sibling `*Config.tsx` for the
established column-multi-select component) rather than inventing a new selection widget, plus a
two-option first/last toggle (radio or segmented control, matching existing toggle patterns in the
StepCard family).

## Planner Notes (self-approved)

- Whole-row distinct key uses a **sorted-by-field-name** vector of `(field, value)` pairs (not raw
  map iteration order) so two rows with identical field/value sets but different internal map
  ordering still collapse to the same key — Scala `Map` iteration order is not guaranteed stable
  across equal-content maps built via different code paths (e.g. JSON parse vs. earlier step output).
- The exact Flyway `VNN` is deferred to implementation time per the ticket's stated merge hazard
  (three v1.6 lanes may contend); the executor must `ls` the migration directory immediately before
  writing the file and again immediately before the delivery push.
- No new capability spec sections needed for "distinct" as a separate concept from "dedupe by
  keys" — empty `keys` *is* whole-row distinct; one requirement covers both via the `keys` config
  value, per the ticket's own framing ("if keys is empty, dedupe on the whole row").

## Risks / Trade-offs

- [Risk] Whole-row distinct on wide rows recomputes a sorted key per row (O(row width log width)) →
  Mitigation: row width is small in practice (pipeline outputs are tabular, not wide-column stores);
  matches the existing engine's per-row-Map performance profile, no different from `SortStep`'s
  per-comparison field lookups.
- [Risk] `keep = "last"` requires a lookahead pass before the emit pass (two passes over rows) →
  Mitigation: still O(n) overall, no different complexity class from `LimitStep`/`SortStep`; rows are
  already fully materialized in memory at this point in the engine.
- [Risk] Migration V-number collision with a concurrently-landing v1.6 lane → Mitigation: re-confirm
  the max `V*` file immediately before writing and immediately before push, per ticket instruction.
