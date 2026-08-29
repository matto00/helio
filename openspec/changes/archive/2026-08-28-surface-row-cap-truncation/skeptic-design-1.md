## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Branch @ `83e99a0e`. Every claim below re-derived by grep/read against the worktree,
not from the artifacts' prose.

### What I verified (with evidence)

**Claims that hold (audited against code):**

| design.md claim | verdict | evidence |
|---|---|---|
| `maxRunRows` occurs exactly 3× in the tree, all in one file; `:65`, `:176`, `:181` | TRUE | `grep -rn maxRunRows --include=*.scala backend/` → exactly those 3 lines |
| Exactly two **production** call sites of the 3-arg capped `fetch` | TRUE | `grep -rn "\.fetch(" --include=*.scala backend/` → only `InProcessPipelineEngine:176,181` in `src/main`; every other `src/main` hit (`SourceService.scala:335`) is the 2-arg REST overload, and all remaining hits are tests |
| `SourceService.scala:335` calls the *uncapped 2-arg* overload | TRUE | `SourceService.scala:335` = `connector.fetch(source.config, ConnectorResolveContext.Owned(user))`; the 2-arg def is `RestApiConnectorDriver.scala:227` returning `Either[String, JsValue]` |
| `toRowsEither` materializes the full vector before `.take` | TRUE | `RestApiConnectorDriver.scala:343`: `fetch(config, rc).map(_.flatMap(json => toRowsEither(json, config.rootSelector)).map(_.take(maxRows)))` — the pre-`take` `.size` is genuinely free |
| SQL cap is `stmt.setMaxRows(maxRows)` pushed to the driver | TRUE | `SqlConnectorDriver.scala:75` inside `execute`; `fetch` (`:149`) = `execute(config, maxRows).map(_.map(toRows))` |
| `execute`'s other callers are infer(100) / preview(10) | TRUE | `SqlConnectorDriver.scala:147` `execute(config, maxRows = 100)`; preview path 10 |
| `sourceRowCount` computed as `sourceRows.size` at `:368` (run) / `:212` (preview) | TRUE | `PipelineRunService.scala:368` `(out, counts, sourceRows.size.toLong)`; `:212` `RunResultResponse(previewRows, totalCount, counts, sourceRows.size.toLong)` |
| `RunResultResponse` at `PipelineProtocol.scala:95`, `jsonFormat7` at `:153`, 4 defaulted fields | TRUE | read both |
| `runSourceRowCount` is a dead destructure | TRUE | `grep -rn runSourceRowCount frontend/src` → slice decl `:98`, init `:141`, reducer `:488`, one slice test, and `PipelineDetailPage.tsx:70` (destructured, never referenced again in that file) |
| MCP `run_pipeline` has no bespoke formatter | TRUE | `write.ts:376` `guarded(() => api.runPipeline(...))` → `guarded` → `jsonResult` = `JSON.stringify(value, null, 2)` (`write.ts:46-60`). Tool description at `:366-370` does say "Returns { status, rowCount, outputDataTypeId }" |
| `RunOutcome` at `helioApi.ts:88`, mapped at `:561` | TRUE | and the mapping is an explicit whitelist, so task 4.2 is genuinely required — new fields do NOT flow through automatically here |
| Creation caps are SQL-infer 100 / preview 10 / static 500 / REST-infer uncapped; creation does **not** apply `maxRunRows` | TRUE | `SqlConnectorDriver.scala:147`, `DataSourceService.scala:60`, `RestApiConnectorDriver.scala:334-335` (`inferSchema` → `fetch(config, resolveContext)`, no `maxRows`) |
| CSV/static/text/PDF/image are not `ConnectorDriver`s; engine loads them uncapped | TRUE | `ConnectorRegistry.scala:9-10` states it explicitly; `InProcessPipelineEngine.loadRows:119-190` applies no cap to those arms |
| `loadRows` has ~20 test call sites | APPROXIMATELY TRUE | 15 test call sites (14 in `InProcessPipelineEngineSpec`, 1 in `RestApiConnectorDriverTemplatingSpec:156`). "~20" is loose but not load-bearing |

**Set re-derivations (standing requirement 2):**

- `ConnectorDriver` implementations — **5, not 2** (see CR-3).
- Capped-`fetch` call sites in `src/main` — 2. Confirmed.
- `loadRows` callers in `src/main` — `PipelineRunService:203`, `PipelineRunService:365`, and `InProcessPipelineEngine:200` (`makeContext.loadSource`). Confirmed.
- `RunResultResponse` construction sites in `src/main` — **3**: `:135`, `:212`, `:425`. The design/tasks name only `:212` and `:425`. `:135` is `recordUnrunnable` (a never-attempted run; no source read occurred), so a defaulted `sourceTruncated = false` there is *factually correct* — benign, but it should be named so a future reader does not have to re-derive it. Non-blocking note.
- Surfaces consuming `sourceRowCount` — `PipelineProtocol.scala:99`; `pipelineService.ts:142`; `pipelinesSlice.ts:235,488`; `helio-mcp/types.ts:334`; `helioApi.ts:88,561`; plus test fixtures in `PanelCreationModal.test.tsx:978`, `ShapeInstantiateStep.test.tsx:111,234`, `PipelineDetailPage.test.tsx` (5 sites), `pipelinesSlice.test.ts` (5 sites). All additive-safe.
- **Second agent surface found, not mentioned anywhere in the artifacts:** `apply_pipeline_proposal` / combined `apply_proposal` return `PipelineProposalApplyResponse` (`helio-mcp/types.ts:668-673`) which embeds `run: RunResultResponse` **raw** — `pipelineProposalHandlers.ts:71-76` returns `api.applyPipelineProposal(...)` straight into `guarded`/`jsonResult`. This surface picks the notice up for free once task 4.1 lands, and it is arguably the *primary* agent path that creates-and-runs a pipeline. That is a point in D4's favour, not a defect — but it is currently undocumented luck rather than design.

**D3 SQL probe scrutiny (standing requirement 3):** the design is sound.
`setMaxRows(maxRows + 1)` with `rows.take(maxRows)` returns byte-identical rows to today
for every existing caller, because `execute` is untouched and `fetch`'s only callers pass
1000 (engine) and 100 (`SqlConnectorDriverSpec:212`). The `+1` genuinely proves truncation
in both directions and the memory delta is exactly one row. One latent edge worth a
scaladoc line: JDBC defines `setMaxRows(0)` as *unlimited*, so a hypothetical
`fetch(config, 0, ...)` changes from "all rows" to "1 row". No such caller exists today;
note it rather than guard it.

**D4 wording scrutiny (standing requirement 4):** both strings are accurate and
actionable. The unknown-total branch names no number it did not measure — it says
"more rows exist (the total is not known)" and gives only the measured 1000. Neither
string is false. Minor: "the first 1000" implies an ordering that a SQL result set
without `ORDER BY` does not guarantee; "the first 1000 rows returned" would be exact.
Non-blocking.

### Verdict: REFUTE

Three of the four items below are prose-vs-code defects of exactly the class the standing
requirements target. CR-1 makes a designed decision unimplementable as written; CR-2 makes
a shipped spec statement false.

### Change Requests

1. **D6 is not implementable as written — the REST create path has no row count.**
   design.md:101,103 assert "REST infer materializes every row, so the count is exact and
   free" and that `rowCapNotice` "is populated on the REST create path in `SourceService`,
   not in the generic `CreateSourceEnvelope.build`". Traced: `SourceService.createRestWithConfig`
   (`SourceService.scala:144-161`) does **not** fetch anything — it inserts the source and
   delegates the entire response construction to `CreateSourceEnvelope.build(connector, ...)`
   (`:156`), which calls `connector.inferSchema(config, ...)` (`CreateSourceEnvelope.scala:40`)
   and builds every `CreateSourceResponse` itself (`:42-46`, `:60+`). `inferSchema` returns
   `InferredSchema(fields: Seq[InferredField])` (`model.scala:628`) — **no row count**. The
   count is free *inside* `RestApiConnectorDriver.inferSchema` (`:334-335`), which discards
   it before returning. So as designed, populating `rowCapNotice` in `SourceService` requires
   an undisclosed **second full REST request on every source creation**. This is the "read a
   signature without tracing the caller" failure the standing requirements name. Revise D6 and
   task 6.2 to state the actual mechanism and its cost — either (a) thread an observed row
   count out of the REST infer path (e.g. an optional `observedRowCount` on the driver's
   infer result or a REST-specific infer variant) and pass it into `CreateSourceEnvelope.build`,
   or (b) explicitly accept and document a second fetch. Do not leave the executor to discover
   this.

2. **The deferred secondary-source gap is three step kinds, not one — and the spec delta
   contradicts the Non-Goal.** design.md:24, :91, :93 and the Risks bullet all describe the gap
   as "a join step's right-hand source" / "the join re-entry". `ctx.loadSource` is consumed by
   **three** steps: `JoinStep.scala:57`, `UnionStep.scala:71`, `LookupStep.scala:88`. A union
   over a 50k-row REST source is silently capped at 1000 exactly like a join, and this change
   will then report `sourceTruncated: false` — a *positive assertion of completeness* that is
   wrong, which is strictly worse than today's silence. Meanwhile the new capability spec states
   flatly: "A run that was truncated SHALL be distinguishable from a run that was not, at every
   surface listed in this capability, without the caller inspecting row counts and inferring"
   (`specs/pipeline-run-truncation-reporting/spec.md`) — an unqualified requirement the design
   deliberately does not satisfy. That is an internal contradiction between two artifacts in
   this change. Judgement on the deferral itself: **deferring per-secondary-source attribution
   is defensible**; shipping an unqualified `false` is not. Required: pick one and make all
   three artifacts agree —
   (a) preferred and nearly free given D5 already computes stats on every `loadRows` call:
       OR any secondary-source truncation into the run-level flag (accumulate through the
       execution context) and word the fields/notice as "a source read in this run", not
       "the source"; or
   (b) if still deferred: correct every mention to name join **and union and lookup**, qualify
       the spec requirement to the primary source, state in the field scaladoc, the spec, and
       the MCP tool description that `sourceTruncated: false` means "the primary source read
       was not truncated" and not "nothing in this run was truncated", and file the follow-up
       with all three step kinds in scope.

3. **"Exactly two implementations exist (`grep "extends ConnectorDriver"`)" is false.** That
   grep returns **five**: `RestApiConnectorDriver:49`, `SqlConnectorDriver:12`, plus
   `RowSupplyingConnector` (`NewConnectorInferenceSpec.scala:25`), `FixtureConnector`
   (`ConnectorSpec.scala:19`), and `EnvelopeFixtureConnector` (`CreateSourceEnvelopeSpec.scala:31`)
   — all three of which define `fetch` (`:37`, `:36`, `:43`) and will fail to compile under D1.
   The D1 rationale ("only two implementations exist, so the widening is contained") should be
   restated as *two production implementations, three test fixtures*. Task 1.5 currently says
   only "update the existing `fetch` **call sites** in backend tests" — implementing a trait is
   not a call site. Add the three fixture implementations explicitly to task 1.5 so they are not
   discovered at compile time and patched in the least-thoughtful way.

4. **Section 6 has no verification task, and the format arity is stated two different ways.**
   Tasks 7.1-7.5 cover the run path but nothing covers the create-time advisory, so the
   `rowCapNotice` half of the change can ship untested while section 7 goes green — a coverage
   gap in an AC-bearing behaviour. Add a task 7.x asserting `rowCapNotice` present for a REST
   create over a source larger than the cap, absent for one under it, and absent for SQL
   (mirroring the three scenarios already written in the spec delta). Also: task 6.1 should name
   `jsonFormat3` → `jsonFormat4` for `CreateSourceResponse` (`DataSourceProtocol.scala:465`), and
   proposal.md:41 says "`jsonFormat7` → `jsonFormat8`+" while task 3.1 says `jsonFormat10` —
   make them agree on 10.

### Non-blocking notes

- Tests in 7.1-7.5, 4.4 and 5.4 are correctly specified: they assert **content** (the numbers
  inside the notice text, the available count) rather than key/test-id presence, and 7.2 is
  explicitly written to fail if `>` becomes `>=`. I found no green-test-over-the-wrong-input
  trap in section 7. 7.7's red-on-revert-against-final-tests requirement is the right guard.
- `helio-mcp` has no `test` script in its `package.json`, but the **root** `jest.config.cjs`
  (`testMatch: **/?(*.)+(spec|test).[tj]s?(x)`, with only `/helio-mcp/dist/` ignored) already
  collects `helio-mcp/src/**/*.test.ts`. Task 7.6 is satisfiable via root `npm test` plus
  `helio-mcp` `npm run typecheck`; say so, so the executor does not add a redundant runner.
- `RunResultResponse` construction site `PipelineRunService.scala:135` (`recordUnrunnable`) is a
  third site the artifacts do not mention. Defaulting is correct there (no source read happened);
  worth one sentence in D4 so it is not re-derived later.
- design.md:99 lists "static payload 500" among creation *caps*. It is a **rejection**
  (`DataSourceService.scala:104-105` returns `400 Payload exceeds the maximum of 500 rows`),
  not a truncation — a loud failure, not a silent one. Reword so the contrast with the run cap
  stays sharp.
- Add a scaladoc line on the new SQL probe noting JDBC's `setMaxRows(0) == unlimited`, so a
  future caller passing `0` cannot silently get one row.
- `apply_pipeline_proposal` / `apply_proposal` return the embedded `run: RunResultResponse`
  verbatim to the agent (`pipelineProposalHandlers.ts:71-76`), so the notice reaches that surface
  for free via task 4.1. Worth stating in D4 as a second MCP surface the decision covers.
- Nothing in `schemas/` describes the run result (grep found no `stepRowCounts`/`RunResult`
  under `schemas/`), so the ticket's "schemas/openspec updated" AC is satisfied by the openspec
  deltas alone. Confirmed, not a gap.
