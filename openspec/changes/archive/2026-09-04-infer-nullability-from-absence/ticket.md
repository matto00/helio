# HEL-868: Inferred nullability ignores absence: a field missing from most rows is advertised non-nullable

## Description

Nullability is inferred only from values that are *present and null*. A field simply **absent** from a sampled row does not mark the column nullable.

Before HEL-858, top-level-only merging meant this rarely surfaced. Now that inference unions and widens over dotted paths across heterogeneous rows (`SchemaInferenceEngine.inferFromObjects`, whose `PathAcc` seeds `nullable = false` and only flips on an explicit `JsNull` leaf), the normal shape of a real API response triggers it: on the Sleeper projections feed a QB row has no `stats.rec` at all, so the merged schema gains `stats.rec` from receiver rows and advertises it **non-nullable** — despite most rows lacking it entirely.

The flag is not internal-only. It reaches the assistant's column semantics through `WorkspaceContextService.scala:378`, so an incorrect non-nullable claim misleads an LLM reasoning about the data — it may treat a mostly-absent column as always-present when proposing pipelines, panels, or filters. Wrong metadata handed to a model is worse than absent metadata, because the model has no way to detect it.

Note the sign: this is the *opposite* direction from HEL-858's nullability flip. That one replaced a false answer with a true one (`false -> true` where the value genuinely could be null). This one leaves a false `false` standing.

### The three encodings

Absence, explicit null, and present-but-empty are three distinct encodings, and code here routinely handles only two. This is the same trap as spray-json omitting `Option = None` on the wire.

- **Absent** — the path yields no entry from `JsonFlattener.leaves` at all (JSON), or the row is short and gets padded (CSV).
- **Explicit null** — `JsNull` at the leaf (JSON); CSV has no distinct encoding for this.
- **Present-but-empty** — `JsString("")` (JSON, currently a non-null StringType value); an empty cell `""` (CSV, currently treated as null).

All three must be enumerated explicitly, and the tests must say which is which.

### Known path divergence (confirmed pre-planning)

`fromCsv` pads short rows with `""` (`parseRfc4180Row(line).padTo(headers.length, "")`) and treats an empty cell as `nullable = true`. So the CSV path *already* treats a missing trailing cell as nullable, while the JSON path does not. The two paths disagree today; the change must state whether they agree afterwards.

## Scope

* Treat absence as evidence of nullability during the path union — a path missing from any sampled object marks the column nullable.
* Decide and document the interaction with the existing present-and-null rule; they should compose into one stated rule, not two rules that happen to coexist.
* Check the CSV inference path for the same defect and state whether the two paths now agree.
* This changes inferred schemas for existing heterogeneous sources — assess whether re-inference on refresh alters any live DataType, and say so explicitly rather than assuming it is invisible.
* Widen the repro: check whether the same absence-blindness affects inferred **type** as well as nullability, since both are derived in the same pass. State the finding either way.

## Acceptance criteria

- [ ] A field present in some sampled rows and absent from others is inferred nullable, proven on the produced value — specifically, the inferred nullability for a field present in 1 of 100 rows — not merely that inference ran without error. Verified against a fixture matching the real mixed-position Sleeper projections shape where a QB row lacks `stats.rec`.
- [ ] A field present in every row with no null values remains non-nullable (no false positives).
- [ ] All three encodings (absent / explicit null / present-but-empty) are covered by distinct tests that name which encoding each exercises.
- [ ] The composed nullability rule — absence and present-null together — is stated normatively in the spec, not left as implementation behaviour.
- [ ] The effect on existing DataTypes is assessed and reported; any change to a live source's schema on re-inference is called out.
- [ ] Order-independence is preserved: nullability must not depend on row ordering (HEL-858's central invariant).
- [ ] Whether absence also corrupts inferred *type* is investigated and the finding stated.

## Run constraints (coordinator-imposed, binding)

- **No Flyway migration.** All worktrees share one dev Postgres; a migration from a parallel run poisons `flyway_schema_history` for siblings. If a schema change is genuinely needed, STOP and escalate.
- **No browser / Playwright.** Parallel worktrees share one session. This is backend inference and must not need it; escalate if it appears to.
- **Do not touch** `WorkspaceContextService.scala` (read-only reference is fine), `PipelineService.scala`, anything under `api/protocols/patchsets/`, the pipeline-proposal surface, or `helio-mcp` — HEL-914 owns these. The REST fetch path (HEL-844) and URL-backed source caching (HEL-881) are owned by sibling runs.
- **Do not fix HEL-893** (CSV sources declaring numeric types they never materialize). It lives in the same inference area and has its own queued run. If its cause is found, record the finding in a note/comment and leave the fix.
- **Do not merge.** Hand the PR back to the coordinator.
