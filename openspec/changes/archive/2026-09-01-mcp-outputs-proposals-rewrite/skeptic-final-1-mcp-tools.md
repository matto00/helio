## Skeptic Report — final gate, dimension 1: MCP tool surface + removals (round 1, skeptic-final-1-mcp-tools.md)

Note on filename: `next-report-number.sh` returned `skeptic-final-1.md`, but this
is a four-way dimension-split fan-out and the script is not dimension-aware — all
four parallel skeptics would be handed the same `-1` name. Written to the
dimension-suffixed `skeptic-final-1-mcp-tools.md`, which is collision-safe by
construction.

### What I verified (with evidence)

**Test suite actually runs (not root `npm test`).** Ran the ticket's verified
scoped command from inside `helio-mcp/`:
`npx jest --rootDir . --config '{"preset":"ts-jest",...,"testPathIgnorePatterns":["/node_modules/","/dist/"]}'`
→ `Test Suites: 18 passed, 18 total / Tests: 182 passed, 182 total / 2.996s`.
`src/server.test.ts` is in the PASS list. No `.skip`/`xit`/`xdescribe` anywhere in
that file (grep, no hits). (Suite/test counts differ from the ticket's recorded
"250 tests / 14 suites" — expected, given the tool-file decomposition and the
removal of the DataType/Metric tool tests; not an anomaly.)

**Removed tools are genuinely absent, with no alias.** `src/server.test.ts`'s
`REMOVED_TOOLS` covers all 12 names the spec's "Removed tools have no aliases"
requirement lists, plus `create_panel`/`create_panels`/`create_pipeline_from_shape`.
I did not rely on that test alone — I derived the registered set independently
from source (`grep -A2 registerTool(` across `src/tools/*.ts` + `src/*.ts`, tests
excluded → 60 unique names) and `diff`'d it against the test's
`EXPECTED_TOOL_NAMES` list: **IDENTICAL**, 60 vs 60. None of the 12 removed names
appears in it.

**The exact-set assertion is real, not a containment check.** `server.test.ts:174-178`:
`expect([...names].sort()).toEqual([...EXPECTED_TOOL_NAMES].sort())` — a true
`toEqual` on sorted arrays. The weaker `not.toContain` / `arrayContaining` /
duplicate-check tests exist alongside it but are not the load-bearing assertion.
The premise is sound too: `listRegisteredToolNames()` spins up a real in-process
MCP client over `InMemoryTransport` against `createServer(api)` and calls
`client.listTools()` — it reads the actual advertised surface, not
`McpServer._registeredTools` internals.

**New tools all present and registered.** All 11 from the brief appear in the
independently-derived registered set: `add_output`, `update_output`,
`delete_output`, `list_outputs`, `get_output_rows`, `preview_outputs`,
`get_output_capabilities`, `place_outputs`, `create_content_panel`,
`add_outputs_from_shape`, `create_pipeline`. `server.ts:30-38` registers 9 tool
modules including `registerOutputTools`/`registerPipelineTools`/`registerPlacementTools`.

**Removed-tool names in descriptions are migration hints, not stale guidance.**
Grepped every removed name across `src/`. The remaining hits are either code
comments or description text of the form "replaces the retired `get_data_type_rows`"
(`outputs.ts:149,212`, `pipelines.ts:95`, `placements.ts:40-41`). None instructs an
agent to call a removed tool; this is decision-11 rename-table framing. Pass.

**Spray-json `None`-omission handling.** Grepped `=== null` / `!= null` etc. across
non-test `src/`: only `httpClient.ts:220` (a `Retry-After` header, where `null` is a
genuine DOM return) and a doc comment. Optional wire fields are handled by
`?? null` / truthiness, never `=== null`. Query params: `httpClient.ts:230` sets a
search param only `if (value !== undefined)`, so `preview_outputs`' `outputId` and
`get_output_capabilities`' `stepId` are genuinely omitted when absent, per spec. Pass.

**HEL-934 expand-envelope fix is proved by a real HTTP-layer test, not a mock.**
`helioApi.ts:522-531` unwraps `.steps` from `{steps, outputs}`;
`helioApi.test.ts:153-188` drives it through a real `HelioHttpClient` with an
injected `fetchImpl` returning the true envelope (including the zero-step arm).
This is the one place the cycle-14 mock-level blind spot mattered, and it is
covered by a non-mocked test. Pass.

**create_pipeline single-call contract.** `pipelinesHandlers.ts:113-159` matches all
three spec scenarios: `sourceId` → one `POST /api/pipelines`; inline spec →
`POST /api/data-sources`/`/api/sources` then `POST /api/pipelines`; on failure of
the second call the thrown error names the orphaned source id
(`pipelinesHandlers.ts:144-152`). `csv` is explicitly rejected inline with a
message pointing at `create_csv_data_source`. Pass.

---

### Verdict: REFUTE

The three checks I was briefed on all pass. The refutation is on the same
dimension's wider question — whether the removal sweep across the *registered tool
surface* is complete. It is not. Four currently-registered tools still advertise,
and two still return, the retired DataType model, and one of them is actively
agent-misleading at runtime.

Ground truth: `backend/.../protocols/sources/DataSourceProtocol.scala:184-189`,
`final case class CreateSourceResponse(source, inferredSchema, fetchError, rowCapNotice)`
— **no `dataType` field exists on the wire.** `GET /api/types` has no route at all
(grep of `backend/src/main/scala` for `api/types` returns only comments;
`routes/pipelines/README.md:5` states `DataTypeRoutes` was deleted in HEL-904).

### Change Requests

1. **`create_rest_data_source` / `create_sql_data_source` return a permanently-null
   `dataType`, and their own descriptions tell the agent that means failure.**
   `helio-mcp/src/helioApi.ts:429-433` and `:461-465` both do
   `dataType: raw.dataType ?? null` against `RawCreateSourceResponse`
   (`helioApi.ts:75-79`), a shape whose `dataType?` the backend can no longer emit.
   So every successful create now returns `dataType: null`, while
   `write.ts:124-128` says *"on success the response includes the auto-created
   companion DataType; on failure it returns dataType: null and a fetchError
   message"* (and `write.ts:163-167` says the same for SQL). An agent that reads the
   tool's own contract concludes a successful source creation failed. Worse, the
   wrapper **drops `inferredSchema` and `rowCapNotice` entirely** — `inferredSchema`
   being exactly the field this ticket added to `types.ts` and
   `get_workspace_context` because agents need it to author Outputs. Fix: drop
   `dataType` from `RawCreateSourceResponse`/`CreateSourceResult`
   (`types.ts:529-533`), surface `inferredSchema` (and `rowCapNotice`) instead, and
   rewrite both descriptions to describe the real response. No test covers this —
   grep for `dataType` in `write.test.ts`/`helioApi.test.ts` returns nothing — so
   add one asserting the wrapper's output shape against a realistic
   `CreateSourceResponse` body.

2. **`create_data_source` (static) and `create_csv_data_source` descriptions still
   promise a companion DataType that no longer exists.** `write.ts:57-64` ("The
   backend auto-creates a source-companion DataType (NOT panel-bindable) … the tag
   is propagated to the auto-created companion DataType too") and `write.ts:94-98`
   (same claim, "NOT returned inline — inspect it via list_source_objects"). Both
   describe a retired model as current behavior. Rewrite onto the source →
   pipeline → Output path.

3. **`create_data_source`'s description carries a copy-paste leftover about a
   pipeline it never creates.** `write.ts:65-68`: *"HEL-907: this tool creates the
   pipeline with ZERO Outputs for now (pending its own retarget onto Outputs, task
   3.4) -- use add_output afterward…"* — this is a static-data-source tool; it
   creates no pipeline, and task 3.4 is closed (`tasks.md`, `@ 34d348af`). Delete it.

4. **`run_pipeline`'s description and `RunOutcome` still speak of an output
   DataType.** `write.ts:314-318` ("write rows to its output DataType … Returns
   { …, outputDataTypeId, … }"), backed by `helioApi.ts:555`
   `outputDataTypeId: summary.outputDataTypeId` and `types.ts:254-255,370-371`.
   Verify against the current `PipelineSummaryResponse` whether that field still
   exists on the wire; if it does not, this is CR1's defect a second time (a field
   that is always `undefined`), and if it does, the naming should still be
   retargeted since this ticket's whole premise is that a pipeline produces Outputs.

5. **`helioApi.listDataTypes` is dead code pointing at a deleted route.**
   `helio-mcp/src/helioApi.ts:241-243` still issues `GET /api/types`.
   `execution-progress.md:365-367` deliberately kept it for `proposal.ts`'s
   grounding — but cycle 10 (`execution-progress.md:436`) then swapped `proposal.ts`
   onto `fetchAllOutputs`, leaving zero call sites (confirmed: grep for
   `listDataTypes` in non-test `src/` returns only the definition). Delete it and
   `DataTypeResponse` if nothing else needs it. The stated reason for keeping it no
   longer holds.

### Non-blocking notes

- `add_outputs_from_shape`'s spec text (`specs/mcp-output-tools/spec.md:73-80`) says
  `(pipelineId, stepId?, shape, params)` and "instantiating a shape's **Outputs**"
  (plural); the implementation is `(pipelineId, stepId?, shapeId, params, outputName,
  outputKind?)` and creates exactly one Output on the terminal step
  (`pipelinesHandlers.ts:175-204`). The implementation looks right; the spec prose is
  loose. Worth tightening the spec rather than the code.
- `add_output`'s spec scenario says the agent passes `kind` and `fieldMapping`;
  both the TS `CreateOutputRequest` (`types.ts:203-208`) and the backend's
  (`OutputProtocol.scala:31-36`) take `kind`/`name`/`config`, with `fieldMapping`
  living inside `config`. Consistent on both sides — spec wording only. (Dimension 4
  owns the wire contract; flagging for their cross-check.)
- `refinement.ts:29,120` and `types.ts:797` still carry `"dataType"` in the
  refinement `kind` enum. If the backend no longer accepts that discriminator, it is
  the same class as CR2; if it does, it is HEL-910's sweep. Worth one trace.
