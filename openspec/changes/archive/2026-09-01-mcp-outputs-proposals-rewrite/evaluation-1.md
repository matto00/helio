## Evaluation Report — Cycle 1 (evaluation-1.md)

Scope reviewed: `git diff main...HEAD` (131 files, +8576/-5775), all planning
artifacts, all 6 skeptic design rounds, `execution-progress.md`,
`files-modified.md`.

### Gates — re-run independently by me (not the executor's report)

| Gate | Command | Result |
| --- | --- | --- |
| helio-mcp jest (scoped) | ticket's verified command | **18 suites / 181 tests, all pass** (see note G1) |
| Backend | `sbt -batch 'set Test/parallelExecution := false' test` | **3518/3518, 235 suites, 0 failures** |
| Frontend jest | `cd frontend && npm test` (see note G2) | **275 suites / 2969 tests pass** |
| Lint | `npm run lint` | pass (0 warnings) |
| Format | `npm run format:check` | pass |
| Typecheck | `npm run typecheck` | pass |
| Schema drift | `node scripts/check-schema-drift.mjs` | pass (73 schemas / 48 protocol files; 7 panel-type surfaces) |
| Frontend build | `npm --prefix frontend run build` | pass |

**G1** — the ticket's verbatim command also picks up `helio-mcp/dist/**/*.test.js`
(gitignored compiled artifacts present in this worktree) and reports "18 failed,
18 passed / 36 total". Those 18 failures are `SyntaxError: Cannot use import
statement outside a module` on **built** files, not source. Adding
`"testPathIgnorePatterns":["/node_modules/","/dist/"]` gives a clean
**18/18 suites, 181/181 tests**. Not a code defect; see Non-blocking #1.

**G2** — worth recording for the next cycle: the root `jest.config.cjs` excludes
`/frontend/` outright, so root `npm test` never covered the frontend suite at
all, and (as ticket lesson #1 documents for helio-mcp) is additionally vacuous
inside a worktree. The frontend suite must be run as `cd frontend && npm test`.

### Phase 1: Spec Review — FAIL

Verified true (I checked each against code/DB/Linear rather than the narrative):

- **The Sleeper MCP E2E genuinely ran against a live backend.** Independently
  confirmed in the shared dev Postgres: 8 dashboards named
  `League Rosters`/`Weekly Matchups`/`League Standings`/`Waiver Transactions`
  created `2026-09-01 06:39:25`–`06:39:35` in two batches ~8s apart — exactly the
  claimed "built successfully, twice (idempotency proof)". This is not a
  typecheck-only claim.
- **PAT revoked.** No `api_tokens` row exists newer than `2026-08-29`; the
  cycle-16 throwaway PAT is gone (revocation is a row delete on this schema).
- **Tagged teardown worked for pipelines/sources**: `select … from pipelines
  where tag='e2e-sleeper-rebuild'` returns 0 rows. (Dashboards did not — see CR3.)
- **`asNumeric` moved byte-identically.** `git show main:…WorkspaceContextService.scala`
  vs `WorkspaceContextComputations.scala:396` — `diff` reports IDENTICAL. The
  HEL-373 caution was respected.
- **Task 3.11's deferral is real** by the ticket's own standard: HEL-936 exists
  (Backlog, created 2026-09-01), names the exact dispatch site
  (`PipelineDetailPage.tsx`), and its scope carve-out reasoning holds. HEL-934
  also exists and is accurately described.
- **HEL-766's target was the real one** (`PatchSetApplyRollback` step inverse
  builders omitting `enabled`/`parentStepId`), with a regression test.
- **`ProposalPanel.dataTypeId` surviving in Scala/schemas is NOT this ticket's
  leftover** — I checked `main`: HEL-904 deliberately kept that wire field name
  carrying an Output id and documented it as legacy-but-stable in
  `dashboard-proposal.schema.json`. The executor's cycle-8 self-correction on
  tasks 1.1/1.3 is accurate.

Issues:

1. **AC "Removed tools are absent from the tool list (test asserts the exact
   tool-name set)" is only half-met**, and the test's own header comment asserts
   more than the code does. See CR4.
2. **AC "`docs/agent-native.md` carries the tool rename table" is met, but the
   same doc is now internally stale** — see CR5.
3. **AC "`get_workspace_context` … HEL-865 updated to say what remains"**:
   `tasks.md` 5.2 self-reports HEL-865 was NOT updated. In practice HEL-865's
   description already carries an HEL-903-era note stating what remains
   (`analyze_pipeline` concise mode → P2.4/HEL-914), so the AC's substance is
   satisfied. Non-blocking #2.
4. The tool-removal sweep (task 3.9) was applied to registrations and types but
   **not to the surrounding live guidance text or the `helio-mcp/scripts/`
   consumers** — CR1 and CR2. This is the "fix classes, not instances" failure
   mode the ticket front-loads as lesson #2.

### Phase 2: Code Review — FAIL

Quality observations (positive): the decomposition of `write.ts`/`helioApi.ts`/
`context.ts` and the `WorkspaceContextComputations` split are clean, genuinely
behavior-preserving where claimed, and the removal tombstone comments are
unusually good — each names the task, the deleted backend route, and why no
alias exists. The HEL-910 grep-list sweep over this change's own new/changed
code produces no genuine leftovers (every `dataTypeId` hit is either the
HEL-904-blessed wire name or a historical tombstone comment).

Issues: CR1, CR2, CR3, CR4, CR6 below.

### Phase 3: UI Review — N/A

**Stated explicitly rather than skipped.** The ticket declares the UI gate N/A
(backend/MCP only). The diff does touch `frontend/**` (proposal/patch-set review
pages), but those changes are data-contract retargeting behind the same
components, they are covered by 275 green frontend suites including
`ProposalReviewPage.test.tsx`/`ProposalReview.test.tsx`/`CombinedProposalReview*`,
and the frontend app is knowingly non-functional on `main` between P1.3 and P1.6
per spec decision 17 (no deploy until a `v*` tag after P1.7) — a dev-server
walkthrough of those pages would be measuring the mid-remodel breakage HEL-936
owns, not this change. No dev servers were started.

### Overall: FAIL

### Change Requests

1. **Live tool descriptions still instruct agents to call tools this ticket
   deleted.** These are the MCP server's product surface — an agent reading them
   gets a tool-not-found. No gate can catch this (tool names are runtime
   strings; `tsconfig.typecheck.json` compiles them fine).
   - `helio-mcp/src/tools/write.ts:336` — `create_dashboard` description says
     "Returns its id (add panels with **create_panel**)". Change to
     `place_outputs` (data panels) / `create_content_panel`.
   - `helio-mcp/src/tools/read.ts:185`, `:188`, `:202` — `list_pipeline_shapes`
     description says a shape "expands … via **create_pipeline_from_shape**",
     "real validation happens inside **create_pipeline_from_shape**'s expand
     call", and "Call **create_pipeline_from_shape** with one of these ids to
     instantiate it." All three must become
     `add_outputs_from_shape(pipelineId, stepId?, shape, params)`.
   - `helio-mcp/src/tools/write.ts:493-497` — `teardown_resources` description
     says it deletes "every data source, pipeline, and **DataType**" (DataTypes
     no longer exist; it now cascades Outputs and their placements) and tells the
     caller to tag via "**create_pipeline_from_shape**'s `tag`".
   Then re-run the class sweep: `grep -nE
   'create_panel\b|create_panels\b|bind_panel|create_bound_panel|get_panel_capabilities|create_pipeline_from_shape|list_data_types|get_data_type_rows|(create|update|delete|list|get)_metric'`
   over `helio-mcp/src/**` and triage every hit as tombstone-comment (fine) vs
   live guidance (must fix) — do not fix only the three cited here.

2. **Shipped helio-mcp scripts still drive removed tools, with no ticket owning
   the fix.** `docs/agent-native.md:242-244` admits "`helio-mcp/scripts/compose.ts`
   itself still calls the retired `create_panel` tool and has not been updated
   for this remodel either" but names **no ticket** — which fails this ticket's
   own standard #4 ("a deferral is only real if it names a task that exists and a
   ticket that owns it"). Affected:
   - `helio-mcp/scripts/compose.ts:5,6,105,110,117,122,129,134,145` —
     `create_panel`, `bind_panel`, `get_data_type_rows`
   - `helio-mcp/scripts/verify-bound-panel.ts:2,9,84,122,140,144` —
     `create_bound_panel`, `bind_panel`, `create_panel`, `get_data_type_rows`
     (this script's entire premise is a tool that no longer exists — deletion is
     probably the right answer)
   - `helio-mcp/scripts/verify.ts:101` — `list_data_types`
   - `helio-mcp/README.md:114` — `bind_panel`
   Either retarget/delete them here, or file a Linear ticket and cite its id in
   both `docs/agent-native.md` and `tasks.md`.

3. **The E2E script leaks dashboards, and its header comment says otherwise.**
   `helio-mcp/e2e/sleeper-rebuild.ts:66-70` claims "every resource this script
   creates" is tagged so a re-run can `teardown_resources({tag})`. It is not:
   line 239's `create_dashboard` call passes no `tag`, and `create_dashboard`
   (`helio-mcp/src/tools/write.ts:331-346`) has no `tag` parameter at all — so
   tag-scoped teardown can never reclaim them. Teardown also runs only at the
   *start* (line 182), never in the `finally` (line 254, which only closes the
   client). **Confirmed live**: the 8 dashboards created by the cycle-16 run are
   sitting in the shared dev Postgres right now (ids `bc2a3e3f…`, `c2d7156c…`,
   `5392d658…`, `fc0b9326…`, `1e8f1d35…`, `4a6cf101…`, `c1d1bb9f…`, `6ebb7517…`)
   — which the orchestrator's brief asked me to verify were torn down, and they
   were not. Required:
   (a) delete the dashboards the run created (explicit `delete_dashboard` by the
   ids it collected, in the `finally` block) or give `create_dashboard` a `tag`
   parameter so tag teardown actually covers them;
   (b) correct the header comment to match whatever the code does;
   (c) remove the 8 existing leftovers from the shared dev DB — per the
   shared-dev-DB hazard, stray state from one worktree has already broken a
   different ticket's dev-server gate in this batch.

4. **`helio-mcp/src/server.test.ts:1-13` claims to "pin the FULL registered tool
   list"; it does not.** The assertions are `not.toContain` per removed tool plus
   `expect.arrayContaining([...])` plus a duplicate check — none of which is an
   exact set, so an accidentally re-added or renamed tool passes silently. The AC
   says "test asserts the exact tool-name set". Add
   `expect([...names].sort()).toEqual(EXPECTED_TOOL_NAMES.sort())` with the full
   list, or (weaker, and only if the exact list is judged too churn-prone) delete
   the "FULL registered tool list" claim from the comment. Prefer the former —
   the comment-vs-code mismatch is itself lesson #4's shape.

5. **`docs/agent-native.md:238-251` is stale as of cycle 16.** It states the live
   Sleeper composition proof "is tracked as still-open work (tasks.md task 5.1,
   'MCP E2E')" — but 5.1 was closed and the script demonstrably ran twice against
   a live backend. Update this section to describe the run that happened,
   including the script's own honest caveat (four representative *static*
   Sleeper-shaped sources, not a live pull from the Sleeper API).

6. **`helio-mcp/src/types.ts:460-484`** — the `ProposalPanel` doc block still
   describes surfaces this remodel deleted: metric/chart/table/collection/timeline
   panel kinds and their config surfaces, `metricId` as "additive to dataTypeId
   (which remains required)", and text/markdown `config.dataTypeId` as "a real
   binding attempt [that] is validated against the same pipeline-only rule (V41)".
   `schemas/dashboards/dashboard-proposal.schema.json:41,47,104` says the
   opposite — those fields are "Legacy … decoded but never applied", and a
   `config.dataTypeId` on a text/markdown panel is "silently inert, not a binding
   attempt". Bring the comment in line with the schema.

### Non-blocking Suggestions

- The ticket's verbatim helio-mcp jest command should gain
  `"testPathIgnorePatterns":["/node_modules/","/dist/"]`. Without it, any
  worktree that has run `npm run build` reports 18 spurious suite failures on
  compiled `dist/*.test.js`, which is exactly the kind of noise that trains a
  reader to ignore a red gate. Worth correcting in `ticket.md`'s hard-won-lessons
  section so P1.5–P1.7 inherit the fixed command.
- Record the frontend-suite gotcha (G2 above) alongside lesson #1: root
  `jest.config.cjs` excludes `/frontend/`, so `cd frontend && npm test` is the
  only real frontend evidence.
- HEL-865: `tasks.md` 5.2 notes it was not updated. Its description already
  carries an accurate "what remains" note, so no action is strictly needed — but
  a one-line comment confirming `get_workspace_context`'s half is done (with the
  25/43 fixture result) would close the AC cleanly when Linear write access is
  available.
- `WorkspaceContextService.scala` + `WorkspaceContextComputations.scala` are
  427/536 lines, still over the 250-line soft budget, as task 1.7 honestly
  records. Acceptable for this cycle; worth a follow-up rather than more churn
  inside an already-16-cycle ticket.
