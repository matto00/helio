## Context

See `proposal.md` for motivation and `ticket.md` for the production evidence and the approved decision.

Ground truth measured on `main` at `9c1f29bf`:

- `SchemaInferenceEngine.fromCsv` seeds each column at `IntegerType` and widens by string-parsing.
- `InProcessPipelineEngine.loadCsvRowsFromBytes` builds rows as `headers.zip(padded).map { case (h, v) => h -> v.asInstanceOf[Any] }` — every cell is a `String`, always. It uses its own inline `parseCsvLine`, a second CSV parser distinct from the RFC 4180 one in `SchemaInferenceEngine`.
- `PipelineRowJson.parseStaticRows` zips declared column names against stored `JsValue`s through `jsValueToAny`; the declared type is never read.
- `PipelineRowJson.jsValueToAny` maps `case JsNumber(n) => n.toDouble`, so every JSON/REST/SQL number materializes as `Double`.
- `SchemaInferenceFacade.toSchemaFields` projects to `SchemaField(name, type)` — it drops `nullable` and `displayName` but **retains** `type`, which lands in `data_sources.inferred_schema` and is load-bearing.
- Declared-type consumers that genuinely break: `PanelCapabilityService` / `OutputBindingSpec` (`SlotEligibility.Numeric` accepts only `integer`/`float`) and `WorkspaceContextComputations` (assistant `measure` role, column stats). `SortStep` and `AggregateStep` do **not** read the declared type — both coerce via `PipelineRowJson.toDouble`, whose `case s: String => s.toDoubleOption` branch already handles CSV strings.

## Goals / Non-Goals

**Goals:**
- A CSV or static source's declared column type matches the runtime type of that column's materialized values.
- No runtime row value moves, so no existing pipeline result can change.
- The JSON/REST/SQL divergence is named and reasoned in the spec, not silently closed.

**Non-Goals:**
- Aligning JSON/REST/SQL (`integer` → `Double`). Closing it would move runtime values — the thing this design forbids.
- Fixing `SortStep`'s partial-coercion fallback (separate ticket; see Risks).
- Any Flyway migration, any change to `RestApiConnectorDriver`, URL-backed fetching, or `LocalFileSystem`.
- Unifying the two CSV parsers. Out of scope, noted so it is not mistaken for an oversight.

## Decisions

**D1 — `fromCsv` reports `StringType` for every column; nullability inference is retained.**
The loader materializes `String` unconditionally, so `string` is the only honest declared type. Nullability is
orthogonal (it describes emptiness, not type) and HEL-868 just specified its CSV behaviour, so it stays exactly
as-is. The `widenType` lattice loses its only caller and is deleted rather than left dead — the same discipline
HEL-858 applied to `mergeObjects`.
*Alternative rejected:* keep inference and cast at load time (ticket option 1). Rejected because it moves every
CSV runtime value, and because a CSV id column of `007` infers `integer`, so `= "7"` would newly match `007` —
re-opening precisely what HEL-889 protected.

**D2 — static schemas derive from stored cells, not declared types.**
Type per column comes from the stored `JsValue`s under the same conversion `parseStaticRows` uses: `JsNumber` →
`float` (it materializes as `Double`, whole-number or not), `JsString` → `string`, `JsBoolean` → `boolean`,
mixed kinds → `string`. A column with no rows falls back to the canonicalized declared type. `float` is still
`Numeric`-eligible for panel slots, so this costs static sources nothing at the binding layer.
*Alternative rejected:* cast static cells to the declared type — same runtime-value objection as D1.

**D3 — CSV field-type overrides are constrained to `string`, rejected at the API boundary.**
`AddSourceModal` seeds `fields` from the inferred schema and lets the user edit the type before upload. Without
this constraint, one click in the shipped UI re-creates the exact defect being removed, and D1 would be
cosmetic.
The guard belongs in exactly ONE place: the inline override-application block in
`DataSourceService.createCsv` (`DataSourceService.scala:187-194`). Verified by tracing every call site:
`SchemaInferenceFacade.toSchemaFields` is called only from `CreateSourceEnvelope.build` and
`SourceService.upsertInferredSchema` — the generic `ConnectorDriver` SPI, i.e. REST/SQL/JSON, never CSV — and
it has no source-kind parameter to condition on, so putting a CSV-only constraint there would regress
legitimate REST/SQL/JSON overrides and violate D5/Non-Goals. `createCsvUrl` and `finishCsvRefresh` accept no
overrides at all, and the preview route `DataSourcePreviewRoutes` → `DataSourceService.infer` takes no
overrides either; none of them needs a guard. Rejecting loudly (naming the `cast` step) is chosen over silently coercing to `string`, because
silently discarding a user's explicit instruction is the failure mode this whole ticket is about.
The frontend disables the data-type editor for CSV and states why, so the rejection is unreachable from the UI
rather than being a trap a user can walk into.
*Alternative rejected:* leave overrides alone and document the hole. Rejected — it leaves the defect reachable
in one click and makes the invariant unverifiable.

**D4 — persisted schemas are corrected on next refresh; no migration, no backfill.**
`data_sources.inferred_schema` for existing CSV/static sources keeps its stale types until that source is next
created or refreshed, at which point the corrected projection is written. "Refreshed" means both refresh paths,
not just create: `finishCsvRefresh` for CSV (which re-runs `fromCsv`, so D1 reaches it for free) and
`applyStaticRefresh` for static (`DataSourceService.scala:611-638`), which is a structurally separate method
that today projects straight from the caller-declared `payload.columns` types and must be changed alongside
`createStatic` — otherwise this promise is false for static sources and the defect stays reachable through
refresh. This is a stated, visible
consequence, not an oversight: a migration is forbidden here, and a lazy backfill would be indistinguishable
from one. Until refresh, an existing CSV source's columns keep their current panel eligibility.

**D5 — the JSON/REST/SQL divergence is specified, not fixed.**
Stated as its own requirement in the `schema-inference` capability with its reason, following exactly how
HEL-868 recorded the CSV empty-vs-absent divergence. A reader can find why CSV and JSON differ without
reading the diff.

## Risks / Trade-offs

- **CSV columns lose `measure` classification and numeric panel-slot eligibility until a `cast` step is added.** → Accepted and explicit: it is the trade option 2 chose, and it must appear in the PR body as a user-visible behaviour change. The `cast` step is the supported path and makes the values genuinely numeric.
- **A pipeline Output rooted on a CSV source previously re-inferred all-`string`, contradicting its source schema.** → Expected to disappear by construction under D1 (both sides now say `string`). Verify this during implementation; file a follow-up ticket only if it survives.
- **`SortStep`'s partial-coercion fallback is not a total order** — a partly-non-numeric column compares lexicographically per pair, which can make `sortWith` produce unstable orderings. → Out of scope; file as its own ticket with the repro. Not absorbed.
- **D3 is a breaking API change** for any client sending non-`string` CSV type overrides. → The only in-repo client is `AddSourceModal`, updated in the same change. Rejection names the remedy.

## Planner Notes

Self-approved: the choice of `float` (not `integer`) for static numeric columns in D2, since `Double` is what
materializes and `float` preserves numeric slot eligibility. Self-approved: deleting `widenType` with its last
caller. The option-1-vs-option-2 decision itself was escalated and approved by the product owner, not
self-approved — see `ticket.md`.
