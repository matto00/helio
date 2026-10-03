## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- JoinStep.scala evaluate: `leftRow ++ rightRow` (inner and left). Right wins today: design Decision 7's correction of the ticket framing is CORRECT.
- PipelineAnalyzeService.inferJoin (~L1030): lane-kind mirrors right-wins; `None` (source-kind) is a passthrough of left schema only. Confirmed. analyzeNodes derives secondarySchema ONLY via laneDependencyOf (lane-kind) from `results`.
- Call sites of analyzeNodes (PipelineService ~L354 create, ~L995 analyze route, ~L1099 capabilities) feed `sourceSchemasByRoot` built ONLY from ROOT data sources (`ds.inferredSchema` / `findByIdOwned` per root). They do NOT load any join step's secondary source. Design Decision 3's premise ("already loads source schemas for roots" so source-kind may be resolvable) is therefore only half true: resolving a source-kind secondary needs a NEW async lookup (findByIdInternal, privileged/cross-owner as JoinStep itself does) at three sites plus a new analyzeNodes input channel.
- Spark: SparkJobSubmitter.scala L270-283 DOES implement JoinStep for source-kind: `df.join(rightDf, Seq(joinKey), ...)`. Non-key same-named columns stay duplicated (ambiguous), so a collision problem exists on Spark too. Decision 5 hedges ("if they do...").
- Frontend grep: only config UI (SecondaryInputPicker, StepCard etc.); no client-side join column computation found at file level (executor still to confirm).
- Scope vs ACs: all ACs map to a task except "analyze_pipeline MCP output" (flows from backend, covered by 2.5 only as verification) and "Output field pickers" (flows from analyze).

### Verdict: REFUTE

### Change Requests
1. Decision 3 / task 2.3 is still "if feasible, else document" for source-kind secondary schema, despite the design itself saying the gate must demand a stated outcome. The ticket AC requires the rename be surfaced in analyze/editor/pickers/MCP; with the passthrough, a source-kind join (the common kind, and the only kind Spark supports) shows neither renamed NOR right-only columns. Commit to one outcome: either (a) add an async pre-resolution of each join/union/lookup source-kind secondary's `inferredSchema` (via findByIdInternal, matching JoinStep's privilege model) at the three analyzeNodes call sites, passed in as a new optional map (e.g. secondarySourceSchemas keyed by data source id) with a parity test for source-kind; or (b) explicitly declare the limit as a documented, spec'd out-of-scope with a filed follow-up ticket and an owner-visible note in the PR body. Remove the incorrect implication that the existing root-schema loading already resolves it.
2. Spark (Decision 5/task 2.4): the join path exists (SparkJobSubmitter L283). State the outcome: rename colliding rightDf columns via JoinColumnNaming (computed from df.columns / rightDf.columns, key via Seq join) before the join, so Spark rows match the in-process engine; or explicitly record that Spark is left unchanged with reasoning. Don't leave it as a discovery task. Note a unit test can use the helper on column-name lists without a Spark session.
3. Parity edge (Decision 1 ragged rows): runtime derives the left name set from row key unions while analyze uses schema names. A column in the schema but absent in every left row (or empty left rows) yields differing mappings (e.g. right `cnt` not renamed at runtime but renamed at analyze). Specify the chosen behaviour (e.g. for empty/absent columns accept divergence and document, or have the engine pass schema names when known) and add it to the parity test cases in Decision 4.
4. Spec delta: add a requirement/scenario for left-join-no-match (right columns absent/null) and for the source-kind analyze limit/outcome chosen in CR1, so the spec matches what ships. Also add an explicit task for the dev-DB inventory result format (join key rule is covered; fine).

### Non-blocking notes
- LookupStep/UnionStep out of scope is reasonable; ensure follow-up ticket is actually filed (Linear) and cited in PR body.
- Decision 7's PR-body wording is correct; ensure the PR states that bound `cnt` values change from right-value to left-value under the same name.
