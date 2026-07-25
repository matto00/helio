## Context

`stringops` is the seventh leaf of the HEL-336 Pipeline Op Expansion epic. It writes a *derived
string column* — most like `ComputeStep` (`domain/steps/ComputeStep.scala`, appends one derived
column per row) crossed with `CastStep` (`domain/steps/CastStep.scala`, per-field transform,
schema-preserving when the target field is overwritten). It is explicitly NOT `SplitTextStep`
(`domain/steps/SplitTextStep.scala`), which explodes a `string-body` content field into multiple
rows — `stringops` never changes row count. It wires through the same backend surface as every
prior leaf (`PipelineStep` registry/kind, wire protocol, config codec, analyze protocol,
exhaustive-match repository/service consumers) plus a Flyway migration and a `StepCard` editor,
precedented most closely by `HEL-378`'s `DateBucketStep` (single source `field`, single derived
`outputColumn`, append-or-replace analyze rule).

## Goals / Non-Goals

**Goals:**

- Backend `stringops` op supporting six operations: `trim`, `upper`, `lower`, `split`,
  `extractRegex`, `concat` — the literal set named in the ticket's Scope and Acceptance Criteria.
- `analyze_pipeline`: output schema = input schema with `outputColumn` typed `string`, appended if
  new or replacing in place if it collides with an existing field name.
- Frontend `StringOpsConfig.tsx` step-card editor (operation dropdown reveals only the params that
  operation uses) + MCP `add_pipeline_step` documentation.

**Non-Goals:**

- A `title`-case operation. The ticket's title/summary informally mentions "case" conversion, but
  the ticket's own Scope and Acceptance Criteria enumerate exactly `trim`/`upper`/`lower`/`split`/
  `extractRegex`/`concat` — six operations, no `title`. Implementing only the literal six avoids
  scope creep beyond what's specified and tested; a `titleCase` operation can be a follow-on leaf
  if requested.
- Locale-aware case conversion — `upper`/`lower` use plain `String#toUpperCase`/`toLowerCase`
  (JVM default locale), matching `CastStep`'s plain-`String` conversions; no `Locale` parameter.
- Cross-field validation beyond "does the regex compile" — e.g. no attempt to detect field-name
  typos in `fields` (concat) beyond what null-handling (Decision 4) already tolerates.

## Decisions

**1. Config shape is `StringOpsConfig(operation: String, field: String, outputColumn: String,
pattern: Option[String], separator: Option[String], index: Option[Int], fields:
Option[Vector[String]])`** — the literal signature specified in the ticket's Scope section.
`outputColumn` is a required `String` (not `Option[String]`, unlike `DateBucketConfig`) — see
Decision 2 for why this simplifies the analyze/apply rule instead of needing a fallback-to-`field`
branch.

**2. Append-vs-overwrite is determined purely by name equality: if `outputColumn == field`, the
write overwrites the source column in place; otherwise it appends (or replaces) a distinct
column.** No separate "was outputColumn provided" flag is needed since it's a required field.
Both apply (`row + (outputColumn -> value)`) and analyze
(`inputSchema.filterNot(_.name == outputColumn) :+ SchemaField(outputColumn, "string")`) use the
exact same `filterNot` + `:+` collision-safe shape `DateBucketStep`/`WindowStep` already
established — this makes analyze *always* additive-or-replacing, never a separate identity branch,
which keeps apply/infer parity trivial to verify with one schema rule instead of two. Pinned with a
dedicated analyze test for both the `outputColumn == field` (replace) and `outputColumn != field`
(append) cases.

**3. Per-value null/missing handling: a `null`/absent source `field` value yields `null` in
`outputColumn` for `trim`/`upper`/`lower`/`split`/`extractRegex`** (parity with `CastStep`'s
null-on-failure contract — `if (v == null) return null` before any per-op logic runs). This applies
uniformly across all five single-field operations rather than each defining its own null rule.

**4. `concat` treats a `null`/absent field in its `fields` list as an empty string, not as
whole-output `null`.** Rationale: `concat`'s entire purpose is to always produce a joined string;
propagating `null` from any one missing field would make `concat` unusable whenever a single input
column had sparse data, defeating its purpose (e.g. joining `firstName`/`middleName`/`lastName`
where `middleName` is frequently blank). This is a deliberate deviation from Decision 3's
null-propagates rule, scoped only to `concat` because it operates over *multiple* fields rather
than transforming one value. `fields` empty or absent yields `outputColumn = ""` for every row (not
a step-level failure) — an empty field list is a valid, if degenerate, configuration.

**5. `split` takes `field` split by `separator` (literal string split, not regex), then indexes into
the resulting array with `index`.** An out-of-bounds `index` (including a negative index) yields
`null` for that row — a per-row data condition, not a config error, consistent with Decision 3's
null-on-failure family (parity with `CastStep`'s per-row null-on-failure, not a step-level throw).
Missing `separator`/`index` in config is a step-level misconfiguration and fails at execute time
before any row is processed (mirrors `DateBucketStep`'s unsupported-`granularity` / `FillNullStep`'s
missing-`value`-for-`constant` validation).

**6. `extractRegex` extracts the first capturing group of `pattern` matched against `field`'s
value.** `pattern` MUST contain at least one capturing group — a pattern with zero groups is a
step-level misconfiguration (fails at execute time with a descriptive error naming the pattern),
since "first pattern group" is meaningless without one. Per-row: if `field`'s value is `null`/absent
→ `null` (Decision 3); if the value is non-null but the pattern doesn't match → `null` for that row
(a data condition, not a config error — chosen over empty-string or passthrough because it keeps
"couldn't extract anything" visually distinct from "extracted an empty string", matching
`DateBucketStep`'s unparseable-value-yields-null precedent).

**7. Unsupported `operation` fails at execute time with a descriptive error** naming the invalid
value and the six supported operations — matches `FillNullStep`/`DateBucketStep`/`WindowStep`'s
unsupported-value error shape (`IllegalArgumentException`, validated before any row is processed).

**8. `analyze_pipeline` dispatch is a dedicated `inferStringOps` case (not the identity-passthrough
group)** since `stringops` always types `outputColumn` as `string` — it joins the
append-or-replace family (`datebucket`, `window`) rather than the passthrough family
(`cast`/`filter`/`limit`/`sort`/`dedupe`/`fillnull`). No field-existence validation is performed on
`field`/`fields` at analyze time — like `datebucket`, `stringops` accepts any scalar field and
null-coerces unparseable/missing values at execute time rather than rejecting at analyze time.

## Risks / Trade-offs

- [Risk] `concat`'s empty-string-for-null deviates from the other five operations' null-propagates
  rule, which could surprise a reader expecting one uniform rule → Mitigation: documented explicitly
  in Decision 4 and in `StringOpsConfig`'s scaladoc; covered by a dedicated null-handling test in
  `InProcessPipelineEngineSpec.scala`.
- [Risk] `split`'s literal (non-regex) separator could confuse users expecting regex-split semantics
  → Mitigation: matches the ticket's plain-language spec ("split field by separator"); regex-based
  extraction is available via `extractRegex` for that use case.
- [Risk] A regex `pattern` without a capturing group is a common user mistake → Mitigation: fails
  fast at execute time with a message naming the pattern, rather than silently returning the whole
  match or `null`, so misconfiguration is visible immediately (not just on a later downstream step).

## Migration Plan

- New Flyway migration extending `pipeline_steps_op_check` to add `'stringops'`, following the
  drop/re-add pattern (`V50__add_splittext_op.sql` → ... → `V69__add_fillnull_op.sql`). **VNN is NOT
  hardcoded here** — confirm the current max via `ls backend/src/main/resources/db/migration/ |
  sort` immediately before writing the migration, and re-confirm again immediately before the
  delivery push (multiple v1.6 op lanes may land concurrently and contend for the same number).
  Purely additive; no data migration; rollback is dropping the migration file pre-merge (no prod
  rows reference `'stringops'` until this ships).

## Open Questions

None — ticket scope and config shape are unambiguous once the append-vs-overwrite rule
(Decision 2) and null-handling rules (Decisions 3-6) are pinned.

## Planner Notes

- Self-approved: excluding `title`-case as a seventh operation — the ticket's own Scope/Acceptance
  Criteria enumerate exactly six operations; the orchestrator brief's parenthetical "upper|lower|
  title case" is not present in the Linear ticket body itself, so the literal ticket wins.
- Self-approved: `concat`'s null-as-empty-string rule (Decision 4) — undocumented in the ticket;
  chosen because whole-output-null-on-any-missing-field would make `concat` unusable for its most
  common use case (joining sparse name/address fields).
- Self-approved: `extractRegex` requiring a capturing group (Decision 6) — undocumented in the
  ticket, but "first pattern group" is unambiguous about the intended contract; failing fast on a
  group-less pattern is more useful than a silent `null` for a misconfigured step.
