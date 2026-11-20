## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `7d74d1b3ef2ca25f3ffb123350d93bcbf973636f`. Base resolved live: `87cf01a5f745fdd7315d21530a78a176ec83211a`. Commits: `38395d5e0` (red tests and transcripts), then `7d74d1b3e` (implementation).

### Phase 1: Spec Review — FAIL

Checks that pass:
- **Every AC is covered.**
  - Viewer desktop and phone, light and dark: no Run pipeline / Dry run, and "View only" is shown.
  - Grantees see no unknown-type banner and no step-problem banner.
  - Both e2e specs were committed red before the implementation. `red-run/red-e2e.txt` shows 3 real assertion failures. `red-scala.txt` shows 4 failed tests. `red-jest.txt` shows 8 suites failing.
- **Owner rulings Q1-Q3 and driver constraints are honoured.**
  - D1: the cost roots now use `findByIdInternal`.
  - D2: validity is judged against the owner's schema, with the config-only or neutral message.
  - D3: grantees get a neutral detail per code. `estimatedRows` is the last-run count or absent.
- **Forbidden files are untouched.** The diff does not touch `PipelineService.scala`, `RunConfigGate`, `AutoRunTriggerService` or the `PipelineCostInputGathering` signature. There is no migration. The only backend main change is `PipelineAnalyzeReads.scala`.
- **The red commit's hook bypass is cleared.** The implementation commit passes every pre-commit hook step. I re-ran all of them myself (see Phase 2).
- **Live API check on the lane DB matches the spec.**
  - Owner: `estimatedRows: 3` and real `sourceSchemas`.
  - Editor and viewer: no `estimatedRows`, blank `sourceSchemas`, `autoRunnable` true.
  - Editor `canRun` is true; viewer `canRun` is false.
  - A signed-in stranger gets `404`.

Issues:
1. **The phone pending state does not match design D4, and its test claims more than it checks.**
   - Design D4 ("Layout rule (phone)") says: "While `pending`, the pill row renders at its normal height with no pills."
   - The implementation renders an empty `.mobile-actions__pills` flex div. `MobilePipelineActions.tsx:114` returns `null` children. `PipelineMobile.css:423-426` gives the div no min-height, so it is zero height. The bar's published `--pipeline-mobile-actions-h` then grows when an editor's pills arrive.
   - The jest test `MobilePipelineActions.viewer.test.tsx:36` is titled "while pending no pill shows but the row keeps its height". It only asserts that `.mobile-actions__pills` exists, never its height.
   - The user-visible effect is small, because the bar floats absolutely and only the body's bottom padding changes. But the design and the test name both describe behaviour that does not exist.
2. **`saveAndRun` has no viewer guard, against design D4.**
   - D4 says "`handleRunPipeline`, `handleDryRun`, `saveAndRun`'s run step and `onRunNow` return early when the role is `viewer`."
   - `usePipelineDraftSave.ts:201` (`saveAndRun = () => post(undefined)`) and `confirmCascade` (203-213) have no role check.
   - The executor recorded this only in the gitignored scratch file `run-entry-audit.md` ("Deviation from design wording, noted"). design.md still states the guard exists.
   - No viewer UI path reaches it today, because Save & run is hidden on both layouts. So this is an artifact-accuracy defect, not a live hole.
3. **The red transcripts are not where task 1.4 says.**
   - Task 1.4 says the red transcripts were copied to `.concertino/runs/HEL-1661/evidence/`. That directory holds only `premise-validation.md`.
   - The transcripts were committed under `openspec/changes/grantee-pipeline-run-banner/red-run/` instead, which is arguably better.
   - The task text is inaccurate. Minor; fold it into the artifact fix.

### Phase 2: Code Review — PASS

Gates, run fresh by me in `WORKTREE_PATH`:
- **Frontend:**
  - `npm run lint`, `npm run format:check` and `npm run typecheck` all exit 0.
  - `npm test` with 3 workers: 70 root suites / 617 tests and 884 frontend suites / 10,359 tests, all passed.
  - `npm --prefix frontend run build` exits 0.
- **Every other pre-commit hook step exits 0:** `check:repo-integrity`, `e2e-types`, `helio-mcp-types`, `schemas`, `spec-structure`, `openspec`, `scala-quality`, `test-temp-dir-hygiene`, `e2e-evidence-paths`, `e2e-user-cleanup`, `no-credential-leak`, `eslint-ts-rules`, `tokens` and `e2e-shard:selftest`.
- **Backend:** `sbt -J-Xmx3g testFull`, run as 6 shards (`HELIO_TEST_SHARD_INDEX` 0-5 of 6, `nice -n 19`). All shards exit 0. 10,094 tests succeeded and 0 failed. The 5 cancelled tests are the `HELIO_MEASURE=1` report-only cases. `Hel1661GranteeAnalyzeVerdictSpec` ran in shard 4.

Mutations I ran myself, each in a throwaway detached worktree at HEAD, removed afterwards:
- **D1 reverted** (`resolveRoot = findByIdOwned(_, user)`). 3 tests turn red: (a) DEFECT, (c) neutral-detail, and editor trigger agreement.
- **D2 neutral text removed** (non-owner gets the raw owner-view `ownerError`). (d) turns red: `"'and' requires boolean operands, got boolean and float" included substring "float"`. This proves the type-leak guard can fail.
- **D3 `estimatedRows` reverted** (`v.estimatedRows` for everyone). The never-run GUARD test turns red.

The executor's own records match and add more: D2 full revert gives 4 red, D3 detail gives 1 red. The UI gate mutations gave 7 red jest tests (`mut-gate.txt`). I did not re-run a frontend mutation, because a clean jest run needs a `node_modules` tree I am not allowed to symlink or copy.

Code observations (none blocking):
- **The server change is tight.**
  - The second `analyzeNodes` pass runs only for non-owners. It feeds only `validationError` and `toCostVerdictResponse`.
  - `sourceSchemas`, step schemas and `warnings` stay caller-view. The literal PIN test checks this: name `""`, no fields, no root column, `warnings` empty.
  - The neutral map covers every `PipelineCostEstimator` code, with a generic fallback.
  - `nonOwnerValidationError` only sends text a grantee can already derive.
- **The NOBYPASSRLS spec role is named `helio_migration_test`, not `helio_app_test`** (the same shape as `Hel1516GranteeDriftPreviewSpec`, as design D6 asks).
  - It is NOSUPERUSER NOBYPASSRLS and owns the tables.
  - It is subject to RLS because the repo puts `FORCE ROW LEVEL SECURITY` on `data_sources`, `pipelines` and related tables (V35/V36/V98 and others).
  - Acceptable. It does differ from the driver's literal role name; see suggestions.
- **The client role rule (`usePipelineRunRole.ts`) matches D4 rules 1-4.**
  - Handlers return early for a viewer.
  - The toast's Run now is omitted.
  - The Output sheet's `onRunPipeline` is passed only when `canRunFromUi`.
  - The run-history copy has a viewer variant on both the desktop modal and the phone Runs tab.
- **Fixture edits in `usePipelineDetailPage.analyze.test.tsx`, `.keys.test.tsx` and `PipelinesPage.delete.test.tsx` are justified.** These tests ran the pipeline while their analyze fixture defaulted to a non-owner role. Making the caller the owner keeps them testing what they intended.

### Phase 3: UI Review — PASS

Lane servers were started with `start-servers.sh` and `assert-phase.sh servers` passed. I used `DATABASE_URL=helio_hel1661` and an empty `ANTHROPIC_API_KEY`. Seeding: an owner, editor, viewer and stranger registered through the API with plain emails, one static-source pipeline with a compute step on `$amount`, and one Output.

- **Viewer, desktop 1440, light** (`/home/matt/Development/helio/.concertino/runs/HEL-1661/evidence/.concertino/scratch/HEL-1661/eval-viewer-desktop-light.png`):
  - No Run pipeline, Dry run or Save & run.
  - "View only" appears beside the pipeline name with the eye icon, mono text, `--app-text-muted`, 12px, and no pill. It is not aria-hidden.
  - Schedule chip and ⋮ are present. Neither banner appears.
- **Viewer, desktop, dark:** no run buttons, "View only" visible, no banner.
- **Viewer opens the Output sheet, dark** (`.../eval-viewer-desktop-dark-sheet.png`): "hasn't been included in a saved run yet" is present, and the sheet has no Run button.
- **Viewer, phone 390, dark and light** (`.../eval-viewer-phone-dark.png`):
  - No pills, and the action bar is unmounted.
  - "View only" shows in the header.
  - The tab body's `padding-bottom` is 24px, which equals `--space-2 + --space-4`.
  - The Runs tab empty copy reads "No runs yet."
  - No horizontal overflow.
- **Viewer at 1100 and 768** (`.../eval-viewer-768-light.png`): renders without breakage, scrollWidth equals viewport width.
- **Editor, desktop:** Dry run and Run pipeline are present and enabled, with no "View only", no pending slot left behind, and no banner.
- **Owner, deep SPA navigation from `/home` under a MutationObserver:** the first header render already holds Run pipeline, with no pending slot. That one state never changed over 4 s, so the owner never shifts.
- **Viewer layout shift:** the executor measured one shift on resolve. On desktop the chip moved from x=938.8 to 1118. On phone the header grew from 92 to 108, together with the bar unmount, as one event. This is within the "viewer at most one shift" rule.
- **Console:** only the pre-existing 401 on `/api/auth/me` before login and a 404 on `/schedule` (no schedule exists). No errors come from this change.
- **e2e, run by me:**
  - The new specs `hel1661-viewer-run-controls` and `hel1661-grantee-source-banner` pass, 3 of 3.
  - Existing specs that touch run controls, mobile pills or the draft flows, across 16 files, ran 104 tests. 103 passed and 1 failed: `hel1631-draft-mode.spec.ts:346` ("a server-only step updates through the draft-preview transport…"), which saw a stray `GET …/steps/:id/preview`. It is not on the known-flake list.
  - That test then passed 3 of 3 when re-run alone with `--repeat-each=3`. It is owner-only and touches no role code, so I classify it as a load flake, not a regression.
  - Residue: my four users were deleted by exact id with `buildUserDeleteSql`; a count of `hel1661-eval-%` now returns 0. Servers were stopped with `stop-servers.sh`.

### Overall: FAIL

### Change Requests
1. **Fix the phone pending row.** Pick one:
   - Make `.mobile-actions__pills` keep its pill height while `runRole === "pending"`. For example, a `data-run-slot="pending"` modifier with `min-height: var(--control-lg)` in `PipelineMobile.css`, so `--pipeline-mobile-actions-h` is published at the final height from the first paint. Then make `MobilePipelineActions.viewer.test.tsx:36-42` assert that (for example the modifier class or attribute), not just that the element exists.
   - Or amend design.md D4's "Layout rule (phone)" to the real behaviour (an empty zero-height row while pending) and rename that test so it no longer claims "the row keeps its height".
2. **Resolve the `saveAndRun` mismatch.** Either:
   - add `if (runRole === "viewer") return` to `saveAndRun`/`confirmCascade` in `usePipelineDraftSave.ts:201-213`, passing `runRole` in from `usePipelineDetailSaveWiring` and adding a jest case; or
   - amend design.md D4's sentence listing `saveAndRun`'s run step among the early-return handlers, and state why no guard is needed (no viewer UI entry, and the server refuses the run).
3. **Correct task 1.4 in `tasks.md`** to name where the red transcripts actually live (`openspec/changes/grantee-pipeline-run-banner/red-run/`), or also copy them to `.concertino/runs/HEL-1661/evidence/`.

### Non-blocking Suggestions
- **Role name.** In the PR body, say that the NOBYPASSRLS proof uses `helio_migration_test`, the `Hel1516GranteeDriftPreviewSpec` shape, which is subject to RLS through FORCE. The driver brief named `helio_app_test`.
- **Banner e2e coverage.** `hel1661-grantee-source-banner.spec.ts` only demonstrated red on the `UNRECOGNIZED` assertion; `STEP_PROBLEM` was never reached on main. The Scala (a) test covers the step-problem regression server-side. A D2-only revert run through that e2e would show the client assertion can fail.
- **Hard-coded slot widths.** The `.spine-header__run-slot` min-widths (`10.7rem`, `5.4rem`) are measured from current button copy and will drift if it changes. A comment already says so. Consider a jest or e2e check comparing the slot to the real button-pair width.
- **PR body.** Carry the skeptic's notes: `rows-above-threshold` reveals one coarse bit of dataset size to grantees, and the trigger's `Denied.reasons` on the write path still carry raw detail.
