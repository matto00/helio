## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `2b448ad0e74daa979a2dd1e2bbcb254704a18005`. The review base was resolved live as `0a52831600a33690b3f45dbee4fa78a4a8d92838`
(resolve-review-base.sh). origin/main has since moved to fd99c3dd, but `git merge-tree` against it is clean and nothing
under `frontend/src/features/pipelines` changed upstream.

Evidence directory (main checkout; cleanup.sh never touches it, so the paths below are durable):
`/home/matt/Development/helio/.concertino/runs/HEL-1430/evidence/` (all files prefixed `eval-c1-`).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1: PASS. `OutputEditorSheet.tsx` is 374 lines. The other new files are 24–185 lines. All per-kind seeds come from `openingParams`
  (`useOutputKindState.ts:76`), and no second `read*Config` seeding remains in the sheet. Table `columnOrder` still
  reads `readTableConfig(config).columnOrder` for the capability-dependent hook, which design Decision 1 sanctions.
- AC2: PASS. `kindLock.test.tsx` has no diff against base. `configPatch.test.tsx` differs only by db2975e5's comment (4+/2−).
  No other existing test changed.
- AC3: PASS. I verified this independently, both ways:
  (a) At 3c655b0b (base plus the test only), all outputEditor suites are green: 13 suites, 218 tests, 18 snapshots, in `--ci` so nothing was written.
  `git diff 3c655b0b HEAD` on the test and the `.snap` is empty.
  (b) The running editor is identical between base and branch. See Phase 3.
- AC4: PASS. I re-ran it myself: the 6f2351e8^ sheet with the db2975e5 test file gives 7 pass and 15 fail. Run alone
  (`-t "keeps an aggregated"`), the guard PASSES there. So the ticket's premise ("it fails there") is false, the
  executor's finding is correct, and the reworded comment matches what I observed.
- AC5: PASS. The swap test is red on base. Only the key was missing: it got `Expected "Pie"`, `Received "Bar"`. It is green once
  the 78f24ccb `PipelineDetailPage.tsx` is applied. The key is
  `outputSheet.output?.id ?? \`create:${createTargetStepId ?? ""}\``.
- CONSTRAINT C1: honored. I applied each mutation myself inside `openingParams` after extraction:
  - metric format default `"number"`→`"integer"`: 2 tests fail across openingState and configPatch.
  - chart `fieldMapping` → `{annotation}` only: the openingState "touched chart fieldMapping" test goes red, along with 3 configPatch tests.
- Tasks: 1.x and 2.x match the diff. Task 3.3 is unchecked because it is the evaluator's (this report).
- Scope: no creep. HEL-1432 (`htmlFor`/375px) is untouched.

Executor-claim checks:
- The claim "switching the create-time step now remounts the sheet" is only true for the PARENT's `createTargetStepId`.
  The in-sheet Step picker calls the local `setNodeStepId` (`OutputEditorSheet.tsx`, Select `onChange`) and never changes the key.
  The parent changes `createTargetStepId` only through `usePipelineDetailPage.ts:685` (`handleOpenCreate`), and that is not
  reachable through the UI while the modal `<dialog>` is open, because the page behind it is inert. The PR call-out must say this
  precisely (see suggestions).

### Phase 2: Code Review — PASS
Gates, which I ran myself in WORKTREE_PATH under `nice -n 19` with jest `--maxWorkers=3`:
- `npm run lint`: exit 0. `npm run format:check`: clean. `npm run typecheck`: exit 0.
  `npm --prefix frontend run build`: exit 0.
- Root jest: 43 suites, 418 tests pass. Frontend jest: 499 suites, 5216 tests, 19 snapshots, all pass.

Byte-move: I re-derived it independently with `git diff --color-moved=plain --color-moved-ws=allow-indentation-change`.
Every non-moved line falls into one of these groups:
- props interfaces and destructures
- `kindState.params(kind)` replacing the param literals. `canAddAsTailWithAggregate`/`buildAggregateTailConfigs` take
  `Pick<>`s, so passing the superset is type-safe and equivalent.
- the header comment and the reseed comment
- prettier re-wraps of the banner `<p>` and the Placements `<span>`, with identical text
- `compareBlocker`: `chartCompareBlocker(buildConfig())` became `chartCompareBlocker(buildOutputConfig(kindState.params(kind)))`.
  This is the same value, because `buildConfig()` is exactly that expression.
No DOM, class, label, id or request-body line changed. Phase 3's DOM identity confirms this.

The `react-hooks/set-state-in-effect` disables (`useOutputSavedStatus.ts:25`, `:45`) are justified and do not mask a
NEW smell:
- Removing them makes lint fail with 2 errors (eslint `--stdin` probe).
- The base component, even with its `exhaustive-deps` suppressions removed, does not trigger this rule. The pattern
  pre-exists and only became visible once it was extracted.
- The effect bodies are byte-identical, and a verbatim-move ticket must not restructure them.
- There is repo precedent for the disable (`DesktopPanelGrid.tsx:155`).
The executor's stated mechanism ("component too large to analyse") is unverified, but the disables do not depend on it.

Other mechanical checks:
- CONTRIBUTING: every new file is under the ~250 soft budget, and the sheet is under 400. No inline FQNs. No `any`. No TODO/FIXME.
- DESIGN [mechanical]: no CSS or inline-style changes. JSX was moved verbatim.
- Tests are meaningful: the characterization test is exhaustive per control, is shown red twice, and the swap test is red-first.

### Phase 3: UI Review — PASS
Setup:
- Branch: start-servers.sh on 6862/9769.
- Base: a throwaway worktree detached at 0a528316, frontend started by start-servers.sh on 6863 with the backend start blanked,
  so it shares backend 9769.
- That throwaway's `vite.config.ts` proxy was patched to rewrite `Origin` to 6862 so base preview POSTs pass CORS. This is a harness-only
  edit to the scratch copy. It was never in WORKTREE_PATH, and the worktree has been removed.
- Data: one throwaway user owning a founder-template pipeline plus 7 Outputs (all six kinds; two charts).

Results:
- **Edit mode, all six kinds (7 Outputs), light and dark.** The normalized dialog `outerHTML` (useId ids, echarts instance
  attributes and inline styles normalized) and a per-element computed-style signature (color, bg, font-size, padding,
  margin, display, border-color) are IDENTICAL between base and branch in both themes, for all 7.
  Files: `eval-c1-edit-{base,branch}-{light,dark}.json`.
- **Create mode, all six kinds (kind chosen after open), light and dark.** Identical in both themes. The only DOM delta is
  echarts' global `size-sensor-id` counter (2 vs 6) in the dark Chart case, which is not product state.
  Files: `eval-c1-create-{base,branch}-{light,dark}.json`.
- **Pixel check:**
  - `eval-c1-{base,branch}-edit-markdown-light.png`: zero differing pixels inside the dialog box.
  - `eval-c1-{base,branch}-create-markdown-dark.png`: 5 pixels differ, at the dialog's bottom edge. Outside the dialog the only
    difference is the background "Last run: N minutes" text.
- **A→B `?outputId=` deep-link swap (branch)** (`eval-c1-swap-branch.json`):
  - It shows B's own state: name, Pie, and Fixed-text annotation.
  - Focus moves to the new modal title (`H2.ui-modal__title`), which is the same as a fresh open.
  - 0 of 133 sampled frames had no open dialog.
  - The new `<dialog>` replays the `ui-modal-in` entrance animation: opacity is 0 for about 3 frames, then fades in over 280ms.
    This is the expected cost of the design's remount (Decision 5), and the replay is a judgment call for the skeptic, not a
    mechanical failure.
  - The base swap reference could not be captured in the browser (see the hazard note below). The base defect itself is
    proven red by the jest swap test.
- **Console:** one `GET /schedule` 404 (no schedule set) and ECharts "zero DOM size" warnings. Both appear equally on base,
  so they predate this change and are not regressions.
- **Breakpoints (1440/1100/768/narrow):** I did not resize-sweep separately. The DOM is identical, there are zero CSS changes
  in the diff, and the computed styles are identical, so layout at every breakpoint is identical by construction.
- **Accessibility:** unchanged. Labels and `htmlFor` are HEL-1432's.

Hazard note: partway through, another lane (port 6880) drove the shared Playwright browser and replaced the
`localhost` session cookie, because cookies are not port-scoped. My earlier login on 6862 may likewise have replaced
that lane's session. I stopped browser work at that point.

Data cleanup: every id is recorded in `eval-c1-created-ids.txt`.
- The 7 Outputs, the dashboard, the pipeline and the source were deleted by exact id through the API.
- One `pipeline_run_rate_window` row and the user row were deleted by exact id through psql.
- Afterwards the user count for that id is 0, and the API lists are empty.

The base frontend was stopped by exact PID, and the throwaway worktree was removed (`git worktree list` shows no straggler).

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- PR body: state that the create-mode key remounts only when the PAGE's create target changes, never on the in-sheet Step
  picker, and that this is not reachable while the modal is open. Also note that an A→B deep-link swap now replays the
  modal's 280ms entrance animation. Fix design.md Decision 5's "create-step switch" wording to match.
- PR body: record that the ticket item-2 premise was false. The guard passes on 6f2351e8^ (7/22 pass there).
- `openspec/changes/split-output-editor-sheet/.openspec.yaml` is untracked. Every archived change tracks one, so commit it
  with the change (or at archive).
- Tick tasks.md 3.3 and cite this report's evidence files.
