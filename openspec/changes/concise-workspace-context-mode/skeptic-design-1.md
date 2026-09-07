## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**1. D2's inversion of the ticket's stated preference — argument HOLDS.**
The design's load-bearing quote is real, not paraphrased. `helio-mcp/src/tools/read.ts:256-257`
(the `get_workspace_context` description itself): *"an Output's own schema is the grounding source
for a fieldMapping."* The same description names the action verbs as `create_content_panel` /
`place_outputs`, both of which target **Outputs**, not steps. So the field set required to *act* is
the Output `schema` (retained in full, task 3.3 / spec requirement), and per-step `outputColumns`
are genuinely diagnostic. The escape hatch is also real: `read.ts:163-166` describes
`analyze_pipeline` as "how you learn the exact columns an Output attached to a given step ... will
have", so per-step columns remain obtainable per-pipeline after concise omits them. D2's
counter-argument to breadth-truncation is arithmetically grounded, not rhetorical — I reproduced
the marginal costs myself (below): 43 pipelines at 9,101 B each is 391 KB of the 465 KB, so a
breadth-only fit really would serve ~14 of 43 pipelines. Argued, not defaulted. No REFUTE here.

**2. The measurement is honest; the premise stands. I reproduced it from scratch.**
`npx jest --testPathPatterns=hel865` from the worktree root, my own run:
```
{"label":"THIN (existing-fixture fidelity)","estimatedSizeBytes":50870,"budget":200000,"structuralFloorExceedsBudget":false,"laneTreeNodesFirstPipeline":0,"stepsFirstPipeline":1,"outputsTotal":43}
{"label":"REALISTIC","estimatedSizeBytes":465036,"budget":200000,"structuralFloorExceedsBudget":true,"laneTreeNodesFirstPipeline":7,"stepsFirstPipeline":7,"outputsTotal":85}
{"label":"MARGINAL","base":465036,"perPipelineBytes":9101,"perSourceBytes":2978}
{"label":"OVERSIZED (negative control)","estimatedSizeBytes":52471869,...}
Tests: 4 passed, 4 total
```
Every figure in design.md's table matches to the byte. I then checked the *realistic* fixture for
inflation and found the opposite — it is conservative: `sourceSchemas[].sourceSchema` is `[]`,
every step's `inputSchema` is `[]`, `config` is `{}`, dashboards are empty, agent memory is empty,
Output schemas are only 14 fields, and placements are 1 per Output. The only "generous" inputs are
the ones the field report specifies (60 cols/source, 7 steps/pipeline) and UUID-length ids, which
are simply what real ids are. Step widths *narrow* down the pipeline (60,60,44,32,24,18,12) rather
than being held flat.
I independently confirmed the existing fixture's thinness at `context.test.ts:443-560`: 10 columns
per source, exactly 1 step per pipeline, `placements` absent, `src-N`/`pipe-N` ids, 0 dashboards,
and its `fake` object (`:530-551`) has **no `getPipeline` method**, so `context.ts:501-522`'s
try/catch swallows the failure and `laneTree` is `[]` for all 43 — the probe's THIN arm reproduces
exactly that at 50,870 B. The premise does not collapse; the existing under-budget assertion is a
false certification of HEL-907, and converting it is a correction, not a weakening.
Also confirmed the "detected then ignored" claim: `applyBudget` (`context.ts:280-297`) hardcodes
`applied: false` at `:290`, matching `PLACEHOLDER_TRUNCATION` at `:241`; nothing sets it true.

**3. Task 6.2 cannot be satisfied by weakening a check.** `context.test.ts:559` is indeed
`expect(context.truncation.estimatedSizeBytes).toBeLessThan(DEFAULT_BUDGET_BYTES)`, and 6.2 names
that line and requires it become the full-mode-**exceeds**-budget arm, with 6.3 asserting the
concise arm under budget on the same fixture. Both directions on one fixture; the red arm is proven
to fire by the probe's instrument check. Satisfied.

**4. D6's HEL-979 boundary is TRUE.** `grep -rn "api/workspace" helio-mcp/src` returns only
`teardown` calls (`helioApi.ts:861`, `types.ts:773,783`, `tools/write.ts:553`) and two prose
comments (`context.ts:340`, `read.ts:270`) — **no MCP code path calls `GET /api/workspace/context`**.
`read.ts:273` handles the tool via `buildWorkspaceContext(api)`, which fans out client-side
(`context.ts:449-455` + per-pipeline analyze/run-history/getPipeline). The HEL-979 target is real
and separate: `WorkspaceContextService.scala:141` `val summariesF = pipelineService.listSummaries(user)`,
unbounded. D6 is correct and its "this PR must not be read as fixing HEL-979" disclaimer is warranted.

**5. D5 is TRUE and the ticket's own re-scope note is stale, as claimed.**
`grep -rin concise helio-mcp/` → **zero hits** (instrument verified: `grep -rln analyze helio-mcp/src`
hits 10 files, so the grep works). `read.ts:159-171` declares `inputSchema: { pipelineId: z.string().min(1) }`;
`helioApi.ts:290-292` is `this.http.get(\`/api/pipelines/${pipelineId}/analyze\`)` with no params.
The precedent it cites is real: `runPipeline` at `helioApi.ts:622-626` passes `dry ? { dry: "true" } : undefined`.
Backend side exists as claimed: `PipelineRoutes.scala:52,56` parses `parameter("concise".as[Boolean].?)`,
`PipelineAnalyzeProtocol.scala:214` `ConciseAnalyzeNode(path, op, validationError: Option[String] = None)`,
and `schemas/pipelines/pipeline-analyze-concise-response.schema.json` already exists. Folding the
passthrough back in is justified.

**6. Feasibility of the proposed omission rule — I measured it (the design asserts but never measures it).**
I applied exactly the spec's rule (per-step `outputColumns` → count; source `inferredSchema` → field
count; Output `schema` retained) to the realistic 465,036-byte context in a throwaway probe copy,
which I deleted afterward (`git status` clean apart from the pre-existing probe and the change dir):
```
{"label":"SKEPTIC","full":465036,"concise":180726,"budget":200000}
```
It fits — at **90.4% of budget**, ~9.6% headroom. The AC is achievable as designed.

**7. Scope discipline.** Tasks map 1:1 onto the six ACs with nothing extra; no backend change, no
migration (main at V102, no persisted state). Proportionate to a LOW ticket.

### Verdict: REFUTE

One narrow but genuine defect: task 5.1 points at a contract that this change's own headline
separation claim says it does not touch. It is a one-line fix.

### Change Requests

1. **tasks.md 5.1 contradicts proposal.md's "Modified Capabilities: None" and design.md D6 —
   disambiguate its target before implementation.** 5.1 says "Update `schemas/` for the
   workspace-context concise/truncation shape". The only existing workspace-context schema is
   `schemas/workspace/workspace-context.schema.json`, whose own title and description are
   *"WorkspaceContextResponse — Response body for **GET /api/workspace/context** (HEL-371) ...
   Structural parity with helio-mcp/src/context.ts's WorkspaceContext interface"* — i.e. it governs
   the **backend route this change explicitly never touches** (D6, verified true in item 4 above).
   As written, a competent implementer can read 5.1 two ways, and one branch is wrong: editing that
   file would document a concise/truncation capability the backend does **not** have, silently
   modifying the `workspace-context-assembly` contract the proposal states is unmodified. Rewrite
   5.1 to name its file and shape explicitly — either (a) add a new, clearly MCP-scoped concise
   schema mirroring how the analyze half already has its own
   `schemas/pipelines/pipeline-analyze-concise-response.schema.json`, or (b) state that no
   `schemas/` change is warranted because the MCP client-side snapshot is not a REST contract, and
   record that reasoning rather than leaving an open instruction. If (a), state explicitly that
   `schemas/workspace/workspace-context.schema.json` must remain byte-unchanged.
   (Note for whichever branch: that backend schema is *already* stale on main — it still `require`s
   `dataTypes` and `joinHints`, both retired by HEL-904/907. That is pre-existing debt and must
   **not** be adopted into this LOW ticket's scope.)

### Non-blocking notes

- **Concise headroom is thinner than the design implies.** My measurement puts the concise arm at
  180,726 B against the 200,000 B budget — it fits, but only by ~9.6%. At the design's own
  ~2.6 KB/pipeline concise marginal cost, roughly 50 pipelines at this fidelity would exceed budget
  even in concise mode. Nothing to change (the AC is the 25/43 case, and the mode is opt-in), but
  the executor should know that *adding* any per-entity detail to the concise projection will bust
  the target, and the design's risk section would be more honest for saying so.
- **Task 4.1's description update would be strictly better if it named the fallback.** Per-step
  columns omitted by concise mode remain obtainable via `analyze_pipeline` (`read.ts:163-166`).
  Saying so in the `get_workspace_context` description turns an omission into a documented
  redirect and directly serves the "agent can predict which mode it needs" AC.
- **Task 2.2 under-specifies the return shape.** The backend concise response is
  `PipelineAnalyzeConciseResponse(nodes: Vector[ConciseAnalyzeNode])` — a *different top-level
  shape* (`{nodes}`) from `PipelineAnalyzeResponse` (`{id,name,sourceSchemas,steps}`), so
  `analyzePipeline`'s return type becomes mode-dependent (union or overload), not just a widened
  param. Also, `context.ts:477` calls `api.analyzePipeline(summary.id)` and consumes `analyzed.steps`
  — that call site must keep compiling and behaving identically. Typecheck will catch both, but
  naming them in 2.2 avoids a round trip.
- **Task 6.10's command is stale for this repo's Jest.** `npm test -- --testPathPattern=context`
  errors out: *"Option \"testPathPattern\" was replaced by \"--testPathPatterns\""*. Use
  `--testPathPatterns=`. Worth fixing in the task so the evidence step doesn't produce a confusing
  zero-test run (I hit `Tests: 0 total` before correcting it).
- **6.2's sibling assertions need to flip too.** The same block also asserts
  `truncation.structuralFloorExceedsBudget` is `false` (`context.test.ts:558`), which becomes `true`
  on the realistic fixture. 6.2 names only `:559`; converting one without the other leaves a failing
  or misleading assertion.
