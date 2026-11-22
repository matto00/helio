## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `9da94e47fe4ce68070c3ff21551ed732dee8396a`, which is the cycle-1 code plus the fix commit `9da94e47f`.
The fix commit adds one test spec and changes only Markdown. `git diff 7395e0409 HEAD -- helio-mcp schemas
backend/src/main` is empty, so the code under review is the code verified in cycle 1.

### Phase 1: Spec Review — PASS

- **CR1 (decode failures are not isolated per pipeline): resolved by amending the artifacts, the option I preferred.**
  - The spec now limits the omit-and-200 scenario to a pipeline's projection or a source lookup.
  - The spec adds a scenario "A stored step that cannot be decoded": the read returns non-2xx, the same as
    `/context-details`, and the client falls back to per-pipeline analyze. This now matches the code
    (`listByPipelineInternalBatch` decodes every row, `PipelineStepRepository.scala:382`).
  - design.md D6 gains an "as built" scope paragraph.
  - measurements.md records the deviation and the fallback cost (8 + 2 + P + Op + D).
- **CR2 (design.md D8 out of date): resolved.** D8 now describes the schema as built: its own `Step`/`Warning` with
  the same required keys and `additionalProperties: false` as `AnalyzeStep`/`AnalyzeWarning`, `SchemaField` by
  `$ref`, and values loosened because of C15.
- **New guard test, `PipelineContextAnalyzeUndecodableRowSpec`.**
  - It inserts a raw `pipeline_steps` row whose config cannot be decoded, by its exact id, and deletes it in a
    `finally`.
  - It asserts that context-analyze is non-2xx and returns the same status as context-details, and that the healthy
    pipeline's own `/analyze` is still 200. It also checks for 200 before the insert, so the failure is not an
    artifact of the setup.
  - The guard can fail: a change that isolated decode failures per pipeline would make context-analyze answer 200,
    and the assertion would fail. I checked this by reading the code, not by running a mutation, because I don't
    change code.
- `openspec validate batch-pipeline-analyze-context --strict`: valid.
- CONSTRAINTS C1-C15 are honored.

### Phase 2: Code Review — PASS

Gates, run fresh in `WORKTREE_PATH`:
- `npm run lint`: exit 0.
- `npm run format:check`: clean.
- `npm run check:scala-quality`: clean, soft warnings only.
- sbt with `-J-Xmx3g` and `nice -n 19`, `DATABASE_URL` set to helio_hel1625 and `ANTHROPIC_API_KEY` empty:
  `PipelineContextAnalyzeUndecodableRowSpec`, `PipelineContextAnalyzeRoutesSpec`,
  `PipelineContextAnalyzeQueryCountSpec` and `PipelineAnalyzeUpsertGranteeGuardSpec` ran 10 tests, all pass. Every
  suite name appears in the output.

I did not re-run these, because they are unchanged since cycle 1 and still pass from that run:
- jest and the MCP typecheck: no `helio-mcp` change.
- the existing analyze specs: no `backend/src/main` change.

### Phase 3: UI Review — PASS (no change since cycle 1)

No route, schema or frontend file changed in this cycle. The cycle-1 live smoke check still applies. I started no
servers this cycle.

### Overall: PASS

### Non-blocking Suggestions
- These cycle-1 suggestions still stand:
  - bf481b1fe is not bisectable for the backend: the backend test source set does not compile at that commit.
  - `helio-mcp/src/context.ts` is 794 lines; mention it in the PR.
- The new spec overrides `pipelineRunRepoFor` with a real `PipelineRunRepository` so that `/context-details`
  answers for real. Add a one-line comment saying why.
