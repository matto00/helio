## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/pipeline-analyze-api/spec.md`, and the premise-validation artifact.
- **Full-tree consumer sweep** (not the design's table): `grep -rn "sourceDataSourceName" --exclude-dir=node_modules --exclude-dir=.git .`. Confirmed the in-scope per-root hits the design lists, and confirmed the out-of-scope `PipelineSummary` list-scalar hits are genuinely a different concept (`PipelineRepository.scala:239,352,410,581`, `WorkspaceSearchService.scala:149`, `WorkspaceSearchServiceSpec.scala:146,168,234`, `scripts/agent/workspace.sh:40`) — the exclusion is correct.
- **Construction sites:** `RootSourceSchemaResponse` is built at `PipelineService.scala:982,1348` and in `PipelineAnalyzeRoutesSpec.scala:570` / `PipelineAnalyzeProposalRoutesSpec.scala:654` — all positional, so compile-safe under a rename. Format is `jsonFormat3` (`PipelineAnalyzeProtocol.scala:343`), so the wire key follows the field name; no explicit field-name string exists. Tasks 2.2/2.3 are sound.
- **Spec delta well-formedness:** the MODIFIED header `### Requirement: Source schema derived from bound DataSource's registered DataType fields` matches `openspec/specs/pipeline-analyze-api/spec.md:116` exactly, and the delta reproduces all three existing scenarios plus one new one. Good.
- **Ran the exact AC8 command** (`grep -rn "sourceDataSourceName" backend/src/main/scala/com/helio/api/protocols schemas/pipelines helio-mcp/src frontend/src`) against the current tree, twice, and classified every hit as code vs. comment.
- **Read `scripts/check-schema-drift.mjs`** (lines 1–150) to establish what the `npm run check:schemas` gate actually compares, rather than trusting the design's claim about it. Confirmed schema `title`s are `PipelineAnalyzeResponse` / `PipelineAnalyzeProposalResponse`.

The plan is broadly sound — the hard-rename decision (D1), the atomic helio-mcp update (D2), the no-migration position, and the exclusion list are all correct and well-argued. Three specific defects block it.

### Verdict: REFUTE

### Change Requests

1. **AC8 is unsatisfiable as written, and directly contradicts design D5.** D5 says comments that narrate the *retired singular scalar* are historically accurate and stay. But AC8 demands a **zero-hit** grep over trees that contain exactly such comments. I ran AC8's literal command; after a perfect implementation these 8 hits remain, all comments/descriptions about the retired scalar:
   - `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala:181`
   - `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala:103`
   - `backend/src/main/scala/com/helio/api/protocols/workspace/WorkspaceContextProtocol.scala:125`
   - `schemas/pipelines/pipeline-analyze-response.schema.json:17` (`description`)
   - `helio-mcp/src/types.ts:277`, `helio-mcp/src/types.ts:503`
   - `helio-mcp/src/context.ts:321`, `helio-mcp/src/runPipelineTruncation.test.ts:23`

   As written, the executor must either fail AC8 or delete accurate history — the same "zero-hit grep vs. truthful name" bind that HEL-969 hit and that this ticket exists to unwind. **Required revision:** restate AC8 so it targets *declarations/wire keys*, not raw text — e.g. zero hits for `grep -rn "sourceDataSourceName" ... | grep -v '^\s*\(//\|\*\|/\*\)' ` is still fragile; prefer an explicit enumeration: zero hits excluding the eight comment/description lines above, which AC8 must name as permitted residue (or the AC must require a per-hit classification with each residual hit justified as retired-scalar narration). Whatever form is chosen, ticket AC8, design D5, and task 7.1 must agree.

2. **The design's primary risk mitigation is false: `check:schemas` does not scan this field.** `design.md` Risks says the missed-consumer risk is "mitigated by ... the `check:schemas` drift gate (backend↔schema)". It is not. `scripts/check-schema-drift.mjs:113-147` matches each `*.schema.json` by its **`title`** to a case class and diffs **top-level `Object.keys(schema.properties)` only**. The renamed field lives in `$defs.RootSourceSchema` (`pipeline-analyze-response.schema.json:35-52`, `pipeline-analyze-proposal-response.schema.json:30-`), a nested `$def` with no `title` and no case-class counterpart in the gate's map. It also never inspects `required` arrays at all. **Consequence:** if the executor renames the Scala field and forgets both schema files, `npm run check:schemas` still exits 0 — the mitigation the design leans on is vacuous, leaving AC8's grep (itself broken per CR1) as the only real guard. **Required revision:** correct the Risks section to state that the drift gate does *not* cover nested `$defs` or `required` arrays, and add a task that verifies the two schema edits directly (both `properties` and `required`, both files), since no automated gate will.
   Note this is not a request to change the gate — only to stop crediting it with coverage it does not have.

3. **AC7 is vacuously satisfiable as worded, because `dataSourceName` is a substring of `sourceDataSourceName`.** AC7 requires only "asserts the renamed field present with a non-empty value on a serialized JSON response body". The obvious implementation, `responseAs[String] should include("dataSourceName")`, **passes unchanged against the pre-rename wire** — the old key literally contains the new one. Task 3.2 does add the "assert `sourceDataSourceName` absent" half and 3.3 requires a demonstrated red, but the AC (which is what gets checked at the final gate) does not. **Required revision:** tighten AC7 to require both halves at the AC level, and to assert on parsed JSON keys rather than substring containment — e.g. parse the body to a `JsObject` and assert `sourceSchemas(0).asJsObject.fields.keySet` contains `dataSourceName`, does **not** contain `sourceDataSourceName`, and that the value is a non-empty `JsString`. Keep task 3.3's red-demonstration requirement and require the observed failure output be recorded.

### Non-blocking notes

- The design's consumer table omits `helio-mcp/src/context.ts:321` and `helio-mcp/src/runPipelineTruncation.test.ts:23`. Both are comment-only (no code change needed), but the table presents itself as the complete enumeration and both fall inside AC8's grep scope — adding them makes CR1's classification mechanical.
- `openspec/specs/pipeline-analyze-api/spec.md:50` still lists `sourceDataSourceName` among the analyze response's "pipeline summary fields". That is the retired singular scalar (removed by HEL-913), i.e. stale text in the *canonical* spec, and it is out of this ticket's scope — but AC3 ("the spec reflects the renamed field") reads as if it might cover it. Worth one clarifying clause in AC3 that only the per-root requirement at `:116` is in scope, so the executor does not either fix unrequested scope or get REFUTEd for leaving it.
- `PipelineAnalyzeRoutesSpec.scala` (the spec for `GET /api/pipelines/:id/analyze` itself) is absent from the Impact list; it constructs the shape positionally so nothing breaks, but it is the more natural home for the AC7 wire assertion than the *proposal* routes spec.
