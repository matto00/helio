# HEL-893: CSV sources declare numeric column types they do not materialize, so identical steps behave differently per source

## Description

A DataSource's declared column type is a promise the data does not honour. `SchemaInferenceEngine.fromCsv` seeds each column at `IntegerType` and widens by string-parsing, declaring `integer`/`float`/`boolean`/`timestamp`. But `InProcessPipelineEngine.loadCsvRowsFromBytes` builds every row as `headers.zip(padded).map { case (h, v) => h -> v.asInstanceOf[Any] }` — every CSV cell is a `String`, unconditionally, with no cast anywhere. Two sources that look identical in the UI (both showing a column typed `integer`) carry different runtime types.

Production evidence (v0.7.6, `fact_issues`, CSV-backed): `is_epic`, `is_done`, `has_cycle` are declared `integer` but hold strings. 17 filter conditions across 11 pipelines match on `"0"`/`"1"`; `kpi_delivered` returns `{delivered: 328}` and `kpi_backlog` `{remaining: 222}` — only possible because the runtime values are strings.

`static` sources violate the same invariant, and worse: `columns[].type` is user-asserted and validated for canonical form, but `PipelineRowJson.parseStaticRows` never consults it — cells go through `jsValueToAny` from the raw stored `JsValue`s.

JSON/REST/SQL violate it more narrowly: `PipelineRowJson.jsValueToAny` maps `case JsNumber(n) => n.toDouble`, so an `integer`-inferred column materializes as `Double` and a `timestamp`-inferred column as `String`.

The consumers that actually break on a wrong declared type are `PanelCapabilityService`/`OutputBindingSpec` (slot eligibility is purely declared-type-driven — a numeric-only chart `yAxis`/metric `value` slot is offered for a string column) and `WorkspaceContextComputations` (assistant semantic role `measure`, and column stats gated on the declared type). Sort and aggregate do **not** break: both are value-driven via `PipelineRowJson.toDouble`, which coerces numeric-looking strings, and neither reads the declared type.

## Decision (product owner approved, 2026-09-04)

**Option 2 — infer what is actually materialized — for CSV and `static` sources.** CSV columns are typed `string` unless explicitly cast by a `cast` step; static columns' declared types are reconciled with what `parseStaticRows` actually produces. The JSON/REST/SQL divergence is **documented as a named, retained difference with its reason**, not silently aligned — the same treatment HEL-868 gave empty-vs-missing on the CSV wire.

Rationale: option 2 moves no runtime value, so no existing production result can change. The 17 `fact_issues` conditions keep returning 328/222 by construction, not by re-verification. Option 1 (materialize to the inferred type) was rejected because its stated justification ("matches the JSON path's behaviour") is false — the JSON path does not cast to the inferred type either — and because a CSV id column of `007`/`012` infers `integer`, so materializing it would make `= "7"` newly match `007`, re-opening exactly the numeric-looking-string case HEL-889 deliberately protected.

Accepted cost: CSV and static columns lose `measure` classification in the assistant and numeric panel-slot eligibility until an explicit `cast` step is added. This is a user-visible behaviour change and belongs in the PR body.

## Acceptance criteria

- [ ] The chosen resolution is stated as a decision with its rationale, not implied by the diff.
- [ ] The declared-vs-runtime invariant holds for **CSV and `static`** sources: every column's declared type matches the runtime type of that column's materialized values, demonstrated on one source of each kind carrying a numeric-looking column.
- [ ] The JSON/REST/SQL divergence (`integer` materializes as `Double`, `timestamp` as `String`) is documented as a named, retained difference with its reason, in a durable place a reader can find without reading the diff — not silently aligned and not buried in a code comment.
- [ ] The blast radius on existing production sources is assessed and reported before merge. `fact_issues` and the 11 pipelines filtering on it are the known live case and must be checked explicitly — those filters currently work and must still work afterwards.
- [ ] Because option 2 was chosen, no runtime row value changes; the 17 `=` conditions are unaffected **by construction**, and that argument is demonstrated rather than asserted.
- [ ] Existing persisted `data_sources.inferred_schema` rows for CSV/static sources are addressed explicitly: state when they are corrected (e.g. on next refresh) and what a user sees until then. **No Flyway migration.**
- [ ] Verified by measurement on materialised rows, asserting the **runtime** type, not the declared one. A test asserting that inference ran without error is not coverage.
- [ ] Regression guard added for the shape a CSV source actually produces: a sort over a column of numeric-looking `String`s (e.g. 9, 10, 100), which no existing test covers.

## Constraints

- **No Flyway migration.** Every worktree on this machine shares one dev Postgres; a migration poisons `flyway_schema_history` for parallel runs. If a schema change appears necessary, stop and escalate.
- **No browser.** Parallel worktrees share a single Playwright session.
- Stay out of two sibling runs' files: HEL-844 owns `RestApiConnectorDriver`, `RestSourceConnectorMigration`, `RestApiConfig.queryParams` and its consumers; HEL-881 owns URL-backed source fetching and `LocalFileSystem`. If the fix reaches into either, escalate rather than absorbing it.
- Base is `main` at `9c1f29bf`.

## Out of scope (file as separate tickets, do not absorb)

- `SortStep`'s partial-coercion fallback: a column that is only partly numeric falls back to lexicographic comparison per pair, which is not a total order and can make `sortWith` produce unstable/garbage orderings.
- Whether a pipeline Output rooted on a CSV source re-inferring all-`string` still contradicts its source-level schema — check first, since option 2 may resolve it by construction; if so, say so and file nothing.
