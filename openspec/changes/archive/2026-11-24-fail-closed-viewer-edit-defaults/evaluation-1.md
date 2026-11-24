## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `a4b1fcca5928209a5a72e16e2ea502f688fa1359` against the live-resolved base `b2da43a3d02ba1b84eb8296b9bd9ed742623a353`.

### Phase 1: Spec Review — FAIL

All three acceptance criteria are implemented:
- AC1 (fail-closed defaults): 13 defaults flipped (`canEdit`/`canRun`/`isOwner` to `false`, `readOnly` to `true`) and `usePipelineDraftSave`'s `runRole` made required. My own grep agrees with files-modified.md's list. The only remaining `canEdit = true` in `frontend/src` is `features/panels/ui/detailModal/usePanelDetailEditState.ts:20`, which the proposal lists as a non-goal. I checked all 17 production call sites (PipelineSpineLayout, PipelineMobileLayout, MobileStepSheet, MobileRunsTab, PipelineDetailDialogs, PipelineSpine, OutputEditorSheet). Each one passes the role from `page.canEdit` / `!page.canEdit` / `canRunFromUi(page.runRole)` / `page.isOwner` / `readOnly`. None uses a literal `true`, so owners and editors lose no control.
  - `failClosedRoleDefaults.test.tsx` has a test for each component.
  - `failClosedRoleGuard.test.ts` is labelled as a guard and runs its scanner on planted source.
  - `3.4-default-mutations.txt` shows that flipping any one default back turns its own test red (plus the guard).
- AC2 (wider scan): the scan now skips by `:disabled` and includes `summary`. The self-test plants and scans in one evaluate and runs the same `scanInPage` source. Its red run (`3.3-e2e-selftest-red.txt`) and the two scan mutations (`3.4-e2e-scan-mutations.txt`) are in place.
- AC3 (comment): the `viewerCopy.test.ts` header now matches its two tests and the regex `/\b(add|edit|run the)\b/i`.
- b9b45f9e1 `--no-verify`: verified. The commit body says so, and the commit holds only tests and evidence, with no implementation. This fits C12.
- The two new `ALLOWED` entries are pure disclosures, verified in source:
  - "Functions and operators" is a native `<details>` around two read-only reference lists (`stepConfigs/ComputeFunctionReference.tsx:27-34`).
  - "Ask about this Output" is the `<details>` around `AskPanel` (`outputEditor/OutputEditorSheet.tsx:444-447`).
  - Neither summary writes anything.

Issue:
1. **Task 3.5 is marked done but its committed evidence shows red.** The task says "Run the full `hel1794-viewer-read-only.spec.ts` file green". Yet `evidence/3.5-e2e-full-run2.txt` and `3.5-e2e-full-run3.txt` both record `✘ viewer on phone … Error: phone/light: output name value contrast`, and nothing in the evidence or the artifacts explains it. The executor also says "baseline source failed 3 of 8", but no evidence file in the change supports that.

### Phase 2: Code Review — PASS (gate results; the contrast flake is covered under Phase 3)

Gates, run fresh by me in WORKTREE_PATH after `cd frontend && npm ci`:
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `npm --prefix frontend run typecheck`: exit 0
- `tsc --noEmit -p e2e/tsconfig.json`: exit 0
- `npm --prefix frontend run build`: exit 0
- `npm test` (lane DB, 3 workers): exit 0. Root: 76 suites / 683 tests passed. Frontend: 937 suites / 10869 tests passed.

Code review:
- The production diff is 14 one-line default flips plus a required `runRole`, and it is behavior-preserving for every real caller.
- The test-harness edits only add an explicit role. `conditionalFormatsEditorHarness.tsx` now passes `readOnly={false}`.
- After the red commit, `failClosedRoleDefaults.test.tsx` changed only its fixtures: an httpClient mock, TWO_ROOTS so the viewer empty-lane copy is reachable, and a dropped redundant MemoryRouter. No assertion was weakened, and the mutation transcript was taken against the final version.
- No FQNs, dead code or `any`. The guard's `DEFAULT_LIVES_IN` map is explicit, as design D5 requires.

### Phase 3: UI Review — FAIL

I restarted the servers fresh through `start-servers.sh`, with DATABASE_URL=helio_hel1839, DB_USER and an empty ANTHROPIC_API_KEY in the same command. Then I ran Playwright with 2 workers. The page itself changes nothing a user can see: every real caller passes its role, so the HEL-1794 spec's viewer (desktop and phone, light and dark) and editor halves are the relevant end-to-end check.

- Full-file runs at HEAD: 3/3 green, 4/4 tests each.
- `-g "viewer on phone" --repeat-each=2`, run 5 times: 10/10 green.
- The editor half (owner/editor keep every control, typing creates a draft) passes every run.
- The self-test passes every run.

**Contrast flake verdict: pre-existing in HEL-1794's spec and not caused by this change. It is still a real timing defect in a spec this change edits.** How I established this:
- The phone/light `output name` contrast this spec records is not stable at HEAD with identical DOM. Across my runs it read 6.16, 8.01, 8.02, 11.09 and 12.13. The executor saw 4.43 and 4.44.
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1839/evidence/.concertino/scratch/HEL-1839/eval1/contrast-variance-summary.txt`
  - The values come straight from the spec's own `contrast-phone-light.json`.
- Only animation timing explains that spread. `frontend/src/shared/ui/Modal.css:19` gives every `.ui-modal[open]` the entrance animation `ui-modal-in var(--transition-slow)` (0.28s; opacity 0 to 1, `theme.css:149`).
- `viewerFlow` (`e2e/hel1794-viewer-read-only.spec.ts`, the output-sheet block before `contrast["output name"]`) measures right after `expect(dialog).toBeVisible()`. `valueContrast` multiplies every ancestor's computed `opacity` into the text alpha. The ratio therefore depends on how far the dialog's fade-in has run when the probe fires.
- This change does not touch `Modal.css`, `theme.css`, `OutputEditorSheet.css` or `valueContrast`, and the page's DOM is the same for a viewer. The edited scan is a read-only `page.evaluate` that runs before the measurement, as it did before. The two `ALLOWED` entries only filter names. The scan refactor cannot change the dialog's opacity. At most it shifts by milliseconds when the probe lands, so it does not cause the failure.
- I did not reproduce the executor's "baseline 3 of 8" claim. The verdict above rests on the mechanism, not on that number.

The failure was not on the known-flake list (C11). This change edits the spec, and its own task 3.5 relies on the spec being green, so I am not leaving the race there.

### Overall: FAIL

### Change Requests
1. **Remove the contrast sampling race in `e2e/hel1794-viewer-read-only.spec.ts` `viewerFlow`.**
   - The fix: before the `contrast["output name"]` / `contrast["output kind"]` reads, wait for the dialog's entrance animation to finish, e.g. `await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));`.
   - Apply the same wait before the step-field reads on the phone path (`editorRoot` is `dialog.mobile-step-sheet[open]`), since that is the same pattern.
   - Keep real motion; do not lower the 4.5 bar.
   - Proof:
     - Record the `output name` value over 5 or more `-g "viewer on phone"` runs. They should all match the settled value.
     - Mutation: remove the wait and show the spread return (values below the settled value in at least one run).
   - Commit both as `.txt` evidence.
2. **Fix the task 3.5 evidence.**
   - After CR1, re-run the full spec file at least 3 times and commit the runs, replacing or annotating `3.5-e2e-full-run2.txt` / `run3.txt` so that the evidence for task 3.5 agrees with its `[x]`.
   - Either commit evidence for the "baseline 3 of 8" claim or drop it from the hand-off.

### Non-blocking Suggestions
- The new `ALLOWED` comment says "what a panel contains is scanned like any other control". The viewer flow never expands either `<details>`, though, so their contents are hidden and not scanned. Reword the comment, or open each disclosure once in `viewerFlow` and scan.
- `e2e/hel1794-viewer-read-only.spec.ts` was already 420 lines at base and is now 472. That is past CONTRIBUTING's ~400-line threshold, so mention a split in the PR description.
