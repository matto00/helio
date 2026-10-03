## Context

`LookupStep.evaluate` builds `brought = columns -> firstMatch.getOrElse(c, null)` and merges `leftRow ++ brought` (no-match: `leftRow ++ nulls`). So on main the BROUGHT value wins on collision (and on a no-match row a `null` overwrites the left value). `inferLookup` mirrors it: per requested column `schema.filterNot(_.name == col) :+ SchemaField(col, type)`. HEL-1236 introduced `JoinColumnNaming.resolve` (prefix colliding right columns `right_<c>`, collision-proof suffixes, sorted-name order). Owner ruling (binding): lookup uses the same rule.

## Goals / Non-Goals

**Goals:** lookup uses the shared naming rule at runtime and analyze; parity test; red/green/mutation evidence; dev-DB inventory; documented key semantics.
**Non-Goals:** changing join behavior; Spark (verified: `SparkJobSubmitter` has no lookup case); `secondarySourceSchemas` for lookup types; migration of existing pipelines/bindings; production checks.

## Decisions

1. **"Right columns" of a lookup are the requested `columns` (distinct), not the reference rows' keys.** Join derives right names from the right ROWS' keys; lookup only ever brings the named columns, so the name set is config-declared. Consequence: runtime and analyze see identical right names regardless of data (no ragged-right divergence), and a requested column absent from the reference rows still gets its (null-valued, renamed-if-colliding) output column, same as today.
2. **Left names**: runtime = union of left row keys (computed once per evaluation, never per row, so every row is renamed identically; empty left input -> no left columns -> nothing renamed, nothing overwritten; same documented divergence as join for a schema-declared column present in no row). Analyze = input schema field names.
3. **Lookup's "key"**: join's rule drops the right key copy because the key column exists on both sides by definition and is equal on matches. Lookup differs: the key pair is `(sourceKey on left, lookupKey on reference)`, and the reference key is NOT brought unless the author lists it in `columns`. Only when `sourceKey == lookupKey`, the name is in `columns`, and the left carries it, is the brought copy a pure duplicate of the left key (equal on matched rows by construction), so it is dropped and the left key kept once (this also fixes the no-match case where a `null` used to overwrite the left key). When `sourceKey != lookupKey`, a requested column named `lookupKey` can hold a value different from the left's `sourceKey` column, so it is an ordinary requested column and collides/prefixes like any other (dropping it would lose a value). This is NOT a force-fit of join's rule: the drop is conditioned on `sourceKey == lookupKey`.
4. **Shared helper change**: add `JoinColumnNaming.resolveWithKey(left, right, droppedKey: Option[String])` as the single core; `resolve(left, right, joinKey)` becomes `resolveWithKey(left, right, Some(joinKey))` (signature and behavior unchanged, existing `JoinColumnNamingSpec` stays green). Lookup calls the core with `Some(lookupKey)` iff `sourceKey == lookupKey`, else `None`. Disabling prefixing in the core therefore turns join AND lookup tests red (mutation AC).
5. **Runtime**: `mapping = resolveWithKey(rows.flatMap(_.keys), columns.distinct, keyOpt)`; `brought` = for each requested column present in `mapping`, `mapping(c) -> firstMatch.getOrElse(c, null)`; no-match rows get `mapping.values -> null`. Merge `leftRow ++ brought`: no key of `brought` is a left key by construction, so nothing is overwritten.
6. **Analyze**: `inferLookup` computes the same mapping over `inputSchema` names and the `columns` list, appends `SchemaField(mapping(c), type)` in `columns` order for surviving columns; the type still comes from a resolved lane-kind secondary schema, else `string`. Invalid/missing `sourceKey`/`lookupKey` config decodes tolerantly (empty strings -> no key drop).
7. **`secondarySourceSchemas`**: NOT needed. Names are config-declared, so source-kind secondaries do not change which columns appear or their names; they would only improve the placeholder `string` type, which is unrelated to this ticket. `sourceDependencyOf` stays join-only. (Verified by the parity test using a source-kind secondary: names agree with no pre-resolution.)
8. **Spark**: `SparkJobSubmitter` has no lookup handling (grep), nothing to change; stated in the PR body.
9. **Consequence for bindings (verify and state in PR body)**: today the brought value wins on matched rows and `null` wins on unmatched rows under the clashing name. After: the clashing name reads the left/base value; the looked-up value is under `right_<name>`.
10. **Existing tests**: any test asserting the overwrite (`InProcessPipelineEngineSpec`, spec scenario) is rewritten to the new behavior; the red-first test is added first and shown failing on unmodified logic.
11. **Dev-DB inventory**: read-only exact SELECTs on `pipeline_steps` of op `lookup`, listing `columns` vs the input schema where resolvable.

## Risks / Trade-offs

- Renames columns in existing pipelines (owner-accepted); documented.
- Dropped-key rule is conditioned on `sourceKey == lookupKey`; the alternative (never drop) would emit `right_<key>` duplicates of the key, which is noise.
