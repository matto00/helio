# Live draft preview: design (HEL-1580 spike)

Status: **spike write-up, owner rulings applied** (section 14 records the six answers verbatim). Where a section says
"owner ruling" the call is the owner's; the rest is the executor's recommendation. This document changes no runtime
behaviour. Follow-up implementation is HEL-1581 (scope: "HEL-1581 scope check" at the end).

Everything cited was read from the tree at `5074b6937`; `path:line` references are to that tree. UI answers are
written against the approved HEL-1570 boards (`PipelineLive*`, `MotionLive--preview-*`, with `HANDOFF.md`, all under
`.concertino/design/HEL-1570/` in the main checkout and not tracked by git), per the owner's start-now
ruling, not against today's pipeline page. Measurements are in
`openspec/changes/archive/2026-10-13-live-draft-preview-spike/measurements.md`; the throwaway prototype is in the same change directory
(`prototype/`) and is imported by nothing.

## 1. Summary

| Question                 | Decision                                                                                                                                                                                            | Status                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Q1 where evaluation runs | Hybrid. 23 of 27 kinds evaluate in the browser over the cached sample (9 plainly, 12 with caveats, 2 as identity); the other 4 (`chunkbytokencount`, `convertformat` and the two AI steps) are not. | Evaluator approach: **owner ruling B**                         |
| Q1 parity                | One shared vector corpus + a kind manifest, run by a Scala spec (oracle) and a Jest spec; manifest vs `PipelineStep.Registry` agreement.                                                            | **Owner ruling B** (TS evaluator + corpus)                     |
| Q2 sample                | The engine-loaded rows, head, at most 1,000, exact vs sampled label with an age; auto-capture on first editor open, then manual refresh; client memory only.                                        | **Owner rulings C and D**                                      |
| Q3 change unit           | Recompute from the edited step down; cache rows, schema and count per step.                                                                                                                         | Settled by the ticket text (see 5)                             |
| Q4 transport             | Client evaluation needs none. Server fallback: `POST` with an NDJSON streamed response over HTTP/2, single-flight, dedicated limiter. Chosen on measured latency and cost (section 6).              | **Owner ruling A (delegated), executor's evidence-based pick** |
| Q5 render                | Feed draft rows through the existing pure renderers; override the metric headline (it reads saved history today).                                                                                   | Settled by the board and a code fact (see 7)                   |
| Q6 draft vs saved        | Draft is client-only; Discard drops it; **Save & run = one new atomic bulk endpoint** (one transaction), then a run; AI steps and everything downstream are never previewed before it.              | **Owner rulings E and F**; draft-only settled by the board     |

Measured headline (real Chromium 140, 1,000 rows, three board steps): about **0.1 ms** to recompute, about **1 ms**
with render and a forced layout, about **4-5 ms** with a 4x CPU throttle; target was < 50 ms. A server round trip is
**state-dependent** on the dev machine: a session-authenticated no-op GET is ~2 ms when hot and 25-45 ms when the
database path is cold (section 6), plus ~6-9 ms of evaluation for 500 rows, plus the network RTT.

## 2. What exists today (facts the rest rests on)

- **Step kinds.** 27 are registered (`backend/src/main/scala/com/helio/domain/model/PipelineStep.scala:256-284`).
  `PipelineStep.evaluate(rows, ctx)` returns a `Future` (`PipelineStep.scala:80`). 20 kinds are pure primary-input
  transforms; 7 touch the execution context (`ctx.`): `join`, `union`, `lookup` (a lane or a source secondary:
  `JoinStep.scala:93-107`), `analyzewithai`, `generatetext` (`ctx.aiClient`: `AnalyzeWithAiStep.scala:68-69`,
  `GenerateTextStep.scala:68-69`), `upsertsource` (`ctx.writeBackSink`: `UpsertSourceStep.scala:33`) and `assert`
  (`ctx.assertionSink`: `AssertStep.scala:111`).
- **Expression language.** Scala only: `domain/engine/Expression*.scala` is 1,409 lines; the contract is
  `docs/compute-expression-grammar.md` (424 lines). Column references need `$` (`$duration_s`), the grammar is strict,
  and `round` rounds half away from zero on the decimal form (`round(-2.5)` = `-3`, `round(2.675, 2)` = `2.68`:
  grammar doc line 235; `ExpressionEvaluatorSpec.scala:637-645`). The only cross-language artifact is a name list
  (`shared-test-fixtures/compute-expression-functions.json`, 15 functions, read by `ComputeExpressionFunctionsSeamSpec`
  and `computeFunctionReference.test.ts`): no TypeScript evaluator exists.
- **Preview endpoints.** `GET /api/pipelines/:id/steps/:stepId/preview` and `POST /api/pipelines/:id/preview`
  (`PipelineRunStatusRoutes.scala:38-48`) call `PipelineRunPreview.previewAtNode` (`PipelineRunPreview.scala:148`). They
  run the **saved** config over the target step's dependency closure (`NodeDependencyClosure.closureOf`,
  `PipelineRunPreview.scala:255`), re-read the source every call (`backend.execute`, `:280`), and return **10 rows**
  plus the total and per-step counts (`:293`, `:297`). A closure with an enabled AI step runs a real model call charged
  to the pipeline owner and needs owner/editor access (`:263-267`).
- **Source row caps.** A `dataset` source is capped at 500 rows (`DataSourceService.scala:74,1427`), a CSV at
  `CSV_MAX_ROWS` = 50,000 (`CsvLimits.scala:18`), and a `rest_api`/`sql` read at the head `MaxRunRows` = 1,000
  (`InProcessPipelineEngine.scala:112,660,672`). So a run over a REST/SQL source never sees more than its first 1,000
  rows: a 1,000-row head sample is the run's own input, if the source has not changed. The existing source-level
  previews return less: `SourceService.previewRest/previewSql` take 10 rows (`SourceService.scala:423,461`) and
  `GET /api/data-sources/:id/preview` is clamped to 500 and supports only csv/dataset
  (`DataSourceService.scala:1349-1358`). No endpoint returns a 1,000-row REST/SQL sample today.
- **Rate limits.** The preview routes sit under the general `/api` limiter only (`ApiRoutes.scala:799`, 120 requests per
  60 s per principal, per instance: `RateLimitConfig.scala:11-12`). The HEL-505 limiters are different: the tighter
  source-fetch limiter (`ApiRoutes.scala:312-317`, default 30) is mounted inside `SourcePreviewRoutes` and
  `DataSourcePreviewRoutes` (`SourcePreviewRoutes.scala:42-47`, `DataSourcePreviewRoutes.scala:43-47`), and the run guard
  (rate, concurrency, owner budget) lives in `PipelineRunService.submit`, i.e. only real or dry **runs**. Production runs
  at most 2 Cloud Run instances (`.github/workflows/cd-backend.yml:91`), each with its own in-memory limiter.
- **Edits persist live.** `useStepCardPersist.ts:18,80-113` PATCHes `/api/pipeline-steps/:id` 400 ms after the last
  edit; `useStepCardPreview.ts:17,133-157` re-fetches the (saved-config) preview 500 ms after the config fingerprint
  changes. These are two independent timers, so today an edit costs two requests, and the preview can only be correct if
  the PATCH landed first. There is no bulk pipeline write.
- **Run-events SSE.** `GET /api/pipelines/:id/run-events` (`PipelineRunStreamRoutes.scala:76-98`) streams
  `RunStatusEvent`s from `PipelineRunRegistry.subscribe` (`PipelineRunRegistry.scala:98-120`: a `Source.actorRef` with a
  buffer of 8, `dropHead`; every live subscriber gets every event, `:82`), built as a hand-made chunked
  `text/event-stream` with no heartbeat. The registry completes the stream at each terminal run status (`:103-106`). The
  client reads it with `fetch` plus a `ReadableStream` (`pipelineRunFanout.ts:251-252`, `credentials: "include"`),
  shares one connection per pipeline, **aborts it when the last subscriber leaves** (`:145-151`) and reconnects after
  every terminal event (`:300-315`), reconciling first through `GET .../runs/latest` (`:183`). Each reopen therefore
  costs two requests; HEL-1438 item 2 and `openspec/changes/archive/2026-10-09-panel-remount-row-refetch/design.md`
  (lines 17-18, 156-158) record it as measured-not-fixed, and `probe-premise.md` shows the HEL-1392 burst exhausting the
  120/60 s budget ("Rate limit exceeded" on 3 of 8 panels).
- **Patch-sets.** `POST /api/patch-sets/apply` applies edits sequentially and compensates in reverse order on failure
  (`PatchSetApplyService.scala:45-50,153`); it can create/update/delete pipeline steps
  (`PatchSetApplyForward.scala:92-102`); `PatchSetUndoService` undoes an application; each update/delete target carries
  a preview fingerprint so a stale base is rejected (`PatchSetTargetFingerprint.scala:12-44`). Preview of a patch-set
  computes diffs and impact only: nothing in `services/patchsets` calls the execution engine. A whole-list reorder is the
  separate `PUT /api/pipelines/:id/steps/order` (`PipelineStepRoutes.scala:38-43`).
- **Render seam.** `OutputPreviewPane.tsx` renders `ChartRenderer`/`MetricRenderer` from in-memory rows plus an unsaved
  Output config. `OutputPanelContent.tsx` accepts `rawRows`/`headers`/`output` as props, but its chart and metric
  children call `useOutputHistory` (`MetricOutputPanel.tsx:56`, `ChartOutputPanel.tsx:78`) and the metric **headline is
  `history.current.value` of the last saved run, not the loaded rows** (`metricHistoryView.ts:118,170`;
  `MetricOutputPanel.tsx:108-109`).

## 3. Q1: where evaluation runs

### 3.1 Step-kind table (all 27 registered kinds)

Classes: **client** (a faithful port is mostly mechanical), **client\*** (client with a named parity trap; the port is
only as good as the corpus), **identity** (rows pass through unchanged; the effect or verdict stays server-side),
**server** (stays server-side). "Reuse" says whether existing TypeScript can be reused or the port duplicates Scala.

| Kind                | Class    | Evaluate                              | Reason / parity trap                                                                                                                                                                                                                                                                                                                                                                                                     | Reuse vs duplicate                                                                                                                                                                                                                                                                              |
| ------------------- | -------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rename`            | client   | `RenameStep.scala:44`                 | Key map over rows.                                                                                                                                                                                                                                                                                                                                                                                                       | Duplicate (trivial)                                                                                                                                                                                                                                                                             |
| `select`            | client   | `SelectStep.scala:41`                 | Key filter.                                                                                                                                                                                                                                                                                                                                                                                                              | Duplicate (trivial)                                                                                                                                                                                                                                                                             |
| `limit`             | client   | `LimitStep.scala:47`                  | `count <= 0` keeps all rows (`:58`).                                                                                                                                                                                                                                                                                                                                                                                     | Duplicate (trivial)                                                                                                                                                                                                                                                                             |
| `filter`            | client   | `FilterStep.scala:65`                 | `=`/`!=` coerce numerically only when the row value is itself numeric, `>`/`<` coerce via `toDouble` (`:102-150`); null rules for `contains`/`=`.                                                                                                                                                                                                                                                                        | Duplicate; the coercion differs from `aggregate.ts`'s `coerceNumber` (`aggregate.ts:36`, rejects `Infinity`)                                                                                                                                                                                    |
| `groupby`           | client   | `GroupByStep.scala:47`                | `sum`/`count` only; `authorable = false` (`:95`), so the UI cannot create one.                                                                                                                                                                                                                                                                                                                                           | Duplicate                                                                                                                                                                                                                                                                                       |
| `dedupe`            | client   | `DedupeStep.scala:75`                 | Key tuple, first/last occurrence.                                                                                                                                                                                                                                                                                                                                                                                        | Duplicate                                                                                                                                                                                                                                                                                       |
| `unpivot`           | client   | `UnpivotStep.scala:67`                | Reshape.                                                                                                                                                                                                                                                                                                                                                                                                                 | Duplicate                                                                                                                                                                                                                                                                                       |
| `extractheadings`   | client   | `ExtractHeadingsStep.scala:63`        | Fixed regex `^(#{1,6})\s+(.*)$` (`:72`): same in JS.                                                                                                                                                                                                                                                                                                                                                                     | Duplicate                                                                                                                                                                                                                                                                                       |
| `splittext`         | client   | `SplitTextStep.scala:70`              | Paragraph/heading split; fixed rules.                                                                                                                                                                                                                                                                                                                                                                                    | Duplicate                                                                                                                                                                                                                                                                                       |
| `sort`              | client\* | `SortStep.scala:86`                   | Three-tier comparator: finite numbers before everything else, then lexicographic, nulls last; tier 1 is a numeric order over finite numbers, including numeric _strings_ (`"9"` sorts with `10` and `3.5`); everything else is lexicographic; nulls last. JS `a - b` and a plain string sort are not that (probed, `measurements.md` §5). Signed zero and NaN cannot appear in the JSON corpus, so they are not vectors. | Duplicate                                                                                                                                                                                                                                                                                       |
| `cast`              | client\* | `CastStep.scala:75-97`                | `toInt`/`toLong`/`toBoolean` follow Java parsing with a `toDouble.toInt` fallback: `"0x10"` gives null (JS `Number` gives 16), `"1.9"` gives 1 (JS 1.9), `"Infinity"` gives 2147483647 (JS `Infinity`); `"1e3"` and `" 5 "` agree on both (1000, 5) and are not traps (probed, `measurements.md` §5). `date`/`timestamp` use `TimestampParsing.parseInstant`.                                                            | Reuse `parseChartInstant` (`chartTimeAxis.ts:130`, held to the Scala parser by `chart-timestamp-parsing.json`); the numeric casts duplicate                                                                                                                                                     |
| `aggregate`         | client\* | `AggregateStep.scala:64`              | 8 functions: `sum avg min max count median percentile count_distinct` (`:76`); percentile is `percentile_cont` interpolation (`:97`).                                                                                                                                                                                                                                                                                    | Partial reuse: `computeAggregate` covers `count sum avg min max` (`aggregate.ts:54`, held by `output-summary-reducer.json`, but it documents a divergence on `Infinity`, `aggregate.ts:24-35`); `median`, `percentile`, `count_distinct`, grouping by several keys and null-key rules duplicate |
| `datebucket`        | client\* | `DateBucketStep.scala:56`             | UTC floor per granularity (`floorFn`, `:96`); unparseable input becomes null.                                                                                                                                                                                                                                                                                                                                            | Reuse `parseChartInstant`; the flooring duplicates                                                                                                                                                                                                                                              |
| `fillnull`          | client\* | `FillNullStep.scala:72`               | `mean`/`median`/`mode`/`forwardFill` tie-breaks and numeric coercion.                                                                                                                                                                                                                                                                                                                                                    | Duplicate                                                                                                                                                                                                                                                                                       |
| `pivot`             | client\* | `PivotStep.scala:68`                  | Column order of the generated columns, `first` agg, null index key.                                                                                                                                                                                                                                                                                                                                                      | Duplicate                                                                                                                                                                                                                                                                                       |
| `window`            | client\* | `WindowStep.scala:101`                | `row_number rank dense_rank running_sum lag lead` + five rolling functions (`:108-112`); frame rules are config-only in TS today (`window-rolling-seam.json` checks the config, `WindowConfig.seam.test.tsx` the PATCH body). **No TS window evaluator exists: this is pure duplication.**                                                                                                                               | Duplicate; the fixture's `input`/`expected` pairs can seed corpus vectors                                                                                                                                                                                                                       |
| `stringops`         | client\* | `StringOpsStep.scala:84`              | `extractRegex` runs a Java regex; JS `RegExp` is a different dialect (lookbehind, possessive quantifiers, named-group syntax, flags). Safe subset only, else server.                                                                                                                                                                                                                                                     | Duplicate                                                                                                                                                                                                                                                                                       |
| `compute`           | client\* | `ComputeStep.scala:49`                | The expression engine: doubles, three-valued logic, `round` half away from zero on the decimal form, Java `Double.toString` in concatenation, UTC-only date functions, 15 functions, strict validation. Largest parity surface.                                                                                                                                                                                          | Duplicate (1,409 Scala lines + grammar doc). Per-config fallback: a function or construct outside the ported set sends this step to the server                                                                                                                                                  |
| `join`              | client\* | `JoinStep.scala:54`                   | A **lane** secondary is the already-evaluated client frame (exact). A **source** secondary needs that source's rows: exact only if its complete sample is cached (a sampled secondary silently drops matches). Column naming `JoinColumnNaming.resolve` (`JoinColumnNaming.scala:28`). `authorable = false`.                                                                                                             | Duplicate; else server when the secondary is not completely cached                                                                                                                                                                                                                              |
| `union`             | client\* | `UnionStep.scala:64`                  | Same secondary rule as `join`; `byName` vs `byPosition`.                                                                                                                                                                                                                                                                                                                                                                 | Duplicate; else server                                                                                                                                                                                                                                                                          |
| `lookup`            | client\* | `LookupStep.scala:80`                 | Same secondary rule; `JoinColumnNaming.resolveWithKey` (`JoinColumnNaming.scala:35`).                                                                                                                                                                                                                                                                                                                                    | Duplicate; else server                                                                                                                                                                                                                                                                          |
| `assert`            | identity | `AssertStep.scala:107` (rules `:141`) | Rows pass through; the verdicts go to a sink and block only real runs on error severity. Rule evaluation is pure, but showing verdicts live is a separate feature.                                                                                                                                                                                                                                                       | Client passes rows through; verdicts server-side (or a later port)                                                                                                                                                                                                                              |
| `upsertsource`      | identity | `UpsertSourceStep.scala:29`           | Rows pass through; the write is deferred (`PendingWrite`) and target access is checked on the server (`:47-51`). The draft must never write.                                                                                                                                                                                                                                                                             | Client passes rows through, marks "writes on Save & run"                                                                                                                                                                                                                                        |
| `chunkbytokencount` | server   | `ChunkByTokenCountStep.scala:82`      | Needs `jtokkit` BPE encodings (`:5-6`); a JS tokenizer would be a new dependency with its own drift.                                                                                                                                                                                                                                                                                                                     | n/a                                                                                                                                                                                                                                                                                             |
| `convertformat`     | server   | `ConvertFormatStep.scala:32`          | CSV/JSON/markdown conversion over whole documents; cost scales with bytes per cell (`PipelineCostEstimator.scala` classifies it out of auto-run for this reason).                                                                                                                                                                                                                                                        | n/a                                                                                                                                                                                                                                                                                             |
| `analyzewithai`     | server   | `AnalyzeWithAiStep.scala:37`          | Model call, owner-charged and tier-gated (`AiPipelineQuotaGate`); non-deterministic.                                                                                                                                                                                                                                                                                                                                     | n/a; never previewed before Save & run (owner ruling F)                                                                                                                                                                                                                                         |
| `generatetext`      | server   | `GenerateTextStep.scala:37`           | Same.                                                                                                                                                                                                                                                                                                                                                                                                                    | n/a; never previewed before Save & run (owner ruling F)                                                                                                                                                                                                                                         |

Count: 9 client + 12 client\* (`sort cast aggregate datebucket fillnull pivot window stringops compute join union lookup`)
\+ 2 identity + 4 server = 27, equal to the Registry (`PipelineStep.scala:256-284`).

The class is **kind-level**, but the decision to run a given step client-side is also **config-level**: a `compute`
using a function the port lacks, a `stringops` regex outside the safe subset, or a `join` whose secondary is only
partially cached makes that step a server step for that edit. The frontend therefore needs one function,
`clientEvaluable(step, cache) -> boolean`, and the manifest (3.3) records the kind-level ceiling.

### 3.2 Where a client evaluator duplicates server logic

Honest accounting, since the ticket asks: **almost all of it duplicates.** The reusable TypeScript is small:
`computeAggregate`/`groupAndAggregate` (`aggregate.ts:54,108`, for five of the eight aggregate functions, with the
`Infinity` divergence), and `parseChartInstant` (`chartTimeAxis.ts:130`) for timestamp parsing in `cast`, `datebucket`
and the compute date functions. Everything else (the expression engine, window, sort comparator, pivot, fillnull,
the cast numerics, join/lookup naming) is new TypeScript that must reproduce Scala behaviour, and it is cheap to get
subtly wrong (`Math.round(-2.5)` is `-2`; the grammar says `-3`).

### 3.3 Parity plan (a mechanism that can fail)

Precedents already in the tree: 12 of the 13 files in `shared-test-fixtures/` are read by both a Scala spec and a Jest
test; `output-summary-reducer.json` holds a TS aggregate evaluator to a Scala port (`aggregate.fixture.test.ts` and
`OutputSummaryReducerSeamSpec.scala`); `chart-timestamp-parsing.json` holds `parseChartInstant` to the Scala parser;
and `PipelineCostEstimatorSpec.scala:139-157` already enforces that a hand-maintained set of ops exactly partitions
`PipelineStep.Registry.keySet`. The plan reuses that exact shape.

1. **Corpus.** `shared-test-fixtures/pipeline-step-parity/<kind>.json`: a list of
   `{name, config, inputRows, expectedRows}` or `{name, config, inputRows, expectedError: <code>}` (error _codes_, not
   message text: the Scala messages are written for people and may be reworded without a behaviour change). Row values
   use JSON types only.
2. **Scala runner (the oracle).** A ScalaTest runs each vector through the real `PipelineStep.Registry(kind)` decode and
   `evaluate`, and asserts the actual output equals `expectedRows`. Because the Scala side is checked against the same
   file, the file cannot encode a hand-guessed expectation: a wrong `expectedRows` fails the Scala spec.
3. **TS runner.** A Jest test runs each vector through the client evaluator and asserts the same.
4. **Manifest.** `shared-test-fixtures/pipeline-step-parity/manifest.json` = `{kind: "client" | "client-star" | "identity" | "server"}`
   for all 27 kinds, plus a minimum vector count per non-server kind.
5. **Agreement checks (three, each independently failable):**
   - _Scala_: a spec iterates `PipelineStep.Registry.keySet` and fails when a registered kind is missing from the manifest
     or the manifest names an unregistered kind. **Mutation:** register a 28th kind without a manifest entry: red.
   - _Jest_: fails when the evaluator's registered kind set differs from the manifest's non-`server` set, or a non-`server`
     kind has fewer vectors than its minimum. **Mutation:** delete the `dedupe` evaluator, or its vector file: red.
   - _Vectors_: the TS evaluator disagrees with Scala on a vector. **Mutations:** (a) implement `round` with `Math.round`:
     red on a vector `round(-2.5) -> -3` and on `round(2.675, 2) -> 2.68`; (b) implement `sort` with `a - b`, or with a plain
     string sort: red on one mixed column `[10, "9", "abc", null, "2", 3.5, "Abc", "10"]`, where the real `SortStep` gives
     `2, 3.5, 9, 10, "10", "Abc", "abc", null`, `a - b` gives `"2", 3.5, "9", 10, "abc", "Abc", "10"` (NaN comparisons) and a string sort gives
     `10, "10", "2", 3.5, "9", "Abc", "abc"`; (c) implement `cast integer` with `Number(s)`: red on `"0x10"` (Scala null, JS 16), `"1.9"`
     (Scala 1, JS 1.9) and `"Infinity"` (Scala 2147483647, JS `Infinity`). Each divergence was run on both runtimes (`measurements.md` §5);
     `"1e3"` and `" 5 "` agree (1000, 5) and are deliberately not used.
6. **Seeding.** Vectors are authored from the Scala specs' own cases (for example `ExpressionEvaluatorSpec` and the
   `window-rolling-seam.json` `input`/`expected` pairs) and extended with the traps in 3.1. A property-style generator
   that re-derives `expectedRows` from the Scala evaluator is a later hardening, not needed to start.
7. **Config-level fallback is tested too:** a vector class `{expectClientDeclines: true}` asserts the TS evaluator
   _refuses_ (returns "needs server") on a construct outside the ported set rather than guessing.

Rejected alternatives and why: **Scala.js cross-compilation** removes duplication but adds a build toolchain to a
repo whose frontend is Vite/Jest and whose backend is sbt (and a large artifact to ship the expression engine's
dependencies); **server-only evaluation** removes duplication but pays a request, a session lookup and an access re-read on every edit (section
6). **Hand-written TS with a corpus** duplicates, but the duplication is bounded, tested against the oracle on every
run, and consistent with the repo's three existing seam fixtures. This is **owner ruling B** (`ts-evaluator-plus-corpus`).

## 4. Q2: sample policy

**What a sample is.** The rows the execution engine itself loads for that source, in its order, at most the first
`SAMPLE_MAX` = 1,000: the output of `InProcessPipelineEngine.loadRowsWithStats` (`:521`), which already applies the REST/SQL
flattening (`JsonFlattener.detectMapPaths`, `:667,676`) and the engine's row typing. Not the raw source JSON, and not
what `GET /data-sources/:id/preview` returns, because the client evaluator's parity target is the engine's rows
(an inconsistency between preview and run row shapes is a class of bug this repo has had: HEL-1015, and
`MISTAKES.md` "Schema inference from row 0" says to merge across sampled rows, never infer from the first).
**Only one option is viable** for what rows to cache: any other row shape cannot be held to the corpus.

**Exact vs sampled, and the label.** Two independent rules. (1) **Any source, static or not, whose row count exceeds `SAMPLE_MAX`** (an uploaded
CSV of 12,431 rows included; a CSV may hold up to 50,000) shows the prefix label **"first 1,000 of N rows"** and the caveat that every count and
aggregate in the preview is a statement about the sample: there the preview's numbers are materially different from a run's, and hiding it would be
the worst failure of this feature. (2) **Every non-static source** (`rest_api`, `sql`, connectors, a CSV with a live URL) **always** shows a sample
label with its capture age, whether exact or not, because a cached sample ages against the live source: "sample · 412 rows · fetched 3m ago" (exact) or
"sample · first 1,000 of 12,431 rows · fetched 3m ago" (prefix). Only the count/aggregate caveat is conditional on the sample being a prefix. The
plain board label "Static · 30 rows" applies **only to a static source whose sample is exact** (a `dataset`, capped at 500 rows, or an uploaded CSV
within 1,000 rows); it has no live counterpart to age against. The board's step counts and Output are "live" because they are exact on a 30-row source.

**Head, not random.** A random or reservoir sample is rejected: it is not reproducible across refreshes (flicker on
every refresh), and it is not what a run sees for REST/SQL (which also takes the head). The cost: a CSV sorted by date
has a biased head; the label names it.

**Size.** 1,000 is inside the ticket's 200-1,000 range, equals `MaxRunRows`, and costs ~29 KB per 500 rows on the wire
(`measurements.md`, section 2). Recompute is not the limiter: 10,000 rows recompute in 1.5 ms (6 ms at 4x), 50,000 rows in 9 ms
(35-54 ms median at 4x, p95 67-114 ms: observed run-to-run variance). The binding limits are transfer size and memory. Whether to raise it for static
file kinds was decision D; the owner ruled `head-1000-manual-refresh`: no larger cap.

**How it is taken and refreshed.** A new read-only endpoint (not an existing one: none returns 1,000 REST/SQL rows)
returns `{rows, capturedAt, sourceRowCount, truncated}` built from `loadRowsWithStats` and `SourceReadStats`
(`InProcessPipelineEngine.scala:521`; `truncationFields` already derives `truncated`/`availableRowCount`,
`PipelineRunPreview.scala:294`). Refresh is explicit (a button) plus an automatic first capture when the editor opens
with nothing cached. It must **not** re-fetch a live REST/SQL source per edit: that is the exact behaviour of today's
preview (`PipelineRunPreview.scala:280`) the owner wants gone.

**Limits (HEL-505).** A sample refresh reads the source, so it belongs under the **source-fetch limiter**
(30/min per user, own bucket), by mounting the endpoint inside `DataSourcePreviewRoutes`/`SourcePreviewRoutes`'s
`rateLimited` scope (`SourcePreviewRoutes.scala:42-47`). It must not be counted by the pipeline-run guard
(`PipelineRunService.submit`; a sample is not a run) and it needs no new limiter. Today's step previews are covered
only by the general `/api` limiter; the draft-preview endpoint in 6 needs its own.

**Where it is cached.** Owner ruling C: `client-memory`. Client memory for one page load is the simplest and loses nothing on reload except
one refresh; IndexedDB survives reloads at the cost of a persisted copy of user data in the browser (logout/tenant
hygiene: `onFreshnessReset` in `outputFreshness` already exists for the panel caches and would need to cover it); a
server-side store is new persistence (migration, RLS, retention) that nothing else needs yet.

## 5. Q3: change unit and per-step cache

**Recompute only from the edited step down.** The ticket states it (Q3: "recompute only from the edited step downward"),
the owner's guidance is that "diffs stay small", and the board shows exactly this: dragging the Step 1 slider updates
Step 1's count, the table, then Steps 2-3 and the Output (`PipelineLive--step1-filter-dragged.png`). The alternative
(recompute everything) is also fast at 1,000 rows (the prototype's step-3 edit is 0.03 ms vs 0.11 ms for the whole
pipeline) but is not what the ticket asks and does not scale to the 10-50k-row case.

**Per step the client caches:** the output rows (by reference; frames are immutable, so a step whose config and input
are unchanged is skipped by identity), the inferred column list and types for the editor, the row count, a per-step
`status` (`ok | error{code} | needsServer | stale`), and the config fingerprint the frame was computed for. Dependencies
come from the same edge set the engine uses: `parentStepId` plus lane secondaries
(`InProcessPipelineEngine.laneDependencyOf`, `:122`; `NodeDependencyClosure.closureOf`, `NodeDependencyClosure.scala:50`).
The client port of the closure/walk is small but it is a second implementation: it needs its own vectors (a rejoin
whose secondary is a non-ancestor lane, the HEL-970 case).

**An error in step _k_** (a client parse failure or a config the server would reject) freezes steps _k+1.._ at their
last good frames marked `stale`, so the preview does not flash empty. The client and server need not agree on message
text, only on _whether_ a step fails; the corpus covers it with `expectedError` codes. A draft can still pass the client
and fail the server's stricter write-path validation (`validateRawConfig`, `PipelineStep.scala:197`): that failure
surfaces at Save & run, attributed to the step, with the draft kept.

## 6. Q4: transport for server-evaluated steps (owner ruling A: lowest latency and cost, size irrelevant)

**Owner ruling A** delegates the choice and sets the only criterion: "whichever is most efficient in terms of latency and
cost", with implementation size explicitly not counting ("if we need to build more scaffolding to support it, we should").
So this section picks on measured per-edit latency and cost alone; "least work" is not an argument anywhere below.

**First, client evaluation needs no transport.** After the one-time sample load, an edit to a client-evaluable step makes
zero requests. Today's flow costs two (PATCH + preview GET). Transport only matters for the server fallback: the server-only
kinds (`chunkbytokencount`, `convertformat`), an unported compute function, a partially cached secondary. **AI steps never
run before Save & run (owner ruling F)**, so they are not part of this path.

**What the fallback is.** A pure function `evaluate(draft steps, input frame) -> per-step counts, schema, preview rows`:
`POST /api/pipelines/:id/draft-preview`, body = the draft configs from the edited step down and the input frame the first
server step needs (normally the client's own cached frame, so the server evaluates exactly what the client holds and never
re-fetches a live source). It reuses `PipelineExecutionBackend.execute` over supplied rows and does not exist today.

### 6.1 Measurements (all local loopback; `measurements.md` sections 2 and 4)

- **Warm per-edit latency** (a 7 ms simulated evaluation; median ms over 300 edits): POST request/response 8.4 (HTTP/1.1) and 8.4
  (HTTP/2); POST + NDJSON 8.3 and 8.4; POST + separate SSE stream 8.3 and 9.4; WebSocket 7.2. Everything is within ~1.3 ms, and
  payload size (1 vs 29 KB) is invisible. WebSocket is lowest by ~1.2 ms (no per-message HTTP framing), SSE over HTTP/2 highest.
- **Time to the first usable result with several server steps** (3 steps x 30 ms): a single JSON body 91.6 ms; NDJSON, one line per step,
  **32.4 ms** for the first step's count and 91.5 ms for the last. The board shows per-step counts, so this is a real per-edit latency
  gain for NDJSON whenever a server step is not trivial.
- **Superseded edits.** Both HTTP versions let the server observe every abort (50 of 50). On HTTP/1.1 an abort closes the TCP connection
  (about 55 connections for ~900 requests), so the next edit pays connection setup; on HTTP/2 an abort is an RST_STREAM on a live
  connection (1 session in the whole HTTP/2 phase). A WebSocket has no per-message abort: cancellation is a protocol message the server
  must implement.
- **Cold first edit, round-trip counts (facts of the protocols; loopback cannot show them):** HTTP = TCP + TLS 1.3 + request = 3 RTT,
  WebSocket = TCP + TLS + upgrade + message = 4 RTT; any warm edit = 1 RTT. With an assumed 40 ms RTT: cold ~120 ms vs ~160 ms, warm ~47 ms.
- **Server-side cost of the DB path.** A session-authenticated no-op `GET` measured ~1.9 ms in the hot state and about 25-45 ms in a cold state
  (after >= 60 s idle; decays); `/health` and a no-cookie 401 stayed 1-5 ms throughout, so the extra time is on the DB path
  (`UserSessionRepository.findValidSession`, `UserSessionRepository.scala:25-35`). A long-lived channel authenticates once; a request
  per edit pays the session lookup each time (~2 ms hot). The access re-check HEL-1516 requires before an execution
  (`PipelineRunPreview.scala:108-120`) is a DB read per evaluation under **every** transport, including a socket that checked at open.
  The evaluation increment itself is ~6-9 ms for 500 rows (preview minus same-run baseline).

### 6.2 Cost (counted from the code and config, not measured)

| Cost                                                                                                          | POST request/response                           | POST + NDJSON response         | POST + SSE result stream                                                                                                                                          | WebSocket                                                                                              |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Requests per edit against the 120/min `/api` limiter (`RateLimitConfig.scala:11-12`)                          | 1 (single-flight, >= 600 ms floor: <= ~100/min) | 1 (same)                       | 1 POST, plus 2 per stream (re)open (`runs/latest` + `run-events`, HEL-1438 item 2)                                                                                | 0 after the upgrade: **messages are invisible to every per-request limiter** (620 messages, 0 counted) |
| Cloud Run concurrency slot (80/instance, `infra/deploy-backend.sh:115`; max 2 instances, `cd-backend.yml:91`) | held ~10-100 ms per edit                        | held for the evaluation (same) | the POST is short, but the stream holds a slot for the editor session                                                                                             | held for the whole editor session: 160 open sockets saturate the API for everyone                      |
| Cross-instance delivery                                                                                       | none (stateless)                                | none (stateless)               | needs a keyed registry on the Postgres notify bus (`PipelineRunNotifyBus`); a `NOTIFY` payload is capped at 8,000 bytes (PostgreSQL), a 1,000-row frame is ~58 KB | none needed once connected, but a Cloud Run timeout forces a cold reconnect (4 RTT)                    |
| Abort of a superseded edit                                                                                    | free (RST_STREAM on HTTP/2)                     | free (RST_STREAM on HTTP/2)    | abort the POST; the stream stays                                                                                                                                  | app-level cancel message                                                                               |
| Browser connection slots                                                                                      | none held between edits                         | none held between edits        | one held (HTTP/1.1: 1 of 6 per origin; `run-events` already holds one per pipeline)                                                                               | one held                                                                                               |

`--no-cpu-throttling` (`cd-backend.yml:91`) means idle open sockets cost no extra CPU billing, but the concurrency arithmetic above is
unchanged: a held stream or socket is a request in flight for its whole life.

### 6.3 Decision

**POST with an NDJSON streamed response, over HTTP/2** (fetch-streaming). It ties the other HTTP options on warm latency, beats them on
time-to-first-step (32 ms vs 92 ms in the multi-step case), and costs the same as plain request/response (one request, no held slot
between edits, stateless across the 2 instances, free abort that keeps the connection warm). It dominates SSE (higher latency, an extra
stream, the notify-bus size limit, held slots) on both axes. Against WebSocket the trade is **~1.2 ms warm on loopback (about 3% of a
~47 ms edit at an assumed 40 ms RTT, and WebSocket still pays the per-evaluation ACL read, so its real saving is only the ~2 ms session
lookup) against** a held concurrency slot per editor, a bypassed per-user limiter (which would have to be re-implemented per message), a handshake that is a `GET` and so skips the CSRF header check (`AuthDirectives.scala:179-190` exempts `GET`) while the production cookie is `SameSite=None`, +1
RTT on every (re)connect and no abort primitive. That is a dominated trade on the owner's cost criterion and an immaterial gain on latency,
so this is not a tie and not escalated; if the owner weighs a ~1-3 ms gain above those costs, WebSocket is the only option that could win and
the numbers are here to rule on. Streaming through Cloud Run's front end is already proven in this repo by the production `run-events`
stream; HTTP/2 to browsers is the Google front end's standard behaviour and is an **assumption** here, not verified. If production were
HTTP/1.1, a superseded in-flight edit would cost a reconnect (+2 RTT): the mitigation is to let the stale request finish and ignore its
result rather than abort.

**Mechanics to build (scaffolding is explicitly welcome):** a `Source[ByteString]` chunked response like `PipelineRunStreamRoutes.scala:97`
emitting one line per step (`{step, count, schema}`) then one final `{rows}` line; the client reads it with the same `fetch` +
`ReadableStream` pattern as `pipelineRunFanout.ts:251`; single-flight with an `AbortController`; a trailing debounce of ~300-400 ms with a
floor of ~600 ms between sends (a continuous drag sends <= ~100 requests/min; unbounded 3/s would be 180, above 120).

**Limits and where the endpoint is mounted.** Every `/api` request passes the general 120/min per-principal limiter first: `rateLimitDirective.rateLimit()`
wraps the whole authenticated tree (`ApiRoutes.scala:799`), and the dedicated limiters (source-fetch `:312-317`, product events `:322`) are nested
**inside** it, so both counters tick on every matched request (the comment at `:301-311` says so). A dedicated draft-preview limiter nested the same
way could therefore never bind before the general one: a continuous drag at the ~100/min client floor would leave ~20 requests/min for every other
request on the page, which is the HEL-1392 exhaustion again, and the user's other requests would fail while editing (a latency and cost loss under
ruling A). Coherent design: **mount the draft-preview route outside the general bucket and give it its own `RateLimitDirective` instance, bucket and
env var** (default 120 per 60 s per principal, per instance), so a drag spends only its own budget and the page's other requests keep the full
general 120/min. That needs one new piece of scaffolding: the general directive must skip this path (a path-based exemption in or around
`RateLimitDirective`, or mounting the route in a branch that sits before `rateLimitDirective.rateLimit()` but after authentication). The route must still apply **everything the general wrap's neighbours apply**: authentication (session or PAT), the CSRF
header on `POST` (`AuthDirectives.scala:179-190`), and **`confineScopedToken`** (the HEL-369 chokepoint, which in the tree sits _inside_ the general rate-limit
wrap, so a branch hoisted above it must re-apply it or a hook-scoped token could reach draft-preview). Only the shared counter is skipped; the path-exemption
option (a skip inside the general directive) avoids hoisting altogether and is the safer implementation. The run guard
is the wrong shape for it (`PipelineRunService.submit`: DB-backed rate/concurrency/owner budget for runs; a draft is not a run and must not consume
run slots or appear in history). Unauthenticated or invalid-credential requests are unthrottled by either directive today (HEL-837), unchanged here.

**AI steps (owner ruling F).** `analyzewithai` and `generatetext` never run before Save & run, and neither does anything downstream of
them: those steps' cards and every later step show "not previewed (AI step): runs on Save & run", and any Output on a not-previewed
node renders its saved data labelled stale. There is no per-step "Preview with AI" button. (Today's saved-config preview still executes an
enabled AI step and charges the owner, `PipelineRunPreview.scala:263-267`; that endpoint is unchanged by this design but the editor stops
calling it.)

## 7. Q5: rendering the Output from draft rows

The pure-props seam exists but is narrower than it looks. `OutputPreviewPane` (an unsaved Output config over in-memory rows,
the chart and metric renderers `ChartRenderer`/`MetricRenderer`) is network-free and is the right base. `OutputPanelContent`
looks like the better reuse (it is what the dashboard renders) but its chart and metric children fetch history
(`useOutputHistory`), and the metric headline comes from the **last saved run** (`metricHistoryView.ts:118,170`;
`MetricOutputPanel.tsx:108-109`): feeding it draft rows would still show the saved headline, which is exactly the
bug a live preview must not have. So:

- Render with the `OutputPreviewPane` path (or a new thin component with the same props) over the draft rows of the
  Output's node, using the unsaved Output config; no snapshot is written; no history is fetched per edit.
- The board's tiles (`ROWS OUT`, `AVG MINUTES`, "-2 vs last run") are computed from the draft rows with
  `computeAggregate` (`aggregate.ts:54`, already used by `OutputPreviewPane`), and the "vs last run" baseline is the **one**
  prefetch of `GET /api/outputs/:id/history` at page load, cached (see the conflict resolution in the HEL-1581 section).
- A parity test (HEL-1581's render AC): the same Output rendered from draft rows and from the saved run's rows give identical
  tile values and chart series, and a metric whose saved history differs from the draft rows shows the **draft** value.
- The board's "live" pill means "computed from the current draft", not "streaming": it is on whenever the frames are fresh
  and off (or "stale") while a server fallback is in flight or a step is in error.

## 8. Q6: draft vs saved, Discard, Save & run, undo (owner ruling E: a new atomic bulk endpoint)

- **Draft is client state only.** The board's header says "Draft · unsaved changes" and the Output caption "Rendered from the draft.
  Nothing is written until you save and run"; `HANDOFF.md:32` says "Nothing is saved until Save & run". Consequence for HEL-1581: today's
  per-edit PATCH (`useStepCardPersist.ts:80-113`) and the saved-config preview refetch (`useStepCardPreview.ts`) are replaced for editor
  edits, not kept alongside.
- **Discard** drops the draft and re-derives every frame from the saved pipeline (cached frames are by-reference copies of the base).
- **Save & run** is **one new endpoint that saves the whole draft in one call**, then starts the run. **Owner ruling E overrides the
  earlier recommendation to reuse `POST /api/patch-sets/apply`**: that path is sequential with compensating rollback
  (`PatchSetApplyService.scala:45-50,153`), so a crash between edits leaves a partial state; the owner wants a single transaction. The
  design below is grounded in what exists.

### 8.1 Shape

`POST /api/pipelines/:id/draft/save` (name indicative), body `{baseFingerprint, steps[], outputs[], runAfterSave?: "run"|"dryRun"|null,
confirmCascade?: [...]}`. `steps[]` is the **final desired step tree** (existing ids kept, new steps carry a `clientId`, `parentStepId`,
`rootId`, `type`, `config`, `enabled`), the same shape the single-call create already accepts (`CreatePipelineRequest.steps` with `clientId`
keys, resolved by `PipelineCreateTransaction.buildStepsAction`, `PipelineCreateTransaction.scala:196-216`). The server diffs it against the
current definition and applies creates, updates, deletes, re-parenting and trunk order together. It is **declarative** (final state), not a
list of operations, so reorder, delete-with-cascade and create-under-a-new-parent have no ordering hazards for the client.

### 8.2 Transaction

One database transaction covering step creates, updates, deletes and reorder plus Output edits. The precedent is
`PipelineCreateTransaction.createTransactional`: it composes a `DBIO` chain and runs it with `pipelineRepo.runTransactionally(user.id.value)`
(`PipelineCreateTransaction.scala:76-87`; `PipelineRepository.scala:506`, which is `ctx.withUserContext(userId)`), aborts the whole
transaction through `DBIO.failed(PipelineCreateValidationFailure(err))` and maps it back to a typed `ServiceError` after rollback
(`:87-89`). Gaps the new work must close, because the existing step writes are **not** composable: `PipelineStepRepository.updateInternal`
(`:487`), `deleteInternal` (`:994`), `reorderTrunkInternal` (`:866`), `spliceInsertAtInternal` (`:638`) each return a `Future` and run their own
transaction; only `insertInternalAction` (`:410`), `attachTailInternalAction` (`:776`) and `removeRootCascadeAction` (`:1200`) are `DBIO`. So the
endpoint needs `DBIO` variants of update, delete (with the cascade `removedByDeleteInternal`, `:1036`), and reorder (including its lane-cycle
guard, `LaneCycleOnReorderException`, HEL-1523, and the `PipelineCycleGuard` the create path already runs), composed into one chain. The
upsertsource first-run rewrite (`rewriteUpsertTargetAction`, `:124`) is already a `DBIO`.

### 8.3 Stale-base detection: the guarantees HEL-1581 must meet

The client sends `baseFingerprint`, the fingerprint of the pipeline definition it started the draft from. Reuse the existing one: the `pipeline`
fingerprint covers `name, tag, roots, steps, outputs, schedule` (`PatchSetTargetFingerprint.scala:43`), computed from `PatchSetPipelineDefinition.of`
(`PatchSetPipelineDefinition.scala:22-30`) and today issued only by patch-set preview, so the editor's pipeline read must also return it (new field).
The server recomputes it inside the save's transaction and compares.

This section states **what must be true**. The locking protocol that achieves it is **not proven here**: a candidate is given below, labelled
unverified, and **HEL-1581 (c) owns the verified protocol and its specs.**

**Guarantee G1, atomicity against every writer of fingerprinted state.** Between the save's fingerprint read and its last write, no other transaction
may commit a change to anything `PatchSetPipelineDefinition.of` reads (`PatchSetPipelineDefinition.scala:12-15,31-36`): the pipeline row (name, tag, roots),
the steps, the Outputs and their configs, the schedule, and, through the Output cascade, the panel ids bound to each Output and the alert rules
targeting it (`id, metric, condition, name, enabled, severity`). The writers in the tree, by table:

| State the fingerprint reads                  | Writers (file:line)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| steps (`pipeline_steps`)                     | `PipelineStepRepository`: `insertInternal` (:391), `insertInternalAction` (:410), `updateInternal` (:487), `insertAtInternal` (:572), `spliceInsertAtInternal` (:638), `spliceInsertReportingInternal` (:665), `attachTailInternal` (:762) / `attachTailInternalAction` (:776), `reorderInternal` (:817), `reorderTrunkInternal` (:866), `deleteInternal` (:994, calls `lockForDeletion` at :1015), `removeRootCascadeAction` (:1200, `lockForDeletion` at :1205), `rewriteUpsertTargetAction` (:124, run-triggered; locks only its own step row today). `update` (:278) and `insertRootStep` (:252) have no production callers (grep).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Outputs and configs (`outputs`)              | `OutputRepository`: `insertInternal` (:216), `insertInternalAction` (:238), `updateOwned` (:282), `deleteWithPanelsInternal` (:318, `lockForDeletion` at :320). `updateSchemaInternal` (:273) writes `schema`, not fingerprinted (`OutputKeys`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| roots (`pipeline_roots`)                     | `PipelineRootRepository`: `add` (:78), `addAction` (:137), `removeAction` (:150); **and the cascade from a data-source delete** (`pipeline_roots.data_source_id ... ON DELETE CASCADE`, `V98__pipeline_roots.sql:81`), which removes that root, its steps, its Outputs and their panels: `DataSourceRepository.delete` (:271-282, `lockForDeletion` at :279).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| the pipeline row (name, tag)                 | `PipelineRepository`: `updateName` (:311), `delete` (:511, `lockForDeletion` at :519), create (:340, :431: a new row, nothing to race). No separate tag writer exists (grep). Run-maintained fields (`updateLastRun*`, `updateLastSourceSchema*`) and `updateAfterTickInternal` (`PipelineScheduleRepository.scala:96`) are outside the fingerprint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| schedule                                     | `PipelineScheduleRepository`: `upsert` (:73), `delete` (:79).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| bound panels (`panels.output_id`)            | **Writers of `output_id` (insert, rebind, delete):** `PanelMutationRepository` (`PanelMutationOps`): `insertPlaced` (def :25, insert :27), `duplicate` (def :38, insert :75), `batchUpdate` (def :88, the config patch that writes `output_id`, :129-131: the batch "Swap output" path), `insertBatchPlaced` (def :168, inserts :170); `PanelRepository.replace` (:255, update :262; caller `PanelPatchApplier.scala:53`: the single-panel "Swap output" path) and `delete` (:230; caller `PanelLifecycleWrites.scala:46`); `DashboardSnapshotRepository.duplicate` (:22, panel inserts :63-64) and `importSnapshot` (:129, :191-192); `DashboardContentsOps.replaceContents` (:51, deletes then inserts panels, :66-67); the dashboard deleters, which cascade to panels (`panels.dashboard_id`, V2:4): `DashboardRepository.delete` (:199, `lockForDeletion` first). `PanelRepository.insert` (:211) has **no production caller** (only scaladoc mentions: `PanelCreateBuilder.scala:26`, `PanelBindingChecks.scala:37`, `PanelServiceHelpers.scala:168`): dead. `updateTitle` (:218), `updateAppearance` (:236) and the title/appearance branches of `batchUpdate` (:100, :116) do not write `output_id`. A panel create also locks its dashboard first (`PanelLayoutPlacement.scala:29-33,47`). `configColumnsOf` (:309-338) is the column-tuple helper, not a writer. |
| alert rules (`alert_rules.target_output_id`) | `AlertRuleRepository`: `insert` (:78, write :79), `update` (:85, write :90: sets `metric, condition, name, enabled, severity, updatedAt` only, **no alert-rule writer retargets `target_output_id`**), `delete` (:99, write :100). The alert evaluator's own writes were not enumerated here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| whole-pipeline or whole-subtree removal      | every existing `lockForDeletion` caller: `OutputRepository.scala:320`, `PipelineRepository.scala:519`, `PipelineStepRepository.scala:1015` and `:1205`, `DataSourceRepository.scala:279`, `WorkspaceTeardownRepository.scala:166` (which deletes pipelines whole), plus the dashboard deleters (`DashboardContentsOps.scala:61`, `DashboardRepository.scala:199`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| reached through services                     | patch-set apply and undo, step/Output/root services, the proposal/create paths and MCP tools call the repositories above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Guarantee G2, no deadlock with the tree's existing lock order.** `PanelRowLocks.scala:11-21` is the system-wide order: panel rows by id, then
dashboard rows by id, then Output (and pipeline, step, root, source) rows; `lockForDeletion` must be a transaction's **first write**, **called exactly
once** (V129, V130: `hel1498_lock_panels` also locks the affected dashboards, because a panel create locks its dashboard `FOR UPDATE` before taking the
FK key-share on the Output). The save must follow it. The tree already accepts residuals, which the save inherits and must not widen: a panel
created after the pre-lock and then deleted by the same cascade is locked late (HEL-1485), and a dashboard gaining its first panel bound to a deleted
Output after the call is locked late, and **a second panel create on it can still deadlock** (HEL-1534's own caveat, `PanelRowLocks.scala:11-21`).

**Guarantee G3, undo-journal completeness.** The journaled prior definition is exactly the state the save replaced, including the bound panel ids and
alert rules (8.5). That is only true if G1 holds for those two cascade tables as well; otherwise a panel bound during the save is deleted outside the
cascade the user confirmed and is missing from the journal.

**UNVERIFIED candidate protocol** (a starting point for HEL-1581 (c); it has not been run, and an earlier version of this section had an order that
deadlocks, see below). Order, consistent with `PanelRowLocks.scala`:

1. **`PanelRowLocks.lockForDeletion(pipelines = Seq(pipelineId))`, once, as the save's first write.** It locks the bound panels and their dashboards
   (under the SECURITY DEFINER bypass, which the acting user needs for panels on other users' dashboards).
2. then the **pipeline row** (Lock 1);
3. then the pipeline's **Output rows** `FOR UPDATE`, in id order (conflicts with the FK key-share a new panel or alert-rule bind takes on the Output);
4. then the **alert rules** targeting them `FOR UPDATE`, in id order.

Then read the fingerprint and compare; on a match write; the whole thing in one transaction.

Consequences of the candidate that HEL-1581 must carry through:

- **Every existing `lockForDeletion` caller takes the pipeline-row lock after that call**, not at the start of its transaction, or an Output delete that
  holds the pipeline row while waiting on panels can deadlock with a pipeline delete that holds the panels while waiting on the pipeline row.
  Callers: `OutputRepository.scala:320`, `PipelineRepository.scala:519`, `PipelineStepRepository.scala:1015` and `:1205`, `DataSourceRepository.scala:279`
  (which must take the pipeline-row lock of **every pipeline with a root on the source**, in pipeline-id order), `WorkspaceTeardownRepository.scala:166`.
- **Every other writer in the table above takes the pipeline-row lock** (steps, Outputs, roots, the pipeline row, the schedule), and panel and alert-rule
  writers are covered by step 3 (Output key-share) and by step 1/4 (row locks) rather than by the pipeline row.
- **Lock strength:** use `FOR NO KEY UPDATE` rather than `FOR UPDATE` for the pipeline row. `PipelineRunRepository.scala:343-349` (the HEL-1518 in-transaction run guard, the first action of a node's snapshot transaction, not run submit) takes the pipeline row
  `FOR KEY SHARE`, and so does every child-FK insert (runs, steps, roots); `FOR UPDATE` would serialize every step edit against run inserts, while
  `FOR NO KEY UPDATE` excludes the other Lock 1 holders equally and does not block key-share.
- **Residual risk:** the two the tree already accepts (HEL-1485, HEL-1534, above), plus the unenumerated alert-evaluator writes (its lock order against
  step 4 must be checked).
- **Why the earlier order was dropped:** it locked pipeline, then Outputs, then panels, then dashboards. A panel create locks its dashboard first and then
  takes key-share on the Output, so the two deadlock; a throwaway PostgreSQL 18.4 reproduction (a panel-create transaction against the earlier-order save)
  deadlocked in 2 of 2 runs, and did not when the save followed the tree's order (panels, dashboards, pipeline row, Outputs).

**What HEL-1581 (c) owns:** the verified protocol and its required specs: (1) a **two-connection race spec** for each writer class above against a save
(each panel writer in the G1 table: `insertPlaced`, `duplicate`, `batchUpdate`, `insertBatchPlaced`, `PanelRepository.replace`, dashboard duplicate, dashboard import, `replaceContents`, dashboard delete; alert-rule insert/update/delete; a step PATCH; a source delete; an Output delete) asserting the save either sees the change
(409) or the writer waits or fails cleanly; (2) a **deadlock spec** running a panel create, a pipeline delete, an Output delete, a source delete and the
save concurrently and asserting no `40P01`; (3) an **RLS spec run as a role without `BYPASSRLS`** (the dev and CI role bypasses RLS). The starting point
for (2) is the reproduction used in review of this document: a scratch PostgreSQL 18.4 cluster with `pipelines/outputs/dashboards/panels` tables shaped
like the tree's FKs, one session doing a panel create (lock the dashboard `FOR UPDATE`, sleep, insert the panel) and another doing the save's locks in
the order under test, run repeatedly; it is described here, not copied into the repo.

Running the save at `SERIALIZABLE` with retry is **not** a substitute: PostgreSQL's serializable isolation only tracks read-write conflicts between
transactions that are themselves serializable, so a concurrent `READ COMMITTED` writer that changes rows the save read but does not write would not be
detected (only a direct write-write on the same row would).

#### 8.3.1 The verified protocol (HEL-1629; supersedes the UNVERIFIED candidate above)

Everything below was run, not argued: the lock sites sit behind the `LockSite` seam (`PipelineDefinitionLocks`), so a race spec can remove exactly one lock and
show itself red. Evidence is kept in `openspec/changes/atomic-draft-save-endpoint/evidence/` (`red-green-log.md` is the index).

**Order O\*** (every transaction that takes more than one of these takes them in this order):

0. `data_sources` rows (`FOR UPDATE` by a source delete or a teardown of tagged sources; `FOR KEY SHARE` by a root add)
1. `PanelRowLocks.lockForDeletion`: panels, then dashboards, **once and first** (`hel1498_lock_panels`)
2. the cycle advisory lock (`PipelineCycleValidator.AdvisoryLockKey`), only when an `upsertsource` ExistingSource edge is added or changed
3. the pipeline row `FOR NO KEY UPDATE`, through the SECURITY DEFINER `hel1629_lock_pipelines(text[], text[])` (migration **V137**)
4. alert rules `FOR UPDATE` by id
5. Outputs `FOR UPDATE` by (position, id)

The save runs on the privileged pool after a service-level owner-or-editor check, because an editor's RLS view hides panels on a third user's dashboard and
alert rules owned by someone else; a lock that silently matched zero rows there would be no lock at all (V137 returns the locked count; the save asserts it).
The fingerprint is compared **after** the locks are taken, the plan is re-derived from the locked state, and only then does the cascade gate run.

**Amendments to the candidate, each confirmed by a probe or a red spec, not by reading code:**

| #    | Amendment                                                                                                                                                                                                                | Cause (probe or spec that was red)                                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1   | Outputs are locked by (position, id), not id                                                                                                                                                                             | the node-snapshot transaction inserts history points in position order; `DraftSaveDeadlockSpec` "node-snapshot" control deadlocks with id order                                                                                        |
| A2   | alert rules are locked **before** Outputs                                                                                                                                                                                | alert-event FK checks take rule then Output; control "alert evaluator" deadlocks with the candidate's order                                                                                                                            |
| A3   | the upsert write-back rewrite takes advisory, then (3), then the step row                                                                                                                                                | `DraftSaveDeadlockSpec` "upsert write-back rewrite" control                                                                                                                                                                            |
| A4   | teardown locks tagged sources first                                                                                                                                                                                      | `DraftSaveDeadlockSpec` "workspace teardown" control; `DraftSaveSetRaceSpec` teardown control                                                                                                                                          |
| A5   | an Output delete takes (3) after (1)                                                                                                                                                                                     | `DraftSaveDeadlockSpec` "Output delete" control                                                                                                                                                                                        |
| H'   | a source delete locks the source row `FOR UPDATE` first, then (1), then (3) over every pipeline rooted on it (read inside the function); a root add takes `FOR KEY SHARE` on the source before the advisory lock and (3) | `DraftSaveSetRaceSpec` three-session race: red without the source-row lock (a root added between the delete's read and its DELETE is deleted away unlocked)                                                                            |
| V137 | the function takes a second argument `p_source_ids`                                                                                                                                                                      | the source's owner cannot see another user's pipeline rooted on it under RLS, so the caller cannot name those pipelines; `V137LockPipelinesMigrationSpec` proves it as a non-BYPASSRLS role. Amends design D11, which had one argument |

**Which spec is red without which lock (G1).** `DraftSaveRaceSpec` has one block per writer; each runs **writer-first** and **save-first**, asserts the
violation oracle (the save returned 200 AND EITHER the writer committed while the save was parked inside its window, OR, writer-first, the writer committed a change before the save did: the client's base predates it, so a 200 is a lost update, which is what only a lock taken BEFORE the fingerprint read prevents), and a **control** that removes only that
writer's protecting lock site and must be red. Writer-first red, recorded **before** any writer was instrumented, is `evidence/races/R0-pre-instrumentation.log.txt`
(30 failures); green with the locks is `R1-with-locks.log.txt` (127 of 127, 60 of them controls that are red by design). The writers: panel insertPlaced,
duplicate, batchUpdate, insertBatchPlaced, replace, delete; dashboard duplicate, import, replaceContents, delete; alert rule insert, update, delete; Output create,
update, delete; pipeline rename, delete; step PATCH, insert, insert-at, splice, attach, reorder, trunk reorder, delete; root add, root remove; schedule upsert, delete;
the upsert target rewrite; source delete. Writers that are only excluded by (1) or (4) (panels, alert rules, dashboards) get no pipeline-row lock: adding one
would not make their spec any less red-able and would widen the lock surface (C1); their spec is the proof they need none. Output delete is excluded by BOTH its own (3) and the save's (5) on the Output row, so its control removes both (`LockSite.OutputDelete`, `LockSite.SaveOutputs`); the writer's (3) after (1) is there for G2 (A5). The two set-reading writers (a
source delete and a root add on one source, a teardown) are raced with **three** sessions in `DraftSaveSetRaceSpec` (`R0b-set-race-pre-instrumentation.log.txt`
red, green in `R1`).

**Mutation M4 (fingerprint read before the locks).** Moving the fingerprint read above `lockDefinition` (`mutations/M4-fingerprint-read-before-locks.diff`) leaves the old oracle fully green while a lost update occurs; with the corrected oracle it turns 19 writer-first runs red (`mutations/M4-fingerprint-read-before-locks.log.txt`), and the unmutated tree is green again (`races/R3-corrected-oracle-with-locks.log.txt`, 136 of 136 including the new Output delete block and the editor root pins).

**Serial-order oracle and the step-delete lost update (final gate F1).** "No fingerprint violation" is not enough: a writer that WAITS correctly behind the save but then writes from a row it read before its lock still loses the save's change. `deleteInternal` read the deleted step's parent/root/position before (3) and promoted the head child to that stale place after the save had moved the step. The race oracle now takes an optional `serialCheck`: when the save committed and the writer succeeded, the stored state must equal the save-then-writer serial outcome (a writer that fails instead of completing also fails it). Red on the pre-fix tree: `evidence/cycle3/F1-step-delete-red-before-fix.log.txt`. The fix re-reads the step row, its existence and the removal set under (3). Panels are locked once, in (1), over the pre-lock removal set and cannot be locked again after (3); if the locked removal set exceeds it (a racer attached a tail below the target in between) the attempt writes nothing and the delete retries in a fresh transaction, at most 3 times (chosen over a 409 because the caller asked for a delete that is still valid, the retry is cheap, and it is bounded; exhaustion would need three consecutive concurrent attaches inside one lock wait). Mutations: M5 promotes to the pre-lock place and M6 removes the retry; both turn the matching `DraftSaveRaceSpec` cases red (`evidence/cycle3/`). Every other writer was audited for a read-before-lock that feeds a write; the result is `g1-writers.md` Table D (no other confirmed instance).

**Deadlock coverage of step delete and root remove (final gate F2).** Cycle 1 claimed deadlock-spec coverage for step delete, reorder, splice and root remove that did not exist. `DraftSaveDeadlockSpec` now has "a step delete against the save" and "a root remove against the save", each with the verified order (panels, then the pipeline row) that must not deadlock and an opposite-order control (`StepDeletePanelsFirst`, `RootRemovePanelsFirst`) that must raise `40P01`. Moving (3) before (1) in either writer (mutation M7, the skeptic's SK3) turns them red. Reorder, splice, attach, insert and update take only (3) and then write step rows: an order argument, stated as such in `g1-writers.md` Table B.

**Count assertions (D5).** `hel1629_lock_pipelines` returns the locked count. Only the SAVE asserts it (a short count is its 404). A single-pipeline writer (step, Output, root, schedule) does not branch on it: if a racer deleted the pipeline first, its write runs against the vanished pipeline and takes the existing not-found path (an FK violation or a zero-row write), and a set writer (source delete, teardown) ignores a shorter count and carries on. `DraftSaveRaceSpec` "after a racer deleted the pipeline" (`races/R4-raced-delete-writers.log.txt`) pins that none of them writes definition state for the vanished pipeline.

**Editor root add / remove (C5).** Both run on the application pool and the service accepts an editor, but RLS makes an editor's root change impossible, so there is no editor race for the lock to protect: an editor's `POST /roots` with their own source answers 500 and writes nothing (`pipeline_roots_insert` is owner-only), and an editor's `DELETE /roots/:id` answers 200 and removes nothing (`pipeline_steps_owner`, `pipeline_roots_delete` hide the rows), while the owner's identical request works. Both are pre-existing defects, listed as follow-ups, and pinned in `DraftSaveRlsSpec` so a policy change that WOULD create the race turns it red. Owner-run root races are in `DraftSaveRaceSpec` "root add" / "root remove".

**Audit.** The draft save's audit row is written IN the save's transaction (`AuditEventRepository.appendAction`), a deliberate departure from HEL-471's swallow-on-failure `AuditService.record`: a committed save has exactly one audit row, and a failed audit insert (a DB failure that would endanger the save anyway) rolls the save back as a 5xx.

**Where the evidence lives.** `openspec/changes/atomic-draft-save-endpoint/evidence/` while the change is open; after `openspec archive` it moves with the change to `openspec/changes/archive/<date>-atomic-draft-save-endpoint/evidence/` (the logs are `.log.txt` so they are tracked, not gitignored). A durable copy of every file is also persisted under `.concertino/runs/HEL-1629/evidence/`.

**G2.** `DraftSaveDeadlockSpec` (`R2-deadlock-spec.log.txt`, 13 of 13): for each participant a deterministic control that takes the opposite order and must
raise `40P01` (so the spec can fail), the verified order that must not, and a repeated concurrent mix of the save, a panel create, a pipeline delete, an Output
delete, a source delete, a node-snapshot transaction, the rewrite and a teardown with 40P01 counted as a failure. SERIALIZABLE was not used or considered
a substitute (see below).

**G3.** `DraftSaveUndoSpec` and `DraftSaveApiSpec`: the journal row is written in the save's transaction from the **locked** state; a panel bound during a
save is either in the cascade the caller confirmed or the bind waits until after commit. `DraftSaveFaultSpec` splits the transaction (mutation M1,
`mutations/M1-split-transaction.diff`) and 6 of 9 faults go red; `lockForDeletion` twice (M2) goes red on "exactly one `hel1498_lock_panels`"; the fingerprint read
in the editor's user context (M3, `mutations/M3-user-context-fingerprint.diff`) goes red in `DraftSaveApiSpec` and `DraftSaveRlsSpec` (12 failures), proving the editor round trip
needs the privileged read.

**Stale base is reload-only.** There is no force or overwrite parameter; the open question below is closed by the owner ruling (section 14).

On a mismatch: **409** with the existing stale body (`code: "PATCH_SET_STALE"`, `stale: [{index, kind, id}]`, `ServiceResponse.scala:88-102`; message built like
`PatchSetStaleMessage.scala:10-15`) naming `kind: "pipeline"` and the current fingerprint. Nothing is written. The UI offers **"reload the saved pipeline"**
(the draft is kept as a diff to re-apply). Whether to also offer a force-save ("overwrite") is an unruled product call and is listed as an **open owner
question for HEL-1581** (section 12). The same 409 covers another tab, a grantee, an agent patch-set, or a scheduled run rewriting an `upsertsource`
step's config (`PatchSetTargetFingerprint.scala` documents that exception).

### 8.4 Reorder

The draft carries the **final trunk order**; the endpoint applies it with the `reorderTrunkInternal` semantics (a permutation of the union of
every root's trunk, tails follow their trunk step, a multi-root reorder is real, `PipelineStepWrites.scala:160-166`; lane-cycle rejection
becomes a 400 that aborts the transaction). Today's patch-sets cannot express a whole-list reorder; they only carry per-step `position`
(`PatchSetTargetFingerprint.scala:44`). Reorder is therefore a first-class part of the bulk write, not a second call.

### 8.5 Undo, and its relation to patch-set history

`POST /api/patch-sets/:id/undo` today restores a journaled application edit by edit in reverse, and is explicitly **not** atomic past phase 1
("edits already restored earlier in that SAME walk are never compensated back", `PatchSetUndoService.scala:43`), and the journal has no
reorder edit. Recommended: the bulk save writes **one journal row** (`PatchSetApplicationRepository.create`, the same table
`PatchSetApplyService.scala:205-224` writes) whose single edit is `kind: "pipelineDefinition"` holding the _prior_ definition
(`PatchSetPipelineDefinition.of(prior)` already produces it, including, through the Output cascade, the ids of the bound panels and the targeting alert
rules, `PatchSetPipelineDefinition.scala:12-15`). Undo of such a row is the bulk endpoint again, with the prior definition as the draft and the
**post-save fingerprint as `baseFingerprint`**: atomic, reorder-correct, and stale-checked (it refuses to undo over later edits). It appears in the same
application history as patch-set applications, with its own `kind`, and `/undo` dispatches on it. Not covered by undo, as today: data (run history,
snapshots) and the run itself.

**A save that deleted steps or Outputs.** The bulk body (8.1) knows existing ids and new `clientId`s; a step or Output the save deleted is neither, and
its cascade (the Outputs on deleted nodes, their bound panels, possibly on other users' dashboards, and targeting alert rules, HEL-1522) cannot be
expressed in `steps[]`/`outputs[]`. Three stances are viable; **recommended: refuse the dependent case, restore the rest.**

1. _Recommended._ If the save deleted only steps or Outputs **with no bound panels or alert rules**, undo recreates them **under their original ids**
   (the restore body may carry an explicit `id`, accepted only on an undo, with the journaled config). If the cascade removed any panel or alert rule,
   undo is refused with a **409 naming each one** as structurally unrecoverable, as `PatchSetUndoConflictCheck` already does for other kinds
   (`PatchSetUndoConflictCheck.scala:26-55`): the existing undo recreates panels under a **new** id (`PatchSetUndoInverse.scala:79`), so references
   to them would be lost anyway.
2. Restore the cascade too: recreate the panels and alert rules, with new panel ids, on whichever dashboards they were on. Needs write access to other
   users' dashboards and loses the old ids; viable but heavier and riskier.
3. Definitions only: restore steps, Outputs, order and config, and list in the response what was **not** restored (the panels and alert rules).

More than one stance is genuinely viable, so this is an **open owner question for HEL-1581** (section 12), with stance 1 as the recommendation.

### 8.6 The run after the save

Save and run are two steps because the run is governed by the HEL-505 guard. `PipelineRunService.submit` (`PipelineRunService.scala:187-209`)
checks access, then `PipelineRunExecutor` checks the rate limit first (`PipelineRunExecutor.scala:144`, `incrementRateIfUnderLimit`) and, for real runs, the
concurrency cap (`:153-178`, `insertRunIfUnderConcurrencyCap` at `:164`), each answering `TooManyRequests(retryAfter)`. The save **commits first**; the
run is then submitted with the pipeline as saved. If the guard rejects, the response is `200` with `{saved: {...definition, fingerprint},
run: {started: false, code: 429, retryAfterSeconds, reason}}`: the draft **is saved, the run is not started, and the UI says so** ("Saved.
Run not started: rate limit, retry in 12 s" with a "Run now" button that calls the existing run endpoint). A run rejection never rolls the
save back, and `runAfterSave: null` makes a plain Save available. The submit also runs `auditSubmit` (`:201,207`) as today.

### 8.7 Checks the endpoint must keep (RLS and ownership)

- **ACL**: `pipelineRepo.findByIdShared(pipelineId, Some(user))` then owner-or-editor (`requireEditorAccess`, `PipelineService.scala:254-263`);
  a viewer gets 403, an invisible pipeline 404, exactly as `updateStep`/`reorderSteps` (`PipelineStepWrites.scala:31-59,165-176`).
- **RLS**: create runs under `withUserContext(ownerId)` (`PipelineRepository.scala:506`), whose `pipeline_steps_owner` and `outputs_insert`
  policies key on `current_setting('app.current_user_id')` (`:500-505`). Editor edits today go through the privileged `*Internal` methods
  after a service-level ACL check. The bulk endpoint must run its transaction under the **pipeline owner's** user context (so every row is
  stamped with the owner) after the service-level check, or on the privileged pool with the same check; which one is a build-time decision
  to verify against the policies (not verified here).
- **Cross-owner references**: `validateStepCrossOwnerRefs` for join/union/lookup secondaries (HEL-278/384/386, applied in the create path,
  `PipelineCreateTransaction.scala`, `validateStepCrossOwnerRefs`), and the `upsertsource` target check (`UpsertTargetCheck`, `UpsertSourceStep.scala:47-51`).
- **Strict config validation** per step (`PipelineStep.rawConfigProblem`, `PipelineStep.scala:289`), the write-path check the client port
  cannot fully replicate (a draft can pass the client and fail here; the 4xx names the step and the draft is kept).
- **Cascade confirmation**: deleting a step removes its tail subtree, the Outputs on those nodes, their bound panels and targeting alert
  rules (`PatchSetTargetFingerprint.scala:23-27`, HEL-1522). The request must list them (`confirmCascade`), else a `422` with the impact, as
  patch-set preview does (`PatchSetPreviewImpact`).
- **Audit**: one row for the save (like reorder's one row, `PipelineStepWrites.scala:184-188`), not one per step.

## 9. Latency

From `measurements.md`: real headless Chromium 140.0.7339.186 (headless shell), Ryzen 5 7600X, Node 22.23.2, 1,000-row
`runs` source, three board steps (filter, sort, compute `duration_s / 60`), 50 warm-up + 500 measured edits with 179
distinct surviving-row counts:

| (ms)                                                   | unthrottled median / p95 / max | 4x CPU throttle median / p95 / max |
| ------------------------------------------------------ | ------------------------------ | ---------------------------------- |
| recompute, filter drag (3 steps)                       | 0.10 / 0.20 / 0.40             | 0.50 / 1.0 / 1.2                   |
| recompute, step-3 expression edit                      | ~0.03 mean                     | ~0.13 mean                         |
| recompute + render (table, SVG, tiles) + forced layout | 1.0 / 1.6 / 2.7                | 3.8 / 5.2 / 9.0                    |

Against the < 50 ms target this has ~10x margin even throttled. The prototype omits most of the expression language and
the real renderers (see its README), so the figure is a floor for the board's steps, not a bound for every kind: the
omitted fidelity (a decimal-string `round`, full coercion, ECharts) adds work on the cell/row axis, and the scaling probe
shows linear growth (10,000 rows: 1.5 ms; 50,000 rows: 9 ms at 1x, with a 4x p95 of 67-115 ms across runs, which is observed variance on a shared machine). The latency question is
therefore not what decides this design; correctness parity and the request budget are.

## 10. Rejected alternatives (consolidated)

- **Server-only evaluation (a draft-preview endpoint for everything)**: no duplicated evaluator, but at least one request per
  debounce, a DB session lookup and an access re-read per edit, and the budget pressure of section 6; contradicts the owner's
  "recompute cheaply without many network calls". (Not chosen by the owner: ruling B.)
- **Scala.js**: see 3.3 (ruling B chose the TypeScript evaluator).
- **Random/reservoir samples**: 4.
- **Persisted server-side drafts, IndexedDB, a server sample store**: contradict the board (8) or add persistence nothing needs (ruling C).
- **SSE, WebSocket and plain request/response for the server fallback**: section 6.3 (SSE dominated; WebSocket ~1.2 ms warm faster but a
  held slot, a bypassed limiter and no abort; plain request/response ties NDJSON warm but loses time-to-first-step).
- **Reusing `POST /api/patch-sets/apply` for Save & run** (the earlier recommendation, overridden by ruling E): sequential, not one
  transaction, no whole-list reorder.
- **Replaying per-step PATCH/POST/DELETE on Save**: no atomicity, no undo.
- **A per-step "Preview with AI" button, or running AI on the draft** (overridden by ruling F): a model call per edit or per click, owner-charged.
- **Reusing `OutputPanelContent` unchanged for the draft Output**: 7 (stale headline, history fetches).
- **Keeping per-edit PATCH + saved-config preview beside the client path**: two sources of truth and nothing is "unsaved" (8).

## 11. Decisions: owner rulings and self-approved ones

**Owner rulings** (verbatim tokens in section 14):

| Call                                 | Ruling                                                                                       | Where applied |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | ------------- |
| A. Transport for the server fallback | Delegated: lowest latency and cost, size irrelevant. Executor's pick: POST + NDJSON over h2. | 6             |
| B. Evaluator approach                | `ts-evaluator-plus-corpus`                                                                   | 3.3           |
| C. Sample cache location             | `client-memory`                                                                              | 4             |
| D. Sample size and refresh           | `head-1000-manual-refresh`                                                                   | 4             |
| E. Save & run write path             | `new-atomic-bulk-endpoint` (overrode the patch-sets recommendation)                          | 8             |
| F. AI steps in a live draft preview  | `never-before-save` (overrode the opt-in-button recommendation)                              | 3.1, 6, 12    |

Self-approved, with why only one option is viable or which ruling settles it (standing constraint C1):

| Call                                                                                       | Why it is not escalated                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draft is client-only; nothing persists until Save & run                                    | Settled by the approved board and `HANDOFF.md:32` (owner ruling, precedence: ACs, rulings, HANDOFF, boards).                                                                                                                                                                                                                                                                                                                                                    |
| Recompute from the edited step down                                                        | Settled by the ticket's Q3 and the owner's "diffs stay small"; also the board's interaction.                                                                                                                                                                                                                                                                                                                                                                    |
| The cached rows are the engine-loaded rows, not raw source JSON                            | Only viable: the parity target and the HEL-1015 flattening live in the engine's loader (4).                                                                                                                                                                                                                                                                                                                                                                     |
| Output render over draft rows with a draft headline                                        | Only viable: the board requires a live Output from the draft, and the metric headline otherwise comes from saved history (7).                                                                                                                                                                                                                                                                                                                                   |
| The "vs last run" baseline is fetched once per page load and cached                        | Settled by the ticket text: no network request per edit _and_ the board shows "-2 vs last run"; a per-edit fetch violates the former and dropping it violates the latter.                                                                                                                                                                                                                                                                                       |
| Sample refresh sits under the existing source-fetch limiter                                | Only viable: it reads a source, and that limiter exists for exactly that (HEL-505 design decision 6).                                                                                                                                                                                                                                                                                                                                                           |
| The draft-preview endpoint gets its own limiter, mounted outside the general `/api` bucket | An architecture call within ruling A, not a product call: nested inside the general bucket a dedicated limit set at the ~120 default could never bind first and a ~100/min drag would starve the page; a nested limit well below 120 with a slower client floor would bind but costs edit latency, which ruling A ranks first. The route must still apply authentication, CSRF and `confineScopedToken` (6.3). Needs a path exemption in the general directive. |
| Transport pick within ruling A                                                             | Not a tie: NDJSON/h2 ties plain request/response on warm latency and beats it on time-to-first-step at equal cost; it dominates SSE; WebSocket's ~1.2 ms edge is paid for in cost (6.3). Evidence in `measurements.md` section 4.                                                                                                                                                                                                                               |
| The save is declarative (final step tree) rather than an operation list                    | Only viable with a whole-list reorder and re-parenting in one transaction: an operation list reintroduces ordering hazards the transaction exists to remove.                                                                                                                                                                                                                                                                                                    |

## 12. HEL-1581 scope check

HEL-1580 spike outcome for HEL-1581, from `docs/live-draft-preview.md` (the references below are to that document). Each acceptance
criterion is quoted verbatim, then marked stands, adjusted or split. HEL-1581's description is not edited; this is a comment.

1. **"Editing a client-evaluable step updates counts, preview and Output render with no network request (verified via network log), within
   the latency budget the spike set" - stands.**
   - **Budget:** under 50 ms per edit. Measured on the 1,000-row, three-step board pipeline in headless Chromium 140 (`docs/live-draft-preview.md` §9):
     about 1 ms for recompute plus render, about 4-5 ms at 4x CPU throttle (recompute alone about 0.1 ms).
   - **Network-log check:** after the page-load sample fetch and the one-time baseline fetch, an edit to a client-evaluable step produces
     **zero** requests. The test asserts the request count over a burst of edits is 0, including no per-edit PATCH (the per-edit persist is
     removed, `docs/live-draft-preview.md` §8).
   - **Carve-out:** the Output summary's "difference vs the last run" needs the saved-run baseline (`GET /api/outputs/:id/history`). Fetch it
     once per page load and after a run, cache it, and compute the draft value against it, so the AC holds literally for edits. A step
     downstream of an AI step is not previewed at all (`docs/live-draft-preview.md` §6), so it makes no request either.
2. **"A server-only step updates through the chosen transport, debounced, with a pending state, and never fires more than the HEL-505
   limits allow" - adjusted.**
   - **Transport:** `POST /api/pipelines/:id/draft-preview` with an NDJSON streamed response over HTTP/2, chosen on measured latency and cost
     (`docs/live-draft-preview.md` §6).
   - **Debounced:** single-flight with an `AbortController`, a trailing debounce of about 300-400 ms and a floor of about 600 ms between
     sends, so a continuous drag sends at most about 100 requests per minute (`docs/live-draft-preview.md` §6.3).
   - **Pending state:** each step carries a status (`ok | error | needsServer | stale`; `docs/live-draft-preview.md` §5); while a server
     request is in flight the step shows pending, the previous frame stays visible marked stale, and the Output "live" indicator is off
     (`docs/live-draft-preview.md` §7).
   - **Adjusted wording:** the draft-preview endpoint gets its **own** `RateLimitDirective` instance and bucket (built like the source-fetch and
     product-events limiters, but mounted outside the general bucket), not a HEL-505 limiter: HEL-505's run guard counts runs and a draft is not a run, and the general `/api` budget
     is too coarse. So "within the HEL-505 limits" becomes "within the draft-preview limiter, which is **exempt from the general `/api` bucket** (`ApiRoutes.scala:799`: nested inside it, a dedicated limit could never bind first and a drag would exhaust the page's budget; `docs/live-draft-preview.md` §6.3), and never consuming the HEL-505 run guard".
     A sample refresh is under the HEL-505 source-fetch limiter (30/min per user).
   - AI steps never run before Save & run (`docs/live-draft-preview.md` §6), so they are not part of this path.
3. **"Discard restores the saved pipeline exactly. Save & run persists the draft and starts a run, and undo/patch-set history stays
   consistent" - adjusted and enlarged.**
   - **Discard:** drops the draft and re-derives every frame from the saved pipeline (`docs/live-draft-preview.md` §8). "Exactly" is tested
     by comparing the editor's step list, configs, order, enabled flags, Output config and fingerprint after Discard with the values loaded
     before the first edit (deep equality), and by asserting no request was sent.
   - **Save & run** is a **new atomic bulk endpoint** (owner ruling E, `docs/live-draft-preview.md` §8): one transaction for step creates,
     updates, deletes, reorder and Output edits; a stale base returns 409 with the existing `PATCH_SET_STALE` body; deleting a step lists its
     cascade for confirmation.
   - **Undo and history:** the save writes one journal row holding the prior definition, in the same application history as patch-sets;
     undo is the same endpoint applied to that definition, atomic and checked against the post-save fingerprint (the existing patch-set undo
     is not atomic and cannot undo a reorder). **A save that deleted steps or Outputs:** the recommendation is to recreate them under their
     original ids when nothing was bound to them, and to refuse the undo with a 409 naming every bound panel and alert rule when the
     cascade removed any (see the open owner question below; `docs/live-draft-preview.md` §8.5).
   - **Concurrency:** the stale-base check must be atomic against every writer of fingerprinted state, without deadlocking against the tree's lock order (`docs/live-draft-preview.md` §8.3 states the guarantees; the protocol is unverified and owned by split item (c)).
   - **If the HEL-505 run guard rejects the run after the save commits:** the draft is saved, the run is not started, and the UI says so with
     a "Run now" action.
4. **"The Output render matches the saved-panel render for the same rows (parity test)" - stands, sharpened.** The test includes a metric
   whose saved history differs from the draft rows and asserts the **draft** headline, because the dashboard's metric panel takes its
   headline from the last saved run (`docs/live-draft-preview.md` §7). The evaluator itself is gated by the parity corpus
   (`docs/live-draft-preview.md` §3.3), which the AC does not mention.
5. **"Non-static sources clearly show the sample label and its age" - stands, extended.**
   - Every non-static source (REST, SQL, connectors, a CSV with a live URL) **always** shows the label and its capture age, including when the
     cached sample is exact (a cached sample still ages against the live source).
   - **Any source, static or not, with more rows than the 1,000-row sample cap** (an uploaded CSV of 12,431 rows, for instance) shows "first
     1,000 of N rows" and the caveat that its counts and aggregates are statements about the sample; only a static source whose sample is exact
     keeps the plain "Static · N rows" (`docs/live-draft-preview.md` §4). That static-and-sampled case is outside the AC's wording and is added
     to its scope.
   - A "not previewed (AI step)" state for AI steps and everything downstream.

The remaining "What" bullets (changed-row flash with reduced-motion fallback, the roughly 340-380 px Output column) are not affected by the
spike.

**Recommended split of HEL-1581:**
(a) the TypeScript evaluator, parity corpus and manifest checks, split by kind class (the largest risk carrier);
(b) a sample endpoint (new, under the source-fetch limiter), a client in-memory sample store, the always-on label and a manual refresh;
(c) the atomic bulk save endpoint with `DBIO` step writes, stale-base 409, cascade confirmation, the journal row and atomic undo (backend):
**owning the verified locking protocol** (`docs/live-draft-preview.md` §8.3 states the guarantees HEL-1581 must meet: atomicity against every writer of
fingerprinted state, listed there with file:line including the data-source delete cascade and every `lockForDeletion` caller; no deadlock with the
tree's lock order, `lockForDeletion` first and exactly once; and undo-journal completeness; the candidate protocol there is unverified) and its required
specs: a two-connection race spec per writer class (including each panel writer listed in §8.3's G1 table, not only panel create and swap), a deadlock spec running a panel create, pipeline delete, Output delete, source delete and the save
together (starting from the review's PostgreSQL 18.4 reproduction, described in §8.3, where the earlier lock order deadlocked 2 of 2 runs), the save not run at
`SERIALIZABLE` as a substitute, and its own transaction spec **plus an RLS spec run as a role without `BYPASSRLS`** (the dev and CI
database role bypasses RLS, so a green suite alone proves nothing there);
(d) the draft-preview endpoint (NDJSON) for the server-only kinds and unported constructs, with its own limiter **exempt from the general `/api`
bucket** (a path exemption in the general directive), still applying authentication, the CSRF header and `confineScopedToken`;
(e) draft state, the per-step cache, Discard, the Save & run UI, "not previewed" states and removal of the per-edit PATCH;
(f) the draft Output render and its parity test.
**Open owner questions for HEL-1581** (genuine product calls, with the recommendation first; not decided here):
(1) when a Save & run 409s on a stale base, offer only "reload the saved pipeline" (recommended; the draft is kept as a diff) or also a force
"overwrite" of the other writer's changes;
(2) undo after a save that deleted steps or Outputs: recreate those with no dependents under their original ids and refuse with a 409 naming
bound panels and alert rules when the cascade removed any (recommended), or restore the cascade with new panel ids, or restore definitions only
and list what was not restored (`docs/live-draft-preview.md` §8.5).

Order: (a) and (b) first; (c) and (d) in parallel with them (backend); (e) and (f) after.

## 13. Spinoff candidates found (not fixed here)

- `pipelineRunFanout.ts:4-8` still says the backend registry holds exactly one subscriber per pipeline and a second `subscribe`
  overwrites the first; HEL-1168 replaced that with a `Set` of subscribers (`PipelineRunRegistry.scala:73-77,82`). The comment is
  stale.
- `useStepCardPersist` (400 ms) and `useStepCardPreview` (500 ms) are independent timers: the preview reads the saved
  config, so a PATCH slower than the 100 ms gap would produce a preview of the previous config. Moot if HEL-1581 removes
  both for editor edits; otherwise a latent race.
- The session-authenticated request path has a state-dependent latency on the dev machine: ~2 ms hot, about 25-45 ms after >= 60 s idle, on the
  database path only (`measurements.md` section 2, `prototype/floor.cjs`); root cause not determined (pool revalidation, a cold Postgres
  backend or CPU frequency are candidates). It inflates every preview and every cold first request.
- `PatchSetUndoInverse.scala:113` describes `PipelineStepResponse` as a "22-subtype sealed union" while the Registry holds 27
  kinds (`PipelineStep.scala:256-284`).

## 14. Owner rulings

Recorded verbatim from the `escalation.answered` event (channel `chat`, `answer_source` `human`, line 18 of
`.concertino/runs/HEL-1580/events.jsonl`), and standing constraint C2 in `tasks.md`:

1. **A (transport):** `owner-free-form: "whichever is most efficient in terms of latency and cost. im indifferent to the size of the changes for this, since if we need to build more scaffolding to support it, we should"`
2. **B (evaluator approach):** `ts-evaluator-plus-corpus`
3. **C (sample location):** `client-memory`
4. **D (sample size and refresh):** `head-1000-manual-refresh`
5. **E (Save & run write path):** `new-atomic-bulk-endpoint` (overrode the patch-sets-apply recommendation)
6. **F (AI steps in a live draft preview):** `never-before-save` (overrode the opt-in-button recommendation)

How each was applied: A in section 6 (the choice and its evidence, section 11); B in 3.3 and the table in 3.1 (unchanged from the
recommendation, now an owner ruling); C and D in section 4 (unchanged, now owner rulings); E in section 8 and the HEL-1581 split in 12; F in
3.1, 6 and 12 (the "Preview with AI" button is dropped everywhere).
