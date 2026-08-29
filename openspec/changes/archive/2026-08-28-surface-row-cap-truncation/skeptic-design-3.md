## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold reviewer. Every claim below was re-derived from code in this worktree; the prior
skeptic reports were not used as evidence.

### What I verified (with evidence)

**1. D8 / tasks 2.2a–2.2c — `truncationSink` as a defaulted parameter on `executeWithStepCounts`**
- Real signature (`InProcessPipelineEngine.scala:83-88`): `executeWithStepCounts(rows, steps,
  dataSourceRepo, assertionSink: AssertionSink = new AssertionSink)`. A second defaulted
  parameter mirrors it exactly — implementable as written.
- `AssertionSink` (`AssertionResult.scala:35-46`) is a `final class` with a `private var`
  guarded by `synchronized` on both `record` and `results`. Task 2.2a's "mirroring it
  exactly, including `synchronized`" is a real, copyable precedent, not an invented one.
- `grep executeWithStepCounts` across the whole tree: production call sites are exactly
  `PipelineRunService.scala:205` (preview) and `:367` (run), plus the engine's own
  `execute` at `:72` (rows-only, no run result — correctly not a concern). No third
  production site exists that could silently take the default.
- `:205` **is** the preview site: `previewStep` calls `engine.loadRows(...)` at `:203` and
  `executeWithStepCounts(sourceRows, slicedSteps, dataSourceRepo)` at `:205` with **no
  sink** — exactly as D8 states. The run site passes `assertionSink` at `:367`.
- Merging the sink with the primary read's stats is well-defined: the primary read is a
  separate `loadRows` call (`:203`, `:365`) whose `DataSource` (and therefore name) is in
  scope at both sites, and `makeContext`'s `loadSource` closure (`:200`) is reached only by
  secondary reads. So `truncatedReads = primary-if-truncated ++ sink.entries` has no
  overlap in the normal case. The sink can be captured by the `makeContext` closure without
  touching `PipelineExecutionContext` (`PipelineStep.scala:77`).

**2. D9 / task 2.4 — companion object**
- `grep "object InProcessPipelineEngine"` returns **nothing**: there is genuinely no
  companion today, so adding one collides with nothing. All 13 references to the name in
  `src/main` are either the class declaration (`:54`) or scaladoc prose.
- No initialization-order problem: the object does not reference the class, so
  `private val maxRunRows: Int = InProcessPipelineEngine.MaxRunRows` (`:65`) forces object
  init on first instance construction and reads a fully-initialized `val`.
- D9's premise checks out: `CreateSourceEnvelope.build` (`CreateSourceEnvelope.scala:31-39`)
  takes `(connector, config, source, now, dataTypeRepo, user, overrides)` — no engine
  reference, no way to obtain one. Task 6.4's "read that symbol directly" is the only
  non-hardcoding option available.

**3. Round-2 non-blocking notes**
- proposal.md: "Two production implementations and exactly two production call sites exist,
  plus three test fixtures that also implement the trait." — correct (see set re-derivation
  below). **Applied.**
- `FetchOutcome(rows, truncated, availableRowCount)` — identical arg order in proposal.md,
  design D1, task 1.1 and the connector-spi spec. **Applied.**
- task 6.3 now says `.copy(...)` on the schema returned by
  `SchemaInferenceEngine.inferSchemaFromRows`. Matches the code:
  `RestApiConnectorDriver.scala:334-336` is
  `fetch(config, resolveContext).map(_.flatMap(toRowsEither).map(SchemaInferenceEngine.inferSchemaFromRows))`
  — it does not construct `InferredSchema` itself. **Applied and correct.**
- design D8 now carries the paragraph stating `truncatedReads` is deliberately API-body-only
  and not mirrored to MCP/frontend. Consistent with tasks 4.1/5.1/5.2, which add three
  fields, not four. **Applied.**
- "15 construction sites" → task 6.2 now says 14; **design D6 still says 15**, and the true
  count is 11 (see note N1). Cosmetic only — see non-blocking notes.

**4. Prose audited against code (claims of "unchanged / additive / free / single choke point")**
- *"REST's pre-truncation size is free"* — `RestApiConnectorDriver.fetch(config, maxRows, ...)`
  (`:342-343`) is `.map(_.flatMap(toRowsEither).map(_.take(maxRows)))`. The full vector is
  materialized before `.take`. **True.**
- *"SQL's cap is `setMaxRows`, total unknowable"* — `SqlConnectorDriver.scala:75`
  `stmt.setMaxRows(maxRows)`. **True.** `execute`'s other callers are `inferSchema`
  (`:147`, maxRows=100) and previewSql (10) — the `+ 1` living only in `fetch` (`:149`)
  leaves them untouched. **True.**
- *"REST infer is uncapped"* — `inferSchema` (`:334`) calls the 2-arg `fetch`, no `.take`.
  **True**, so D6's advisory-not-a-cap framing is correct.
- *"`InferredSchema` has no spray-json format of its own"* — confirmed; grep finds no
  `InferredSchema` format, the wire type is the separate `InferredSchemaResponse` reached via
  `SourceService.toInferredSchema` (`:415`). A defaulted field is genuinely additive. **True.**
- *"`runSourceRowCount` is a dead destructure"* — `PipelineDetailPage.tsx:70` destructures it;
  no non-test render site. Slice refs `:98`, `:141` (reset), `:488` (reducer) all match the
  line numbers in task 5.2. **True.**
- *"MCP `run_pipeline` has no bespoke formatter"* — `write.ts:376` → `guarded` → `jsonResult`
  (`write.ts:46-48`) `JSON.stringify`s the object verbatim. **True**, which is what makes
  task 4.2's "`truncated` must default to `false`, never `undefined`" load-bearing.
  `helioApi.ts:561` maps from `result` (the run POST body), so the new fields are available
  there without a second request. **True.**
- *"`RunResultResponse` already has four default-valued fields; `jsonFormat7`"* —
  `PipelineProtocol.scala:95-103` has 7 fields, 5 defaulted; format is `jsonFormat7` at
  `:153`. 7 + 4 = 11, so `jsonFormat11` is arithmetically right. **True.**
- *"`recordUnrunnable` performs no source read"* — `PipelineRunService.scala:120-139` does
  no engine call at all. Defaulted `sourceTruncated = false` is factually correct. **True.**
- *"`PipelineProposalProtocol` embeds `run: RunResultResponse` and reuses this format"* —
  `PipelineProposalProtocol.scala:118`, `:127`. **True.**

**5. Sets re-derived independently**
- `executeWithStepCounts` prod call sites: **2** (`:205`, `:367`) + engine-internal `:72`. No
  missed site. (Design/tasks cite `:365` for the run site; that is the `loadRows` line, the
  `executeWithStepCounts` call is `:367`. Off-by-two on a nearby line, unambiguous.)
- `RunResultResponse` construction sites in `src/main`: **3** — `:135`, `:212`, `:425`.
  Matches D4 exactly.
- `ctx.loadSource` consumers: **3** — `JoinStep.scala:57`, `UnionStep.scala:71`,
  `LookupStep.scala:88`. Matches D8 exactly. Single choke point at
  `InProcessPipelineEngine.scala:200` confirmed (the closure is the only producer).
- `ConnectorDriver` implementations: **5** — `SqlConnectorDriver:12`,
  `RestApiConnectorDriver:49`, `FixtureConnector` (`ConnectorSpec.scala:19`),
  `RowSupplyingConnector` (`NewConnectorInferenceSpec.scala:25`), `EnvelopeFixtureConnector`
  (`CreateSourceEnvelopeSpec.scala:31`). Matches D1/task 1.5 exactly.
- 3-arg (capped) `fetch` call sites in `src/main`: **2** — `InProcessPipelineEngine:176`,
  `:181`. `SourceService:335` is the 2-arg REST overload, correctly excluded.
- `InferredSchema` construction sites: **11**, not 14/15 (see N1).

**6. Internal consistency** — ticket ACs each trace to a task: AC1→7.1, AC2→7.2, AC3→4.3/4.4/5.3/5.4,
AC4→7.1, AC5→2.3/7.5, AC6→specs + 3.1, AC7→3.2 + the spec's "states the consequence" requirement.
The spec's step-preview clause is covered by 2.2c/7.6c. No Non-Goal contradicts a spec SHALL
(the primary-only scope of `sourceAvailableRowCount` is stated in both places identically).

**7. No new defect introduced; tests assert content** — 7.1 ("assert the numbers appear in the
notice text"), 7.2 (must fail on `>=`), 7.3 ("names no total"), 7.6a/7.6b/7.6c and 4.4/5.4 all
assert content, not key/testid presence. 7.7 requires red-on-revert against the final tests.

### Verdict: CONFIRM

Every revision this round lands against real code, and I found no claim that a competent
implementer could act on and get a wrong result. Nothing below blocks execution.

### Non-blocking notes

- **N1. `InferredSchema` construction-site count is still wrong, and now inconsistent.**
  design.md D6 says 15; task 6.2 says 14; the actual count is **11**
  (`SchemaInferenceEngine.scala:17,22,25,37,40,44,61`; `ConnectorSpec.scala:33`;
  `CreateSourceEnvelopeSpec.scala:123`; `SchemaInferenceFacadeSpec.scala:11,55`). The
  load-bearing part of the claim — no spray-json format, defaulted field is additive — is
  verified correct, so this changes no decision. Drop the number or fix both places.
- **N2. No shared banner/callout primitive exists.** Task 5.3 says "reuse the existing
  warning/banner component rather than inventing one", but `frontend/src/shared/ui/` has no
  such component (`Toast` is transient; `StatusChip` is a pill). Design D7 correctly says a
  render surface is *created*. Suggested resolution for the executor: build a page-local
  warning region on `PipelineDetailPage` using `--app-warning` / `--app-warning-surface`
  tokens per DESIGN.md §Intent, rather than adding a new shared primitive. I will judge this
  visually at the final gate.
- **N3. Declare `truncatedReadResponseFormat` above `runResultResponseFormat`.** In a spray-json
  protocol trait, implicit `val` formats initialize in declaration order; placing the new
  format after `:153` compiles but yields a `null` implicit at runtime. Task 3.1 lists both
  but does not pin the order.
- **N4. Possible duplicate `truncatedReads` entries.** Two steps reading the same truncated
  secondary source would append two entries, and D4's multi-source notice would name it
  twice. Consider dedupe by data-source id when composing.
- **N5. Task 3.3 says "the three fields"** while 3.1 correctly lists four (`truncatedReads`).
  Wording only.
- **N6. Task numbering** (7.6c before 7.6a/7.6b, 7.6 between them) reads oddly; renumber if
  convenient.
- **N7. Line refs `:365` (design D8, task 2.2c)** point at the `loadRows` line; the
  `executeWithStepCounts` call is `:367`.
