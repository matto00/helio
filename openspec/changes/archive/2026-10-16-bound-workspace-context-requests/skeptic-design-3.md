## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD db91c840ea729c1b3f662ae1eb01643ac1739e2d. The change dir is untracked. Spawn-cwd guard: `READY`.
The owner ruling is `escalation.answered` = `B-identical-plus-backend-batch`, answer_source `human`, in
`.concertino/runs/HEL-1619/events.jsonl`. I did not reopen it.

### What I verified (with evidence)

**The round-2 blocking item (seam contract) is fixed.**
- design.md D10 adds two guards, and both are required:
  - (a) schema validation on both sides of the seam;
  - (b) a live probe, through the real `HelioHttpClient`, against the worktree backend.
- Each guard must be shown red once by mutating a key.
- The spec requirement "Client and server agree on the batched read's shape" exists and has a live-seam scenario.
- Tasks 3.4, 4.4 and 4.5 cover the work, and standing constraint C6 restates it.
- D5 sets `additionalProperties: false` on the item and step objects, so a renamed key fails validation.
- A non-404 fallback writes a stderr warning, so a production mismatch is visible.

**Feasibility of D10, checked against the code.**
- The backend side has an existing harness. `backend/src/test/scala/com/helio/testsupport/JsonSchemaValidation.scala`
  uses networknt and validates 2020-12, and its `$id` translator resolves the cross-file
  `https://helio.local/schemas/...` refs offline.
- `pipeline-run-record.schema.json` exposes `$defs/AssertionSummary` (line 124 refs it), so D5's `$ref` is possible.
- On the MCP side, `helio-mcp/node_modules/ajv` is 8.20.0. CI runs `npm --prefix helio-mcp ci` in the same `frontend`
  job that runs `npm test` (ci.yml:37, 164).
- Root jest collects `helio-mcp/src/*.test.ts` (jest.config.cjs ignores only `helio-mcp/dist`).
- `BACKEND_PORT: 9958` in workflow-state.md matches D10b.

**The round-2 non-blocking notes:**
- `listPipelineSteps` reuse: fixed. D6 and task 2.1 now say REUSE, and the method exists at helioApi.ts:853-856.
- D4's dangling "it": fixed ("`latestRunAssertions` must NOT be listed as required").
- D4/D5 step-schema contradiction: fixed. The step shape is inlined and the assertion summary uses `$ref`.
- `listAssertionsByRunInternal` ordering: addressed in D4.
  - Confirmed there is no ORDER BY at PipelineRunRepository.scala:664-665.
  - The 4.2 parity test, which must include a run with >=2 failures, is named as the guard.
- Caller-must-confirm-access: addressed. D4 documents `latestAssertionsFor` that way.
- `summarizeAssertions` widening: NOT fully reconciled. See note 1.

**Fresh review of the whole plan against the code:**
- D2 scope: `GET /api/pipelines` is owner-only. Spec scenario 4.1 matches that (the viewer-granted pipeline is absent).
- `history` (PipelineRunQueries.scala:90-117) works like this:
  - it returns empty when the repo is null;
  - otherwise it runs `findByIdShared`, then the system-context `listByPipelineInternal` (sorted by `startedAt desc`,
    any status, PipelineRunRepository.scala:543-549), then `summarizeAssertions` per run.
  - D4's batched latest-run read plus the null-repo omission matches all of this.
- D6 mapping matches context.ts:
  - `lastRunAssertions` is `history[0]?.assertions ?? ZERO_ASSERTION_SUMMARY`.
  - `laneTree` uses only `steps` from `getPipeline` (two GETs, helioApi.ts:310-316).
  - Self-caught, kicked-off-early promises match the HEL-1617 pattern (context.ts:504-521).
- D1 routing:
  - `new PipelineRoutes` is at ApiRoutes.scala:946.
  - `PipelineIdSegment` is unconstrained, per the analyze-proposal precedent comment at PipelineRoutes.scala:41-44.
  - Mounting the new route class before it is required, and the design says so.
- AC coverage:
  - AC1 (55-pipeline fixture within 120): spec "Request count is bounded" plus task 3.1. The exact count is
    asserted, and the old path is shown red.
  - AC2 (no field dropped): the payload is byte-identical against a golden captured from main's code (D9, tasks
    2.0/3.2), on the batch, 404-fallback and missing-pipeline paths.
- No placeholders or TBDs. Every task has a verification signal.

### Verdict: CONFIRM

### Non-blocking notes
1. **D1 and D4 still contradict each other on `summarizeAssertions`.**
   - D1 says `latestAssertionsFor` is "implemented in `PipelineRunQueries` reusing `summarizeAssertions` by widening
     its visibility to package-private".
   - D4 says it "lives in `PipelineRunQueries` (so `summarizeAssertions` needs no visibility change)".
   - D4 is correct: `summarizeAssertions` is `private` inside `PipelineRunQueries` (line 180), so a member of the
     same class needs no widening. `PipelineRunService.latestAssertionsFor` delegates.
   - Either reading is harmless as long as the code is not copied.
2. **Declare ajv in helio-mcp instead of relying on the transitive copy.**
   - ajv is only transitive in helio-mcp, pulled in by `@modelcontextprotocol/sdk`. The ajv hoisted at the root of
     the main checkout is 6.14.0, which cannot handle draft 2020-12.
   - The MCP-side test should therefore:
     - import `ajv/dist/2020` (Ajv2020);
     - resolve from `helio-mcp/node_modules`;
     - `addSchema` `pipeline-run-record.schema.json` for the cross-file `$ref`, or the compile fails.
   - Ideally, declare `ajv` as a helio-mcp devDependency, so an SDK bump cannot silently remove it.
3. **Also set `additionalProperties: false` on the response envelope**, not only on the item and step objects. That
   way a stray or renamed top-level key (e.g. `pipelines` next to `items`) is also rejected. Guard (b) would still
   catch an envelope mismatch.
4. **No task tests or demonstrates the stderr warning on a non-404 fallback.** Fold a one-line assertion into 3.2's
   fallback cases.
5. **Cosmetic:** C6 appears before C5 in tasks.md.
