## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Round-1 change requests, re-measured on the CURRENT artifacts (not accepted because they were revised):

1. **CR1 (jest command) — FIXED and MEASURED TRUE.** From inside the worktree:
   `npx jest helio-mcp --testPathIgnorePatterns "/node_modules/" "/openspec/" "/frontend/" "/e2e/" "/helio-mcp/dist/" --listTests`
   collects a NON-EMPTY list of exactly 13 suites; the full run prints `Test Suites: 13 passed, 13 total / Tests: 225 passed`.
   Both `node_modules` and `helio-mcp/node_modules` exist (`ls -d`). tasks 1.1/1.2, 11.3 and design Risks now name the root
   config correctly and no longer reference a non-existent helio-mcp jest config. The counts quoted (13/225) are exact.
2. **CR2 (`update_dashboard_appearance`) — FIXED and TRUE.** `grep -rn "update_dashboard_appearance" helio-mcp/src` → no hits;
   `grep -n "api/dashboards" helioApi.ts` shows the only PATCH is `{ layout }` at `:1012`. D7 and
   `specs/mcp-edit-in-place-tools/spec.md` now say appearance is out of scope, not already covered. Correct.
3. **CR3 (delete return shape) — FIXED, with one wording caveat (non-blocking note 1).** `deleteDashboard` (`helioApi.ts:952`) and
   `deletePipeline` (`:982`) both `await this.http.delete(...)` and return a synthesised `{ deleted: true, id }`. Task 3.3's
   self-contradiction is gone and its reasoning about `JSON.stringify(undefined)` matches `guarded()`/`jsonResult` at
   `write.ts:47-51`. CONFIRMED.
4. **CR5 (uncovered spec scenario) — FIXED.** tasks 7.7 now covers "Deleting an absent schedule is not reported as success"
   with a content assertion. CONFIRMED.
5. **CR4 (`&` probe falsifiability) — PARTIALLY fixed; a new, larger defect emerged (see CR2 below).** The probe now
   correctly requires the registered tool handler, the create path, and explicit segment scoping — but the mechanism it
   prescribes is unexecutable, and its scoping claim is factually false.

Independent checks (design prose vs. code):
- `httpClient.ts` verbs at 97/102/111/117/124 — CONFIRMED by grep.
- `guarded()` message format and `isError: true` at `write.ts:51` — CONFIRMED by reading the function.
- `update_pipeline` registered at `write.ts:966/967` as a rename-only precedent — CONFIRMED.
- `write.ts` exports ONLY `boundPipelineStepSchema` (line 42) and `registerWriteTools` (line 63). Every tool description,
  Zod schema and handler is inline inside `registerWriteTools`. Nothing in `write.ts` is reachable by a test without
  importing the whole module.
- **Measured, not inferred:** I wrote a throwaway test importing `./write.js` onto a fake `registerTool` recorder and ran it
  under the task-1.2 command. Result: `FATAL ERROR: Ineffective mark-compacts near heap limit — JavaScript heap out of
  memory`, node core-dumped after ~80s at a 4 GB heap. (Probe file deleted; `git status --short` shows only the untracked
  change dir.) This reproduces, from the other direction, what six existing test files already document in their headers
  (`write.test.ts:12-20`, `updateSchemas.test.ts:8`, `proposal.test.ts:9-15`, `pipelineProposalValidation.test.ts:8`,
  `pipelineProposalHandlers.test.ts:6`, `refinementHandlers.test.ts:5`): importing a module that holds `registerTool` +
  full Zod surface is TS2589/OOM under this repo's ts-jest config. The repo's answer has always been to EXTRACT the
  testable part into a sibling module (`updateSchemas.ts`, `metricSchemas.ts`, `assertSchemas.ts`, `proposalValidation.ts`).
- `helio-mcp/scripts/verify.ts` EXISTS and is exactly a real-MCP-SDK `Client` + `StdioClientTransport` harness that spawns
  the built `dist/index.js` against a live backend (`npm run verify`, env `HELIO_API_BASE_URL` + `HELIO_PAT`).

### Verdict: REFUTE

### Change Requests

1. **Tasks 6.1–6.3, 7.1–7.7 and 8.1 are unexecutable as written: they require reaching descriptions/handlers that live
   only inside `registerWriteTools`, and importing `write.ts` from a test OOMs the type-checker.** Measured above:
   node dies with a heap OOM at 4 GB. Task 5 says "Register ... in `write.ts`" with descriptions written inline (5.5), and
   then tasks 6/7 assert on those descriptions and on tool call behaviour — with no task bridging the two. The design's
   Risks section leans on the same impossible test ("Mitigated by a unit test asserting the description names both `kind`
   values..."). An executor following this will discover the OOM mid-cycle and improvise, which is precisely how the
   plan's own standing requirement 1 gets violated. Fix by adding an explicit extraction task, following the established
   sibling precedent: put the four tool DESCRIPTIONS (as exported string constants) and the thin handlers
   (`setPipelineScheduleHandler` etc., taking `HelioApi`) in a new zod-free module (e.g. `helio-mcp/src/tools/scheduleTools.ts`,
   next to `updateSchemas.ts`), have `write.ts` import and register them, and state that tests import THAT module, never
   `./write.js`. Then re-point 6.1–6.3, 7.1–7.7 and 8.1 at it. `z.enum`/`z.string()` schema shapes that must stay in
   `write.ts` cannot be unit-tested this way — say so, rather than leaving a task that silently cannot be honoured.

2. **D8/task 8.3's scoping claim is false, and it scopes out the leading suspect the repo can actually reach.** Both assert
   "the agent client and the MCP stdio transport, which no in-process test can reach". `helio-mcp/scripts/verify.ts` is an
   existing, checked-in harness that spawns the BUILT server over the real `StdioClientTransport` with the real
   `@modelcontextprotocol/sdk` `Client` and reads `result.content[].text` — its own docstring calls it "the 'connect a real
   MCP client' evidence the Phase-2 gate asks for", and `npm run build` + `npm run verify` are existing scripts. So the one
   segment D8 names as unruled-out (SDK JSON transport) IS reachable, by a mechanism the design never mentions. As written
   the plan would again close AC4 on a measurement blind to the suspected cause, just one layer further out than round 1.
   Require the probe to run through a `verify.ts`-style stdio client against the running dev backend (create with an `&`
   name, rename to a different `&` name, read back, asserting the exact string in the transport-delivered `text` at each
   step), and reserve the "not reachable in this repo" scoping strictly for the calling agent's own client — which is all
   that genuinely remains.

### Non-blocking notes

- Task 3.3 returns `{ deleted: true, pipelineId }` while every sibling (`deleteDashboard` `:952`, `deleteDataSource`,
  `deleteDataType`, `deletePanel`, `deletePipeline` `:982`, `deleteMetric`) returns `{ deleted: true, id }`. The divergence
  is defensible (the schedule's own id is not what was passed) but it is agent-facing shape, so it should be a stated
  decision in design, not an unremarked deviation from a six-method convention.
- tasks.md section 7 lists 7.5, then 7.7, then 7.6 — renumber so the sequence reads in order.
- Task 8.2 requires a running dev backend AND a valid `HELIO_PAT`; no task provisions that. Worth naming in task 1 with the
  environment checks, since it is the only live-backend dependency in the plan.
- D4's honest statement of the `z.enum` trade-off (round 1's non-blocking note) was incorporated verbatim and reads true.
