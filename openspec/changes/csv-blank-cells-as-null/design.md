## Context

Every CSV pipeline read goes through one loader, `InProcessPipelineEngine.loadCsvRowsFromBytes` (~799): split on
`linesIterator`, `parseCsvLine`, `padTo(headers.size, "")`, every cell a `String`. It serves the run, dry-run and step
preview paths and every secondary read (`join`/`union`/`lookup` re-enter `loadRowsWithStats` via `makeContext`).
Schema inference (`SchemaInferenceEngine.fromCsvLines`), the source preview (`parseCsvRowsBytes` →
`CsvPreviewResponse`) and the first-run `ColumnClassifier` read raw strings, trim cells and already treat blanks as
empty. Dataset sources read `dataset_rows` JSON (`parseStaticRows`); SQL/REST are typed. HEL-1257 (streaming) is not on
main. `SparkJobSubmitter` has its own CSV reader but is unreachable (`executionBackend = null`); out of scope. Owner rulings (2026-10-08): blank = null at ingest; Q1–Q8 all at the recommendation (see Decisions).

## Goals / Non-Goals

**Goals:** blank CSV cells are null for every step; the owner's eight rulings implemented; a regression suite that
pins the new semantics of every consumer below deliberately. **Non-Goals:** see proposal.md.

## Decisions

**D1 — Normalize in the one loader, nowhere else.** In `loadCsvRowsFromBytes`, a cell whose `trim` is empty becomes
`null` (Q1: whitespace-only = null; quoted-empty `""` is indistinguishable from unquoted and is null too). Missing
trailing cells are padded with `null`, not `""`. A line that is empty or whitespace-only is skipped (Q2) — stricter than
the preview (`parseCsvRowsLines` skips only empty lines) and inference (skips none), which are untouched (D2); a
comma-only line `,,,` is not blank and stays an all-null row. Non-blank cells are NOT trimmed. Alternative rejected: normalizing per step
(N sites, drifts). The header row is unchanged.

**D2 — Inference, preview, classifier untouched.** They operate on raw strings with no null in their wire types
(`Vector[Vector[String]]`), already trim and treat blanks as empty; inference keeps every CSV column `string` (HEL-893
D1), so an all-blank column infers exactly as before (`string`, nullable). The preview still shows an empty cell.

**D3 — Filter compat (Q3).** In `FilterStep.evalCondition`, when the condition value is `""` (or absent, which already
defaults to `""`) and the row value is null: `=` matches and `!=` does not; `contains ""` also matches null (today
`"".contains("")` keeps blanks, so a degenerate empty `contains` keeps every row as before). All other operators and values keep strict
null semantics (`is null`/`is not null` unchanged; null never `=` a non-empty value). Applies to every source kind —
the filter cannot know where a null came from, and treating `""`-vs-null as the same "blank" is the point.

**D4 — AI/text steps (Q4).** `AnalyzeWithAiStep`, `GenerateTextStep`, `ConvertFormatStep`: `Some(null)` is treated as
`""` and flows through the same path a blank took before (so e.g. convertformat json→csv of a blank still fails
`json-malformed`, as today); `None` (absent key) still fails `field-missing`. This also applies to JSON-sourced nulls.

**D5 — Compute (Q5).** No change: null propagates (`applyFn` short-circuit, `applyOp`). Follow-up: `coalesce()`.

**D6 — Metric client count.** `MetricOutputPanel` aggregates `rowsAsRecords` built from stringified `rawRows`, where
null is `""`, so `count` counts blanks while the server headline (`OutputSummaryReducer` `count`, excludes `JsNull`)
does not. `MetricOutputPanel` receives only `rawRows` today: thread `records` (`filteredPaginationRows`) into it at
PanelContent.tsx:320 (as `ChartOutputPanel` gets at :273) and aggregate over those typed records so both agree. Rendering is unchanged: `DataGrid`
`formatCell` already shows `—` for null (Q6); chart group label `String(null)` = `"null"` client and server (Q7,
follow-up for `(blank)`).

**D7 — Consumers whose result changes with no code change (pinned by tests, release-noted).**
| Consumer | Before (blank = `""`) | After (blank = null) |
|---|---|---|
| aggregate `count` / `count_distinct` | counted | excluded |
| aggregate sum/avg/min/max/median/percentile | skipped | skipped (unchanged) |
| aggregate/groupBy key | `""` group | null group |
| pivot `count`; pivot column value | counted; `values_` column | excluded; row dropped from value columns |
| fillnull constant/forwardFill/mode | blank untouched/carried/can win | filled/not carried/ignored |
| cast date/string | `""` | null (numeric/bool already null) |
| compute `concat`/`+`/`length`/`upper` | `"a"`/`"x"`/`0`/`""` | null |
| stringops concat | null as `""` | same (unchanged) |
| sort / window order | lexicographic tier | last in both directions |
| join/lookup key | `""`=`""` | null=null (still matches; now also matches other-source nulls) |
| dedupe key | `""` key | null key |
| assert `notNull` / `unique` | passes / repeated blanks duplicate | fails / blanks ignored |
| upsert into required dataset column | `""` validated by type | rejected `required` |
| Output schema inference (`inferShallowFromJsObjects`) | date-like + blank → string | → timestamp (Q8) |
| snapshot distinct-values / column filter dropdown | `""` listed | blanks not listed |
| Output summary `count` (`OutputSummaryReducer`) | counted | excluded; numeric stats unchanged |
| table cell render | empty | `—` |

**D7b — Further consumers that change (no code change; pinned or release-noted).**
| Consumer | Change |
|---|---|
| row counts (Output `rowCount`, assert `rowCountMin`/`Max`, alert `"*"` metric) | drop by the number of blank lines; previous/rolling alert baselines see a one-time step on the first run after |
| assert `regex` | a blank (now null) fails even if the pattern matched `""` (e.g. `^$|^\d+$`) |
| upsert (`DatasetRowValidator` 136-148) | null takes the field's declared `default`; an optional numeric column accepts a blank instead of rejecting |
| Output table server sort (`NULLS LAST`) | blanks move from first to last ascending |
| `groupby` step (non-authorable) `count` | excludes blanks |
| assistant workspace grounding (`WorkspaceContextComputations`) | `nullRate` rises, distinct values / join overlap exclude blanks |

**D10 — Cross-filter on a blank category stays consistent.** Today a blank groups as `""` and "filter dashboard"
matches `""` on siblings (client `cellMatchesValue`, server `eq ''`). After D1 an aggregated chart labels the group
`"null"` (Q7), so the selection would be `"null"` and match nothing. Fix both paths so a blank selection means
"blank = `""` or null": (a) client — grouping is NOT changed (`groupAndAggregate` and
`OutputSummaryReducer` keep `String(v)`/`jsString` keying, so HEL-1271 parity, the shared fixture, sort order and the
overlay's by-label alignment are untouched; null and a literal `"null"` stay one group labelled `"null"`, as today).
Only the click VALUE changes. `useChartClickHandler` (ChartPanel.tsx:91) sees only `rawRows`,
which stringify null to `""`, so nulls MUST NOT be detected from `rawRows`. Instead `ChartOutputPanel` (which receives
`records` = `filteredPaginationRows` from PanelContent.tsx:273 on every surface) computes
`groupHasNull = records.some(r => r[groupBy] === null)` (strict `=== null`, not `== null`) and carries it on the
aggregation spec it already passes down (`ChartRenderer` → `ChartPanel` → `useChartClickHandler`);
`mapAggregateClickToSelection` returns `""` when the clicked label is `"null"` and `groupHasNull`, else `params.name`. In the rare mixed case (nulls and literal `"null"` strings in
one group) the selection is blank and the literal-`"null"` rows are not selected — accepted, documented;
`undefined` (absent key) is unchanged (`"undefined"` group; CSV rows never lack a key — D1 pads with null); `filterRecordsForAggregateSelection` uses
`value === "" ? (raw === null || raw === "") : String(raw) === value` — absent-key rows are NOT pulled into a blank
Inspect, and the `"undefined"` group's Inspect is unchanged (sibling panels' existing client/server matching already
treats an absent key as blank; unchanged) (update the HEL-1351 comment
at PanelInspectView.tsx:84-87); a non-aggregated chart already yields `""` (rawRows stringify null); sibling client
matching already stringifies null to `""`; (b) server — an `eq` op whose
value is `""` compiles to `(data ->> col IS NULL OR data ->> col = '')` regardless of cast. Same "blank" rule as D3.
Scope beyond the Q1-Q8 rulings (self-approved, release-noted): D10 applies to every source kind (a SQL/REST/JSON null
category now cross-filters to blank rows, reversing the HEL-1351 edge where it matched nothing); public and PAT
`/rows` `eq ""` now also matches null (no in-tree producer sends `eq ""` except the cross-filter — viewer controls
skip `""`); the selection header reads `team: ` (empty) for a blank click until the `(blank)` label follow-up.

**D8 — Existing snapshots** keep stored `""` until the pipeline's next run: acceptable (a run re-materializes them;
scheduled/auto runs converge). Dev DB: 0 stored step configs compare to `""`; prod not inspected; D3 covers the
`= ""`/`!= ""` case anyway. helio-news: no filter on `""`, no count_distinct; only a rare blank `ageDays` sorts last.

**D9 — Test strategy (red first).** (a) Engine-level: a CSV source fixture with blanks, run through the real loader →
`count`/`count_distinct` exclude blanks and `fillnull` fills them — written and observed RED before D1. (b) Regression
spec(s) driving each D7 row from a CSV-loaded frame (not hand-built nulls), so the assertion is about CSV blanks.
(c) Unit tests for D3, D4, whitespace-only/blank-line/padding rules, and that non-blank cells keep surrounding spaces.
(d) Frontend Jest for D6 and D10 client; backend spec for D10 server `eq ''`. Mutation proof: reverting D1 turns (a)/(b) red.

## Risks / Trade-offs

- Existing user pipelines change results (counts drop, `notNull` asserts fail, required upserts reject blanks) →
  release note in the PR body; owner ruled broad.
- Typed-source JSON nulls now pass AI steps as empty text instead of failing (D4) — accepted with Q4.
- Snapshot `""` vs fresh null coexist until rerun — D8.

## Planner Notes

- D8 addendum: the one-time alert-baseline / row-count step on the first run after deploy is acceptable, release-noted.
- Self-approved: D10 (implements the accepted Q7 label without breaking cross-filter; same blank rule as Q3).
- Self-approved: quoted-empty = null (no parser distinction exists); header row not normalized; D3 applies to all
  source kinds; MetricOutputPanel fix (driver-approved in-ticket).
- Follow-ups to file at Delivery: `coalesce()` for compute; `(blank)` category label.
