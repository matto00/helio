## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Round-1 CR#2 (inline-source arm) — CLOSED.**
- Re-read `schemas/pipelines/create-pipeline-request.schema.json` myself:
  `"required": ["name","sourceDataSourceId"]`, `additionalProperties: false`, no inline
  source. design.md decision 2, tasks 3.2, and `specs/mcp-output-tools/spec.md`'s
  `create_pipeline` requirement now all state option (a) — two HTTP calls, one MCP call —
  and name the failure semantics (orphaned data-source id surfaced in the error).
- The named recovery tools are real and survive this ticket:
  `delete_data_source` (`helio-mcp/src/tools/write.ts:1098`) and `teardown_resources`
  (`write.ts:796`); neither is on the removal list (tasks 3.9). The spec adds an explicit
  failure scenario. Grounded, non-hand-wavy.

**Round-1 CR#3 (source-attached Outputs) — CLOSED.**
- `schemas/outputs/output.schema.json:22` still declares `nodeStepId: ["string","null"]` and
  lists it required, so the null case is live.
- `PipelineAnalyzeService.scala:171-172` still documents that the source is *not present* in
  the `analyzeNodes` map. design.md decision 5, task 1.4, and a new spec requirement +
  scenario now route `nodeStepId: null` to the source's own `inferredSchema`.
- `inferredSchema` is real on the source, not aspirational: `DataSource.scala`,
  `DataSourceProtocol.scala`, `DataSourceRepository.scala`, `PipelineService.scala`, and
  `PipelineAnalyzeService.scala:118` (whose own comment says callers take the source schema
  "from `DataSource.inferredSchema` directly ... not through this"). The design's chosen path
  matches what the code already says to do.

**Round-1 CR#1 (helio-mcp verification command) — text corrected, but the replacement is
vacuous in the environment the executor actually runs in. See CR#1 below.**

**Other checks**
- Tool tables (tasks 3.x / 3.9 / spec "no aliases" requirement) unchanged from round 1 and
  still a character-match with the epic spec's decision-10 lists.
- `check-schema-drift.mjs` pairing (decision 4 / tasks 1.1-1.3 + 3.10) unchanged, still correct.
- `asNumeric` non-goal unchanged, still the right guard.
- No `TODO`/`TBD` in the change dir; every ticket AC still traces to a task.

### Verdict: REFUTE

Two of the three round-1 defects are genuinely closed. One is not — the corrected text
substitutes a command that returns *zero tests and exit 0* inside a delivery worktree, which
would certify HEL-647 as fixed without executing a single line of helio-mcp.

### Change Requests

1. **`npm test`'s jest portion collects ZERO tests inside a Concertino worktree — tasks 5.9,
   5.6, 3.1 and design decision 1 would all pass vacuously.** Reproduced (twice, plus a
   control in the main checkout):
   - In this worktree: `npx jest --listTests` → **empty**, exit 0.
     `npx jest --passWithNoTests` → `No tests found, exiting with code 0`.
   - In `/home/matt/Development/helio` (main checkout): `npx jest --listTests` → **14** files.
   - Root cause, read from `jest.config.cjs`: `testPathIgnorePatterns` contains
     `"/.claude/worktrees/"`, which is matched against the *absolute* test path. Every test in
     this worktree lives under `/home/matt/Development/helio/.claude/worktrees/...`, so all 14
     are ignored. (`modulePathIgnorePatterns` is `<rootDir>`-anchored and correctly does not
     match — only the test-path pattern bites.) The root script is
     `"test": "jest --passWithNoTests && npm --prefix frontend test"`, so the empty collection
     is silently green.
   So round 1's finding ("root jest **is** the helio-mcp suite") is true of the main checkout
   and false of the executor's worktree — the plan swapped one wrong command for another.
   As written, "root `npm test` ... stays green with no OOM" is satisfied by running nothing;
   the OOM the whole decomposition exists to fix would never be exercised.
   Fix, in `tasks.md` 5.9 (and the matching design.md Risks bullet + decision 1's verification
   sentence): specify a command that actually collects the helio-mcp suite from inside a
   worktree — e.g. run jest with an explicit `--testPathIgnorePatterns` override that omits
   `/.claude/worktrees/` (keeping `/node_modules/`, `/frontend/`, `/e2e/`, `/helio-mcp/dist/`) —
   **and** require the executor to assert a non-zero collected-suite count (`--listTests` shows
   14 files, or the run reports 14 suites) before treating green as evidence. Drop the reliance
   on `--passWithNoTests` as the HEL-647 gate. Decide this in the plan; do not leave the
   executor to discover the empty collection mid-cycle.

2. **`specs/mcp-output-tools/spec.md` still states the wrong create route in a normative SHALL.**
   The `add_output/...` requirement says the tools go over "`POST/PATCH/DELETE /api/outputs`".
   Verified against `backend/src/main/scala/com/helio/api/routes/pipelines/OutputRoutes.scala`:
   create is `POST /api/pipelines/:id/outputs` (`:31-41`); only `PATCH`/`DELETE`/`GET` (+`rows`,
   `panels`, `assertion-status`) hang off `/api/outputs/:id`, and `GET /api/outputs` is the list.
   Flagged non-blocking in round 1 and carried forward unchanged; since the artifacts are being
   revised anyway, correct it now — an executor implementing the SHALL literally gets a 404.

### Non-blocking notes

- `design.md` Context still says `write.ts` is "~2800+ lines"; `wc -l` says **1241**. Third
  time this number is wrong in the plan. Correct it so the decomposition isn't sized against a
  phantom.
- `proposal.md:37-39`'s absorbs list still omits **HEL-670** and **HEL-829**, though tasks 1.6
  and 1.8 act on both.
- Round 1 asked task **5.4** to add the source-attached arm. `specs/mcp-output-tools/spec.md`
  now carries it as a scenario (which is the binding AC), but tasks.md 5.4 still names only the
  tail case. Harmless if the executor works from the spec; cheap to mirror.
- The unowned `WorkspaceSearchService` `DataType` wire-string / `ProposalPanelSupport`
  `dataTypeId` vestige from round 1 is still unclaimed by any task. Still worth an explicit
  in-scope/out-of-scope line rather than leaving it to discovery.
