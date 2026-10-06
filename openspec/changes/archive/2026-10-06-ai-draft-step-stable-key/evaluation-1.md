## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `2a86a6cbb8c85ecf1b31f59b667f02814cd5faa2`. Base, resolved live: `90f8a949c4ad25cf7789d90de22d20aa78e850a8`.

### Phase 1: Spec Review — FAIL

Most of the review is clear:
- **Deterministic probe.** The create POST is held on a deferred promise, which matches the premise correction (the draft path has no steps GET). PASS.
- **Stable key and safety explanation.** design.md D2 gives the reasoning, audit.md records the audit, and the AC is met. PASS.
- **RTL test red without the fix.** Independently re-verified: see Phase 2. PASS.
- **No change to HEL-1294 behaviour.** `PipelineDetailPage.creatingStep.test.tsx` is unchanged (`git diff --quiet base HEAD` succeeds) and passes against HEAD. With the production code reverted it also passes, so HEL-1294's paths do not depend on this change. PASS.
- **Tasks.** All tasks are marked [x] and match the diff. PASS.
- **Constraints C1–C3.**
  - C1: the non-AI branch of `handleAddLaneStep` uses the plain `makeStep` result (`baseStep`).
  - C2: audit.md covers `laneDropdownForStepId`, `duplicatingStepIds` and `draftCreateErrors`.
  - C3: probe-evidence.md records 6 red results, and I reproduced exactly those 6 (below). PASS.
- **Scope.** No scope creep. API, schemas and the wire format are unchanged; `renderKey` never reaches a payload (checked against the create and PATCH calls in live traffic). PASS.

**Issue (regression from this change).** The new render identity is dropped by two step reconcilers that rebuild a step from a server response without carrying `renderKey` forward:
- `usePipelineDetailPage.ts:1373`, `handleToggleStepEnabled`: `prev.map((s) => (s.id === stepId ? pipelineStepToStep(persisted) : s))`
- `usePipelineDetailPage.ts:1291`, `handleReorderSteps`: `persisted ? pipelineStepToStep(persisted) : s`

When either drops the key, the step's React key changes from its temp id to its real id, so the card remounts and collapses.

Probe-confirmed for the enable toggle:
- **RTL probe (throwaway worktree at HEAD).** Create a trunk draft, resolve the create, then click "Disable step" on the open card. The result is `aria-expanded="false"` (red).
- **Control on the same code.** An ordinary persisted step, opened and then disabled, stays `aria-expanded="true"` (green). On main, an open card never collapses on an enable toggle, so this is new behaviour introduced by the change.
- **Root cause confirmed.** Patching line 1373 to `{ ...pipelineStepToStep(persisted), renderKey: s.renderKey }` turns the probe green.
- **Live confirmation (headless Chromium on 6753/9660).** A draft-created lane step was still expanded after its create (`true`). After clicking "Disable step" it showed `aria-expanded: false`.

This contradicts the change's own intent (proposal: "keeps a stable client-side render identity across the temp-id → server-id swap"). The open draft now survives its create but collapses on the next enable toggle, a collapse the step never had before.

Reorder (line 1291) has the same code pattern. My reorder probe was confounded: the step I moved was the trunk head, and that collapses on base too, a pre-existing behaviour unrelated to this change. So the reorder case is code-read only, not probe-confirmed. It should be fixed with the same one-line carry for consistency.

### Phase 2: Code Review — FAIL

**Gates, run by me in `WORKTREE_PATH` at HEAD 2a86a6cbb unless noted:**
- `npm run lint`: exit 0
- `npm run format:check`: "All matched files use Prettier code style!"
- `tsc --noEmit -p frontend/tsconfig.json`: exit 0
- root `npx jest --maxWorkers=2`: 38 suites / 371 tests passed
- frontend `npx jest --maxWorkers=2`: 436 suites / 4535 tests passed, exit 0
- `npm --prefix frontend run build`: exit 0 (run in a throwaway detached worktree at the same SHA)
- No backend files changed, so `sbt testFull` was not applicable.

**Red-without-fix, independently re-verified.** I used a throwaway detached worktree at 2a86a6cbb, since removed, and reverted only the 5 production files to base:
- `PipelineDetailPage.draftCreate.test.tsx`: 6 failed, and they are exactly the 6 named in probe-evidence.md. The "no flush PATCH when nothing was edited" guard passes, as stated.
- `PipelineDetailPage.creatingStep.test.tsx`: passed.
- `PipelineDetailPage.test.tsx`: 1 failed, "completing a draft's config fires exactly one create request".

**Mutations: each mechanism is pinned by its own test.** Each mutation was applied alone to HEAD, and each failure is listed by test name:

| Mutation | Failing test(s) |
|---|---|
| B: drop the `renderKey` carry in `syncStepsFromServer` | 1 red: "a later full resync keeps the created draft's card open" |
| C: drop the D2b provisional position | 1 red: "keeps a lane-add draft on a childless anchor…" |
| D: lane keys back to `childLane.id` | 1 red: "keeps a lane-add draft on a childless anchor…" |
| E: disable the D3 flush | 2 red: "saves an edit made while the create was in flight…" and "shows an inline error when saving the in-flight edit is rejected" |
| F: drop `renderKey` in the swap | 6 red |

**Judgement on the `PipelineDetailPage.test.tsx` edit (HEL-1109 test).** Justified and required. The original test re-expanded the card with `getByRole("button", { name: /Generate text/i, expanded: false })`, a workaround that encoded the very collapse this ticket fixes. Run unmodified against the fix, the original fails with "Unable to find an accessible element with the role button and name /Generate text/i", because the card is now expanded. The edited test still asserts the HEL-1109 contract: a post-create edit PATCHes `ai-1` and `createPipelineStepMock` is called exactly once. The removed line was only the workaround. Accepted.

Other checks:
- **D3 flush.** Implemented as designed. It looks up `stepsRef.current` by the temp id, compares by reference, issues one `updatePipelineStep` outside the `setSteps` updater, and on rejection sets `draftCreateErrors[persisted.id]`. Live: the in-flight edit was PATCHed to the persisted id (`bb305700-…`, body `instruction: "Summarize briefly"`). A post-swap edit PATCHed the same id. The DB row's config afterwards was `instruction: "Summarize later"`.
- **Type safety, security and error handling.** OK. No `any`, and the rejected flush is surfaced inline.

Issues:
1. The regression described in Phase 1: `usePipelineDetailPage.ts:1373` and `:1291` drop `renderKey`.
2. `frontend/src/features/pipelines/state/stepTree.ts:239-247`: `laneRenderKey` and its doc comment were inserted between `childLanesOf`'s existing JSDoc ("Every lane rooted directly off `stepId`…", lines 239-240) and `childLanesOf` itself. Two JSDoc blocks are now stacked above `laneRenderKey`, and `childLanesOf` has lost its doc. This breaks CONTRIBUTING.md's Comments rule, since a comment now sits on the wrong symbol.

### Phase 3: UI Review — PASS (objective checks)

Servers were started with `start-servers.sh … 6753 9660 HEL-1321`, and `assert-phase.sh servers` printed PASS. The probe used a standalone headless Chromium context (Playwright 1.55.1), with login, then `about:blank` isolation, then navigation. Seeding happened before login and no seeding happened while `/` was live.
- **Happy path.** A lane-add AI draft on the childless anchor (the only step) was held in flight for 2.5s by route interception.
  - It stayed `aria-expanded=true` during the create and after it resolved.
  - The card is the same DOM node: a marker attribute set before the create was still present afterwards, so it did not remount.
  - The in-flight edit is kept ("Summarize briefly") and flushed to the persisted id.
- **Breakpoints 1100 / 768 / 375.** Horizontal overflow was 0px at each width, and the card stayed expanded.
- **Console and network errors.** Only `401 GET /api/auth/me` (before login) and `404 GET /api/pipelines/<id>/schedule` (the pipeline has no schedule; this is the existing expected 404). Neither comes from this change.
- **Accessible names and keyboard.** Unchanged; the toggle and controls keep their names.
- The enable-toggle collapse found live is reported under Phase 1 and Phase 2. Visual judgement is left to the skeptic.

**Shared dev DB rows created by this evaluation**, all under `matt@helio.dev` (user `9532cfcf-9882-45ba-8247-23706bc00113`). None were deleted.
- pipeline `c286faa5-8ecb-4b36-8526-d01d1dad3dd4` ("HEL-1321 eval c1 draft-card probe")
- root `68200f3b-b1e3-49e3-aa7b-357b82dd83f6`, on existing source `fa2079b0-a598-4ccf-976c-87915359cd96`
- steps:
  - `b3422055-ab94-409d-b51d-2a916b1b4aa3` (rename)
  - `bb305700-8106-44f2-9597-acbba5e22a5a` (generatetext)
  - `2f1a0a52-3c00-40b0-80e2-baf4b00f62ad` (generatetext, disabled by the toggle probe)

**Evidence.** The RTL probe source is pasted below, so it needs no external artifact. The live probe results above are DOM and network readings: aria attributes, request bodies, and a DB row read back by API. They are self-authenticating, so no screenshot is load-bearing.

### Overall: FAIL

### Change Requests
1. `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts`: carry `renderKey` through both server-reconcile sites, the same way `syncStepsFromServer` already does:
   - Line 1373 (`handleToggleStepEnabled`): use `s.id === stepId ? { ...pipelineStepToStep(persisted), renderKey: s.renderKey } : s`.
   - Line 1291 (`handleReorderSteps`): use `persisted ? { ...pipelineStepToStep(persisted), renderKey: s.renderKey } : s`.

   Add an RTL test to `PipelineDetailPage.draftCreate.test.tsx` and show it red before the fix: create the trunk draft, resolve it, click "Disable step" (mock `updatePipelineStepEnabled` to resolve with `enabled: false`), wait for "Enable step", then assert the Generate-text toggle is still `aria-expanded="true"`. Optionally grep for any other `pipelineStepToStep(` reconcile that replaces an existing step in place, and treat it the same way.
2. `frontend/src/features/pipelines/state/stepTree.ts:239-247`: move `laneRenderKey` and its JSDoc above the `/** Every lane rooted directly off stepId … */` comment, or below `childLanesOf`, so that comment sits directly on `childLanesOf` again.

### Non-blocking Suggestions
- `PipelineDetailPage.draftCreate.test.tsx:232`: the doc comment reads "Opens the Generate-text draft it and completes its config". Fix the typo, or drop the comment, since the helper name `completeDraft` already carries the intent (CONTRIBUTING.md, Tests).
- `usePipelineDetailPage.ts` is now 1594 lines (+50). CONTRIBUTING.md asks for a split to be proposed in the PR description when editing a file over about 400 lines. Mention it in the PR body.

### Appendix: enable-toggle probe (RTL; added to a copy of the new test file, which also mocks `updatePipelineStepEnabled`)

```tsx
it("EVAL PROBE: toggling enabled on a created draft keeps its card open", async () => {
  const create = deferredCreate();
  renderPage();
  await addTrunkDraft();
  await completeDraft();
  await create.resolve(aiPersisted("ai-1", 0));
  await waitFor(() => expect(screen.queryByText(/draft.*not yet saved/i)).not.toBeInTheDocument());
  expect(generateToggle()).toHaveAttribute("aria-expanded", "true");
  jest.mocked(updatePipelineStepEnabled).mockResolvedValue({ ...aiPersisted("ai-1", 0), enabled: false } as never);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Disable step" })); });
  await waitFor(() => expect(updatePipelineStepEnabled).toHaveBeenCalled());
  await screen.findByRole("button", { name: "Enable step" });
  expect(generateToggle()).toHaveAttribute("aria-expanded", "true"); // HEAD: Received aria-expanded="false"
});
```

The control (an ordinary persisted "Rename column" step, opened and then disabled) stays `true` on the same code.
