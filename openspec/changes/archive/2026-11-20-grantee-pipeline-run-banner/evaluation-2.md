## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `07918971736e8a896bbbecbb737de816cfd0e83c` (cycle-2 commit `079189717` on top of `7d74d1b3e`). Base resolved live: `87cf01a5f745fdd7315d21530a78a176ec83211a`. Phases 2 and 3 of `evaluation-1.md` still stand for the unchanged code; this report covers the cycle-2 delta and re-runs the gates fresh.

### Phase 1: Spec Review — PASS

Each cycle-1 change request is resolved:

1. **Phone pending row (CR1).** Implemented, not re-worded.
   - `MobilePipelineActions.tsx` marks the pending row `data-run-slot="pending"`.
   - `PipelineMobile.css` gives `.mobile-actions__pills[data-run-slot="pending"]` `min-height: var(--control-lg)`, the same token as `.mobile-pill`'s height.
   - The jest test now asserts both the modifier and the CSS rule.
   - Running app (phone 390, editor, SPA navigation under a MutationObserver): the first paint is `pending`, bar 40px, body `padding-bottom` 64px. When the pills arrive the bar is still 40px and padding still 64px. Nothing moves, so design D4's phone rule now holds.
2. **`saveAndRun` viewer guard (CR2).** Implemented as design D4 says.
   - `usePipelineDraftSave.ts`: `saveAndRun` and `confirmCascade` return early for `runRole === "viewer"`.
   - `usePipelineDetailSaveWiring.ts` passes `runRole` through.
   - New `usePipelineDraftSave.viewer.test.tsx`: an editor's Save & run reaches `saveDraft`. A viewer's Save & run and cascade confirmation call neither `getPipelineWithDefinition` nor `saveDraft`.
3. **Red transcripts (CR3).** `red-e2e.txt`, `red-jest.txt` and `red-scala.txt` are now in `WORKTREE_PATH/.concertino/runs/HEL-1661/evidence/`, as task 1.4 says. They are also committed under `red-run/`, which is what survives worktree cleanup.

Driver constraint "prove on `helio_app_test`" is now met literally.
- The spec uses the `FormSubmitEditorRlsSpec` two-role harness: migrated as `postgres`, app pool `SET ROLE helio_app_test`, privileged pool `SET ROLE helio_privileged`.
- A new `[PIN]` test asserts `current_user = helio_app_test` with `rolbypassrls = false` and `rolsuper = false`.
- `helio_app_test` does not own the tables, so RLS applies whatever the FORCE settings are. This is stronger than cycle 1's table-owner role.

The banner e2e has now failed against a D2-only revert, on the STEP_PROBLEM assertion this time. `scratch/HEL-1661/mut-D2only-banner-e2e.txt` shows `getByText(/A step in this pipeline has a problem/)`, expected 0, received 1. That closes the cycle-1 note that this assertion had never been seen to fail.

Issues: none.

### Phase 2: Code Review — PASS

Gates, run fresh by me in `WORKTREE_PATH`:
- **Frontend:**
  - `npm run lint`, `npm run format:check`, `npm run typecheck` and `npm --prefix frontend run build` all exit 0.
  - `npm test` with 3 workers: 70 root suites / 617 tests and 885 frontend suites / 10,362 tests, all passed. That is cycle 1 plus the new suite and its tests.
- **Hook checks:** `check:scala-quality`, `tokens`, `openspec`, `repo-integrity`, `e2e-types`, `no-credential-leak`, `eslint-ts-rules`, `spec-structure`, `schemas` and `test-temp-dir-hygiene` all exit 0.
- **Backend:**
  - `Hel1661GranteeAnalyzeVerdictSpec` on its own: 8 of 8 passed, including the new `helio_app_test` PIN.
  - `sbt -J-Xmx3g testFull` in 6 shards (`nice -n 19`): all exit 0. 10,095 tests succeeded and 0 failed. The 5 cancelled tests are the `HELIO_MEASURE=1` report-only cases.

Mutation I ran myself on the new harness, in a throwaway detached worktree at HEAD (removed afterwards; `git worktree list` shows nothing left):
- **D2 reverted** (non-owner validity taken from the caller-view `callerViewAnalyzed`): 4 tests turn red. They are (a) DEFECT, (d) neutral-sentence, (c) detail, and editor trigger agreement.
- This matches the executor's `mut-D2-cycle2.txt`.
- The executor's other cycle-2 records also hold on `helio_app_test`: D1 gives 3 red, D3 gives 1 red, rows gives 1 red.

Code observations (none blocking):
- `runRole` is optional in `usePipelineDraftSave`'s `SaveArgs`. The only production caller passes it, so this is a tidy-up at most.
- The CSS-reading jest assertion is a source-text guard, not a rendered-height check. The live MutationObserver measurement above is the real evidence of no shift.

### Phase 3: UI Review — PASS

Servers were started with `start-servers.sh` (lane DB `helio_hel1661`, `ANTHROPIC_API_KEY` empty) and `assert-phase.sh servers` passed.

- **Editor, phone 390, light:** as described under CR1. The pending row holds 40px, then Dry run and Run pipeline fill it. Bar height and body padding stay constant, so there is no shift.
- **Viewer, phone 390, dark:**
  - The action bar is unmounted and the body `padding-bottom` is 24px (= `--space-2 + --space-4`).
  - "View only" is shown, with no Run pipeline, Dry run or Save & run.
  - Neither banner appears.
  - The only "Save" in the DOM is a hidden modal button, not a run entry.
- **e2e, run by me:**
  - `hel1661-viewer-run-controls`, `hel1661-grantee-source-banner`, `hel1582-mobile-pipeline-fit-and-touch`, `hel1582-mobile-pipeline-motion-and-states`, `hel1684-draft-structural-phone-and-kept`, `hel1733-draft-outputs-shapes-phone` and `hel1631-draft-mode`: 58 of 58 passed.
  - `hel1685-draft-polish`, `hel1734-draft-roots`, `hel1733-draft-outputs-shapes-drafts`, `hel1648-pipeline-scoped-source-sample` and `hel1392-remount-staleness`: 32 of 32 passed.
- **Second run's user cleanup (my error, recovered).** I launched the second e2e run without `DATABASE_URL`, so its global teardown pointed psql at the default DB. It matched none of the 34 users and deleted nothing, because the exact id+email guard held. I then deleted those 34 users from `helio_hel1661` with `buildUserDeleteSql`, using that run's registry, and confirmed 0 remain. My own three seeded users were removed the same way; a count of `hel1661-eval%` returns 0. Servers were stopped with `stop-servers.sh`.

### Overall: PASS

### Non-blocking Suggestions
- Make `runRole` required in `usePipelineDraftSave`'s `SaveArgs`. Then a future caller cannot silently skip the viewer guard.
- **PR body:**
  - State that the NOBYPASSRLS proof runs on `helio_app_test` with `rolbypassrls = false`.
  - Keep the cycle-1 items: editors' `autoRunnable`/`canRun` change; the coarse `rows-above-threshold` bit is visible to grantees; the trigger's `Denied.reasons` keep raw detail on the write path; `analyzeConcise` still uses the caller's view.
