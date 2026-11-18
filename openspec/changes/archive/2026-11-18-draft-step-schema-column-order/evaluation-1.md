## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `015c13b1864f3cb644d76ddb90afd0dfb2bf9c8f` against base `e83f216b0a6b84da100e465517d210c13da52ab5` (resolved live with resolve-review-base.sh).
Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1732/evidence/.concertino/scratch/HEL-1732/eval/`. The claims below rest on file contents (header lists, request logs, test output). None rests on mtimes.

Verdict: ESCALATION
Question: The change sends a debounced `POST /api/pipelines/analyze-proposal` after every settled client-evaluable draft edit. That breaks the standing `pipeline-draft-mode-ui` requirement "Client-evaluable edits recompute locally with no request". Should that requirement be amended to allow this one read-only projection request, or should the column order be redesigned so that no request is sent?
Options: amend the standing requirement (MODIFIED delta plus updated e2e no-request guards), redesign to send no request on client-evaluable edits (e.g. project only while the Output sheet is open; otherwise use the saved analyze schema plus client-known op semantics), free-form
Context: `openspec/specs/pipeline-draft-mode-ui/spec.md:24` says "Editing a client-evaluable step SHALL send no network request of any kind (no step PATCH, no analyze, no preview)". Its scenario at :28 says "zero requests are sent during the burst". This property was established by HEL-1631 and is measured by HEL-1691's `@prod-build` budget. The design (D2) and proposal mention "one extra analyze-proposal request per settled draft edit". The change's spec delta only ADDS requirements: it never MODIFIES or acknowledges this one, and no planning artifact (design, proposal, files-modified, skeptic rounds 1-3) cites it. Three existing e2e guards of this requirement now fail or will fail (see Phase 1). Making them pass means relaxing a standing spec that an owner ruling backs. Neither the executor nor the evaluator can make that call alone, so it is raised instead of being handed over as a test edit (a fixture-change symptom).

### Phase 1: Spec Review — FAIL
Issues:
1. **Regression of a standing spec requirement (blocking, see ESCALATION).** `pipeline-draft-mode-ui` "Client-evaluable edits recompute locally with no request" (spec.md:23-28) is violated. Fresh e2e evidence on the running app (lane DB `helio_hel1732`, dev project, 2 workers):
   - `e2e/hel1631-draft-mode.spec.ts:560` "375px: the draft status fills the action bar's slot..." FAILS. `expect(recording.stop()).toEqual([])` received `["POST /api/pipelines/analyze-proposal"]` (log `e2e-draft.log`; 78 other draft specs passed in hel1631/1733/1734/1684).
   - `e2e/hel1632-live-output.spec.ts:216` "one baseline history read at load, then a burst of edits sends nothing..." FAILS. It received six `POST /api/pipelines/analyze-proposal`, one per edit, because each edit there settles longer than the 250 ms debounce (log `e2e-draft2.log`; 38 others passed in hel1632/1683/1685/1705/1579).
   - `e2e/hel1631-draft-mode.spec.ts:183`, the `@prod-build` burst test ("sends no request of any kind"). Not run (it needs the prod-build server). By inspection it records every `/api` request for 1500 ms after ten edits and expects `[]`. The 250 ms debounced POST lands inside that window, so it will fail in CI's `e2e-prod-build` job.
   The executor did not run e2e. The jest-level counterpart (`PipelineDetailPage.draftMode.test.tsx` "a burst of edits sends no request of any kind") was edited to expect exactly one POST, while its title still says "no request of any kind".
2. Ticket ACs, apart from the issue above:
   - AC1 (columns follow the step's schema): met on the running app (Phase 3).
   - AC2 (truncated kept on fallback): met. I independently confirmed RED-first: with base `draftStepView.ts` restored in a throwaway worktree, the new test fails (`HEL-1732: the last-good-frame fallback keeps the frame's truncated flag`), and it is green on HEAD.
   - AC3 (desktop and phone, light and dark, running app): met by my own probe.
3. The tasks are marked done, but 6.2's network bullet "none without a draft / one per settled edit" was not reconciled with the standing requirement.
4. No scope creep. No backend, schema or wire change. Optional extras 5.1-5.4 were not done and are listed for the PR, which is acceptable.
5. CONSTRAINTS in workflow-state.md: `[]`. Nothing to check.

### Phase 2: Code Review — FAIL
Gates (fresh, in WORKTREE_PATH):
- `npm run lint`: clean (no output past the header).
- `npm run format:check`: "All matched files use Prettier code style!"
- `npm run typecheck`: clean.
- `npm test` (3 workers): root 66 suites / 579 tests, frontend 824 suites / 9944 tests, all passed, EXIT=0 (`npm-test.log`).
- `npm --prefix frontend run build`: EXIT=0.

Issues:
1. **The page wiring has no test that can fail (blocking).** In a throwaway worktree I mutated `usePipelineDraftPresentation.ts:104` so `projectedSchema` is always `undefined`, which disconnects the feature from the page. The full `src/features/pipelines` jest run stayed green: **2747/2747 passed**. The component tests in `StepPreviewTable.columnOrder.test.tsx` inject `projectedSchema` by hand, and `useDraftStepProjection.test.tsx` tests the hook alone. Nothing proves that the page's "Rows after step N" grid uses the projection, and design D4(b)'s "a descendant step follows its projected order" has no test at all. The `PipelineDetailPage.draftMode` burst test still passes under this mutation, because the hook still sends its request. So a regression that unplugs the feature would ship green.
2. Test (c) in `StepPreviewTable.columnOrder.test.tsx:96-101` ("a draft-added step ... per the projection") hands the component a projection that already lists `margin`. It does not exercise how a draft-added step's schema is actually derived (`schemaAtNode` / `buildAnalyzeProposalRequest`). On the running app a draft-inserted rename does order correctly (Phase 3), so this is a test-realism point rather than a behavior defect.
3. `PipelineDetailPage.draftMode.test.tsx:230` title "a burst of edits sends no request of any kind" now contradicts its own assertion of one POST (readability; it depends on the escalation outcome).
4. The `StepPreviewTable` mutation (row-key order instead of `orderColumns`) turns all six column-order tests red. I confirmed this independently, so the component tests are real guards.
5. Code quality: small, typed, and reuses `orderColumns`, `buildAnalyzeProposalRequest` and `schemaAtNode`. The cache is page-scoped via `useState`, not a module singleton, and evicts rejections. No dead code. One documented `eslint-disable` for exhaustive-deps (`useDraftStepProjection.ts:69`), keyed by the JSON request; acceptable. `StepPreviewTable.tsx` is 310 lines, over the ~250 soft budget, which is informational only.

The executor's edit to `usePipelineDetailPage.keys.test.tsx` adds `projectDraft` to an exhaustive page-state key list. It follows legitimately from the design and is not a fixture-change symptom. The edit to the `draftMode` burst test is not clearly legitimate. The test's original intent (HEL-1631, c1add2394) was the standing spec's "no request of any kind" invariant. Changing it to "exactly one analyze-proposal POST" relaxes that invariant without a spec change, which is the escalated question.

### Phase 3: UI Review — PASS
Servers: `start-servers.sh` on 7164/10071 with `DATABASE_URL` pointing at the lane-private `helio_hel1732`; `assert-phase.sh servers`: PASS. Probe: `eval-probe.mjs` (scripted Playwright, own browser).
- Setup: an 8-column source (`id, region, status, amount, total, created, owner, note`) with steps filter → rename (owner→who) → compute margin → convertformat. The convertformat step (step 4) is server-resolved: NDJSON `step` lines were recorded for it.
- Scenarios (1440x900 and 375x812, light and dark):
  - a draft filter edit;
  - a draft rename `region→zone` typed into saved step 2;
  - a draft-inserted rename step after step 1 (`status→phase`).
- Headers, identical in all four viewport/theme combinations (`eval-probe-all.json`):
  - step 1: `id,region,status,amount,total,created,owner,note`
  - step 2 (draft rename in shown step): `id,zone,status,amount,total,created,who,note`
  - step 3 (descendant): `...,who,note,margin`
  - step 4 (server-resolved): `id,zone,status,amount,total,created,who,note,margin`
  - draft-inserted step: `id,region,phase,amount,total,created,owner,note`
  - the step below it: `id,zone,phase,...`
  The `/sample` row key order is hash order (`total,amount,id,note,status,region,owner,created`, executor probe log), so the scramble premise holds.
- Phone step switching was done through the "Previewed step" combobox and verified by the different header sets per step. This closes the executor's self-reported phone gap.
- Network:
  - no draft: 0 analyze-proposal;
  - a burst of 4 keystrokes on the filter: 1;
  - the rename typed slowly (4 keys): +1;
  - switching steps: +0;
  - opening the Output editor sheet on the same draft: +0 (cache hit);
  - insert plus typing the rename: +2.
  Request bodies were all distinct (4 total, 4 distinct per run), so no duplicate request for the same draft key. Because the draft cannot be edited while the Output sheet covers the page, "sheet open while editing" was covered only by the cache-hit check above and the unit test.
- Console: the only error is a pre-existing `404 GET /api/pipelines/:id/schedule` (no schedule exists), unrelated to this change.
- Screenshots: `eval-desktop-light-step2.png`, `eval-phone-dark-step4.png`, `eval-phone-light-step5-added.png`, `eval-desktop-dark-step5-added.png`.

### Overall: ESCALATION (with FAIL-level change requests pending the ruling)

### Change Requests
1. (Depends on the ruling.) If the owner amends the requirement: add a MODIFIED delta for `pipeline-draft-mode-ui` "Client-evaluable edits recompute locally with no request" that permits exactly the debounced read-only `analyze-proposal` projection. Then update the three e2e guards to allow only that request, so every other request still fails: `e2e/hel1631-draft-mode.spec.ts:201` and `:575`, and `e2e/hel1632-live-output.spec.ts:247`. Run the `@prod-build` burst test via `npm run e2e:prod-build` and record the result; the HEL-1691 latency budget must still hold. Retitle `PipelineDetailPage.draftMode.test.tsx:230` to match. If the owner keeps the requirement: redesign so that a client-evaluable edit sends no request, and revert the draftMode test edit.
2. Add a page-level test (e.g. in `PipelineDetailPage.draftMode.test.tsx` or a sibling) that mocks `analyzeProposal` at the service boundary with a realistic response. It should make a draft edit, advance past `PROJECTION_DEBOUNCE_MS`, and assert that the rendered "Rows after step N" headers follow the projection for the shown step AND a descendant step. Record the mutation `usePipelineDraftPresentation.ts:104` → `projectedSchema: undefined` turning it red.
3. Either drive test (c) (`StepPreviewTable.columnOrder.test.tsx:96`) through the real derivation (`buildAnalyzeProposalRequest` + `schemaAtNode` with a draft-added step id) or rename it so it does not claim to cover draft-added-step derivation.

### Non-blocking Suggestions
- `useDraftStepProjection`'s `settled` map is never pruned of removed step ids. It is harmless (bounded by page life) but could be trimmed to `draftSteps` ids.
- In the desktop screenshot the live Output column's table lists draft columns in code-unit order (`amount, created, id, margin, note`). That is outside this ticket's grid, but worth a follow-up check against HEL-1705's live-output rule.
