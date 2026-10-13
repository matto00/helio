# HEL-1520: Union with a data-source secondary input: analyze cannot see the source's types, so the HEL-1491 timestamp/numeric collision check never fires

## Description

Follow-up from HEL-1491.

HEL-1491 makes analyze report a step error when a `union` puts a numeric field and a `timestamp` field under one name. The check runs only when analyze has the secondary input's schema. Analyze resolves a **data-source** (`source`-kind) secondary's schema only for `join` and `lookup` (`PipelineAnalyzeService.scala` ~196-201, ~247-251, ~300-301; union is excluded from `secondarySourceIdOf`). For a union whose secondary is a data source (the original and default union shape, `SecondaryInput.scala:25`), `secondarySchema` is always `None`. The check never fires there, and the run still puts numbers under a `timestamp` projection.

The gap is documented in `docs/compute-expression-grammar.md` ("Known limitation: a timestamp-typed column that carries a number"). It is pinned by a guard in `TimestampNumberParitySpec`, so any change to it has to be deliberate.

**Decision needed (product call):** should analyze resolve a source secondary's schema for `union` too? Doing so changes the projected schema of every existing source-kind union, because secondary-only columns would start to appear. It might also change `AnalyzeSchemaWarnings` output for source unions. HEL-1491's design asserted that change, but the HEL-1491 design-gate skeptic said the follow-up should verify it rather than assume it. Note too that the stale "union analyze is a passthrough" wording in `pipeline-union-op` was corrected by HEL-1491.

origin_kind: followup
origin_ticket: HEL-1491

## Acceptance Criteria (derived; the ticket states a decision, not ACs)

1. ASSUMED PRODUCT CALL (overnight rules, owner asleep; recorded for OWNER REVIEW): yes, analyze resolves a `source`-kind secondary's schema for `union`, exactly as it already does for `join`, on every analyze path (persisted-pipeline analyze, node reads/capabilities, proposal analyze, transactional create).
2. A `union` whose `source`-kind secondary has a resolvable inferred schema projects the parent schema followed by every secondary-only field (same rule as a `lane`-kind union), and the HEL-1491 timestamp/numeric collision check fires on it as a step `validationError` (surfaced as `step-config-invalid`, `canRun: false`).
3. A source that is missing, has an empty `dataSourceId`, or has no inferred schema still degrades to the documented passthrough (no error, parent schema unchanged).
4. The change in `AnalyzeSchemaWarnings` output for source unions (now name-complete when the source schema resolves) is verified by a test, not assumed.
5. The pinned KNOWN GAP guard in `TimestampNumberParitySpec`, the `pipeline-union-op` spec, and `docs/compute-expression-grammar.md` are updated deliberately to the new behaviour.
6. Run-time behaviour is unchanged; no migration; files touched by open PR #986 (HEL-1455) other than the doc are not edited.
