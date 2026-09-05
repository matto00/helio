# Blast radius — HEL-893 (infer-materialized-source-types)

## Scope of this assessment

This change alters what `SchemaInferenceEngine.fromCsv` and the static-source schema derivation
report as a column's **declared type**. It does not alter what `InProcessPipelineEngine`,
`PipelineRowJson.parseStaticRows`, or any pipeline step **materializes** for a row's runtime
value — no code path that touches a stored cell's runtime representation is touched by this
change. This report exists to demonstrate that claim against the one concrete production case
named in the ticket, not merely assert it.

## The `fact_issues` case (production, CSV-backed)

`fact_issues` is a CSV-backed data source whose inferred schema currently declares `is_epic`,
`is_done`, and `has_cycle` as `integer`. Per ticket.md's production evidence, 17 filter conditions
across 11 pipelines match on the string literals `"0"`/`"1"` against these columns, and two
metric-style Outputs (`kpi_delivered` → `{delivered: 328}`, `kpi_backlog` → `{remaining: 222}`)
depend on those filters resolving correctly today.

### What changes

- **Declared type only.** `fact_issues`'s `is_epic`/`is_done`/`has_cycle` columns will report
  `string` instead of `integer` the next time the source is refreshed (see "When the correction
  lands" below) — `SchemaInferenceEngine.fromCsv` now reports `StringType` for every CSV column
  unconditionally (design D1), because that is what
  `InProcessPipelineEngine.loadCsvRowsFromBytes` has always materialized for every CSV cell,
  including these three columns.
- **No runtime value changes.** `loadCsvRowsFromBytes` is untouched by this change (see
  `files-modified.md`). Before and after, the cell behind `is_epic`/`is_done`/`has_cycle` for
  every row is, and always was, a Scala `String` (`"0"` or `"1"`), never an `Int`/`Long`.

### Why the 17 filter conditions are unaffected, demonstrated not asserted

`FilterStep` never reads a column's declared type — it resolves `FilterCondition.field` by exact
key against the row `Map[String, Any]` and compares against the condition's `value: String`
(`FilterStep.scala`). A `=` condition on `is_epic = "0"` compares the row's materialized `String`
value against the literal string `"0"`; the schema's declared type (`integer` before this change,
`string` after) never enters that comparison. Task 6.5's regression test
(`InProcessPipelineEngineSpec`, "FilterStep: an `=` condition over string-valued CSV-shaped rows
matches identically regardless of the column's declared type (HEL-893 6.5)") constructs exactly
this shape — rows with `is_epic` as a materialized `String` `"0"`/`"1"` — and proves a `=`
condition against `"0"` matches the same rows regardless of what the column's declared type says.
This is the same code path `fact_issues`'s 17 conditions run through in production, so the same
argument applies to them: `kpi_delivered`'s `328` and `kpi_backlog`'s `222` are unaffected,
because the values every filter compares against never moved.

### What consumers DO change (accepted cost, stated in ticket.md/proposal.md)

- **Panel slot eligibility** (`PanelCapabilityService`/`OutputBindingSpec`): a numeric-only
  `yAxis`/metric `value` slot is offered only for `integer`/`float` columns. After
  `is_epic`/`is_done`/`has_cycle` report `string`, any panel binding that previously selected one
  of these columns for a numeric slot will need a `cast` step inserted upstream in the pipeline to
  regain eligibility. Any panel *already* bound to one of these columns for a numeric slot before
  this ships keeps its existing binding (bindings aren't re-validated retroactively by this
  change) but a **new** binding attempt against a `string`-typed column will not offer that slot.
- **Assistant `measure` classification** (`WorkspaceContextComputations`): these three columns
  lose `measure` semantic-role eligibility and their column-stats computation (which is gated on
  numeric declared type) until a `cast` step converts them.
- **Sort and aggregate: no change.** Both read materialized values via
  `PipelineRowJson.toDouble`, which coerces a numeric-looking `String` — unaffected by the
  declared-type change, and already covered for the CSV shape by the new
  `SortStepSpec` regression guard (task 6.4).

## The other 10 pipelines

Ticket.md states 11 pipelines filter on `fact_issues`; the analysis above (FilterStep never reads
declared type) applies uniformly to every `=` condition against these columns regardless of which
pipeline it lives in — there is nothing pipeline-specific about the mechanism. The same applies to
any other CSV-backed source in the workspace carrying a column previously mis-declared
`integer`/`float`/`boolean`/`timestamp` whose filters use `=`/`!=`: the materialized string never
moves, so an existing `=`/`!=` comparison against a string literal is unaffected. A comparison
operator that DOES coerce to numeric first (`>`, `<`, etc., if used in a pipeline's `FilterStep`)
was already coercing via the same `toDouble` path sort/aggregate use, and remains unaffected for
the same reason.

## Static sources — the wider, less-enumerated case

Unlike CSV, no equivalent single named production source is called out in ticket.md for static
sources. The mechanism is the same in kind: `parseStaticRows` never consulted the declared
`columns[].type`, so any static source whose declared type disagreed with a stored `JsNumber`
cell (e.g. declared `integer`, stored as a JSON number) will now report `float` instead —
`Double` is what `jsValueToAny` has always materialized for every JSON number, whole or not.
`FilterStep`'s behavior argument above applies identically: no runtime cell value changes, only
the declared type. The panel-slot/assistant-`measure` accepted-cost trade does **not** apply here
in the same direction — `float` is still `Numeric`-eligible for every slot `integer` was, so a
static source's numeric panel bindings and `measure` classification are **preserved**, not lost,
by this correction (design D2's rationale). The user-visible change for static sources is
therefore smaller than for CSV: a declared type becomes more accurate with no loss of numeric
eligibility, except where a static column's declared type was `boolean`/`timestamp`/`integer` but
its stored cells are actually `JsString` — those now correctly report `string`, which does carry
the same panel-slot/assistant-`measure` cost CSV faces.

## What a user sees before their source is next refreshed

Per design D4: `data_sources.inferred_schema` for an existing CSV or static source is **not**
touched by this change at deploy time — there is no migration and no backfill (both forbidden by
the ticket's constraints). Existing sources keep their currently-stored (possibly stale/wrong)
declared type until that specific source is next **created or refreshed** through
`DataSourceService`:

- CSV: the next `POST /api/data-sources/:id/refresh` (or equivalent create) re-runs
  `SchemaInferenceEngine.fromCsv`, which now reports `string` for every column, and persists the
  corrected schema.
- Static: the next refresh goes through `applyStaticRefresh` (task 2.3), which now derives the
  registered type from the resubmitted rows' materialized JSON kinds via
  `PipelineRowJson.staticColumnRuntimeType`, rather than `payload.columns`'s declared type.

Until that refresh happens, `fact_issues` (and every other unrefreshed CSV/static source) keeps
declaring `integer`/whatever it declares today, in the UI and to every declared-type-driven
consumer — nothing about this change forces or schedules a refresh. The 17 filter conditions
behave identically either way, since (as shown above) they never depended on the declared type.
