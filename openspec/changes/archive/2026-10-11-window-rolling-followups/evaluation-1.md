## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `21cb3088d8e08991fee7fd91e0180deca70c4965` (diff base `6ac99447d07fd5bf5ee065b1141c1a31d0ea08a8`, resolved live by `resolve-review-base.sh`).
Scope: ticket items 2, 3 and 4 only. Item 1 (centred frames) is out of scope by driver decision and stays open on the ticket.
Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1489/evidence/` (the evaluator's own files are prefixed `eval1-`).

### Phase 1: Spec Review — PASS
- AC2a: PASS. `PatchSetWindowRollingRejectionRoutesSpec` sends the full invalid matrix through the real `POST /patch-sets/apply` route for pipelineStep create, pipelineStep update and pipeline create. Each case asserts 422, the exact `edit 0: ` (or `edit 0: Step 'w1': `) prefix, and the exact frame message. It also asserts nothing was stored: the step list is empty, the step list is unchanged, and no pipeline exists with the test's name.
- AC2b: PASS. `PipelineApplyProposalWindowRollingSpec` asserts 422, a `step 1: ` prefix and the frame message, and checks that the pipeline and step counts did not change.
- AC2c: PASS. The matrix in `WindowRollingRejectionCases` covers 7.5, 5000000000, 0, 1001, `weeks`, days with a two-key orderBy, and days with a descending orderBy. Each route has a positive control (200 with no `failure`, or 201), and the control checks the stored effect.
- AC2d: PASS. The executor's transcripts exist for M1 to M4 and R1 to R3. I re-ran two mutations myself (see Phase 2).
- AC3a: PASS. `WindowConfig.tsx:102-105` derives `offsetId`, `frameSizeId` and `outputColumnId` from `useId()`, and `htmlFor` uses the same ids. A grep for the three old literal ids across `frontend/` finds nothing.
- AC3b: PASS. I checked out the base `WindowConfig.tsx`, ran `WindowConfig.ids.test.tsx` against it, and it went red: the uniqueness assertion got 3 unique ids where 8 were expected (`eval1-item3-prefix-red.txt`). After restoring the fixed file it passes (`eval1-item3-green.txt`).
- AC3c: PASS. Verified in the running app (see Phase 3).
- AC4: PASS. `git diff -w` on `backend/src/main` is empty. The diff is whitespace only, at `WindowStep.scala:218-223`.
- Tasks: all ticked, and they match the diff. No scope creep: the change touches only the window step, its editor, new test files and openspec artifacts. No production code under patch-sets was edited (C4).
- CONSTRAINTS: C1 PASS (both specs boot through `VerifiedEmbeddedPostgres.start`; `npm run check:scala-quality` is clean, with no inline FQNs). C2 PASS. C3 PASS (`[hel1468-guard]` appears in every sbt run; jobs were niced; MemAvailable was about 48 GB). C4 PASS. C5 PASS: the commit message carries only `Co-Authored-By`, with no claude.ai session link and no `Claude-Session` trailer. It went through the normal hook.

Issues: none.

### Phase 2: Code Review — PASS
Gates, run fresh by the evaluator in `WORKTREE_PATH`:
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm --prefix frontend run build`: exit 0 (`eval1-frontend-gates.txt`).
- `npm test`: 525 suites and 5667 tests passed (`eval1-item3-green.txt`, which is the full run).
- `cd backend && sbt testFull` (`-J-Xmx3g`, `nice -n 19`): `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, with 6886 tests succeeded, 0 failed and 4 canceled (`eval1-testFull.txt`).

Independent mutation re-runs. Each was applied by hand with a different edit from the executor's, run against both new specs, and reverted. `git status` was clean afterwards.
- Call-site mutation: `PatchSetPipelineStepResolvers.scala:50` became `(None: Option[String]) match`. All 7 pipelineStep-update cases went red, `failed=7` (`eval1-mut-M1-update-callsite.diff` and `-red.txt`).
- Rule mutation: the `WindowStep.scala:173` guard became `case JsNumber(n) if false`. The 7.5 and 5000000000 cases went red on all four surfaces, `failed=8` (`eval1-mut-R1-rawFrameSize.diff` and `-red.txt`).

Both results match the executor's transcripts.

Code quality: the new spec files are within the 250-line soft budget (221, 45 and 53 lines). The test code has no dead code, no comment-restates-code violations, no `any`, and no hard-coded ids left. The shared `WindowRollingRejectionCases` keeps the matrix DRY across the two specs.

Issues: none blocking.

### Phase 3: UI Review — PASS
Servers were started with `start-servers.sh` on 6921/9828, and `assert-phase servers` returned PASS. I stopped them afterwards by recorded PID, and both ports are free.

Fixtures were created in the dev DB under `matt@helio.dev`, with the ids recorded up front in `eval1-devdb-fixture-ids.txt`: one static source, one pipeline and two window steps. I deleted them afterwards by exact id (DELETE pipeline 204, DELETE source 204; neither appears in the list endpoints).

- Two rolling cards open (`eval1-a11y-two-rolling-cards.yml`): the ids are `_r_b_-frame-size`/`_r_b_-output-column` and `_r_h_-frame-size`/`_r_h_-output-column`. The document has zero duplicate ids, each `label[for]` resolves to exactly one element, and the accessibility tree shows `spinbutton "Frame size"` and `textbox "Output column"` once per card.
- Two lag cards open (`eval1-a11y-two-lag-cards.yml`): the ids are `_r_b_-offset`/`_r_b_-output-column` and `_r_g_-offset`/`_r_g_-output-column`. There are no duplicate ids, each label resolves inside its own card, and the tree shows `spinbutton "Offset"` and `textbox "Output column"` per card.
- The layout renders correctly at 768 (`eval1-two-lag-cards-768.png`). The change only touches ids, so it cannot affect layout.
- Console: two pre-existing kinds of error, neither from this change. One is the expected `GET /schedule` 404 for a pipeline with no schedule. The others are 403s from my own CSRF-less login probe.
- Raw Playwright MCP files from this review were moved from the main checkout's `.playwright-mcp/` to `evidence/eval1-playwright-mcp/`. Other sessions' files were left in place.

Issues: none.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `PatchSetWindowRollingRejectionRoutesSpec`'s update positive control asserts only that no `failure` came back. It could also assert that the stored step config now has `frameSize: 5`.
- `WindowConfig.tsx` keeps both a `<label htmlFor>` and an `aria-label` with the same text on each input. That is redundant but harmless. It predates this change.
- Pre-existing, outside scope: on the pipeline detail page, the `label[for="schedule-kind"]` points at no element. It could be a spinoff.
- Process note: logging the shared Playwright browser into the dev account replaced another session's cookie (the browser had been logged in as a HEL-1308 skeptic test user). This is the known shared-browser hazard.
