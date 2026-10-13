## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `e7913b5a5c5d4b8df64bf819dd1c967e40ad9021`. Base resolved live with `resolve-review-base.sh`: `f63ab8365d2b0e6cac36154a83437b6d26b3a209` (equal to SPLIT_BASE). 8 commits.

### Phase 1: Spec Review — PASS

- AC1: met in behaviour (the steps error, Retry, skeleton while in flight, recovery to persisted steps, footer count null). Verified live and by tests. The layout defect is under Phase 3.
- AC2: met. `PipelineRiverSkeleton` is shared. The `skeletonDom` characterization test from commit 1 is byte-identical at HEAD, and I re-ran it green on SPLIT_BASE. The live "Loading steps" skeleton during Retry carries `role="status"`.
- AC3: met. There is one `settled()` helper. Per-file counts were re-run base vs HEAD: 132/132, 4/4, 12/12. The test diffs are import, alias and doc-comment changes only.
- AC4: met, with the D3 fallback applied honestly. `pipelinesSlice.ts` is 335 lines and its export surface is pinned. `usePipelineDetailPage.ts` went from 592 to 421 lines after commit 3 and is 427 at HEAD. Six clusters moved: K1-K4 plus planner-note (c)'s fingerprint and clear-run blocks. What is left in the host is call-site destructuring plus the verbatim return object, which D3 says stays in the host. No further verbatim, order-preserving cluster remains to move, so stopping at 427 is legitimate. **The Follow-up issue for the remainder is not filed yet.** The orchestrator owns that, together with the OWNER REVIEW entries for A1, A2 and A3 (AC6).
- AC5: met. The tests are renamed, the scoped no-refetch-of-A assertions are added, `toHaveBeenLastCalledWith("B")` is added, and the `act()` warnings go from 13 to 0. I re-counted both runs myself, and no console silencing was added (grep of `+.*console|spyOn` in the diff finds nothing).
- Parked-PR files (C1): none touched. `git diff --name-only` against laneLayout, SecondaryInputPicker, patchSets and assistant finds nothing.
- C2: honored. Commit file lists show the behaviour change only in e037e4734, and there is no new `eslint-disable`.
- Spec delta: `openspec validate --strict` reports it valid, and `check:openspec` is clean.

### Phase 2: Code Review — FAIL (handoff and evidence only; code quality passes)

Gates, run fresh by me in WORKTREE_PATH with `nice -n 19` and 3 workers:
- `npm run lint` passed (exit 0). `npm run format:check` passed. `npm run typecheck` passed. `npm --prefix frontend run build` passed (the chunk-size warning is pre-existing).
- `npm test` was split into foreground shards:
  - root `jest`: 49 suites / 458 tests passed.
  - frontend `src/features/pipelines`: 135 / 1861 passed.
  - frontend `src/features/panels`: 191 / 2578 passed.
  - frontend everything else: 261 / 2576 passed.
  - Together the shards cover 587 suites, which equals `jest --listTests` (587).

Proof re-verification:
- **Slice byte-move.** `slice-split-verify.py` is green at commit 8235a09be and at HEAD. My own red runs:
  - changing one string in `pipelineScheduleThunks.ts` gives FAIL on L367-413 (exit 1);
  - changing one byte in the reducer region of `pipelinesSlice.ts` gives FAIL on L415-707 (exit 1).
- **Hook byte-move.** `hook-split-verify.py` is green at commit b5ea46824. My red run, changing the deps of the moved `usePipelineClearRunOnLeave` effect, gives FAIL (exit 1). At HEAD it fails exactly on the commit-7 edits, as expected.
- **Hook sequence.** I re-ran `hook-sequence.cjs` with sub-hooks inlined. Base vs commit 3 differs only in the enumerated `onStepsSettled` deps (`[]` to `[setStepsFetch]`). Base vs HEAD additionally shows the commit-7 `useCallback(() => setStepsFetch("pending"), [])` and the `usePipelinePageLoad` args. The base listing is byte-identical to the recorded `hook-sequence.base.txt`.
- **stepsError red.** I copied the HEAD `PipelineDetailPage.stepsError.test.tsx` onto a d4fe67b69 (pre-commit-7) checkout: 6 failed of 6. Note that the "does not re-request analyze" test is red pre-change only because its precondition fails. Its real guard is mutation M2 below.
- **My own mutations at HEAD:**
  - M2, always re-analyze on Retry: red.
  - M4, drop the `stepsFailed` branch: 7 red.
  - M5, Retry not flipping to pending: red.
  - M3, drop the `mountedRef` gate in `retryStepsLoad`: **survives** (see suggestions).

Code-quality checklist: DRY, readability, modularity, types (no `any` or escapes), error handling, no dead code or TODOs, no over-engineering, and behaviour preservation all pass.

Issues (mechanical, handoff and evidence):
1. **Proof cited in tasks.md is not in the branch.** `tasks.md` 6.3 cites `proof/switch-test-base.log` and `proof/switch-test-after.log`, and 7.1 cites `proof/steps-error-red.log` and `proof/steps-error-green.log`. All four match `.gitignore:27 *.log` (confirmed with `git check-ignore -v`), so they are not committed. They will dangle once the worktree is cleaned up.
2. **`files-modified.md` does not list complete repo-relative paths** (driver hard rule). Its last line is a bare directory, `openspec/changes/pipeline-steps-error-and-splits/proof/`, with no file paths. It also omits files this branch adds:
   - `openspec/changes/pipeline-steps-error-and-splits/ticket.md`
   - `openspec/changes/pipeline-steps-error-and-splits/proposal.md`
   - `openspec/changes/pipeline-steps-error-and-splits/design.md`
   - `openspec/changes/pipeline-steps-error-and-splits/skeptic-design-1.md`
   - `openspec/changes/pipeline-steps-error-and-splits/skeptic-design-2.md`
   - `openspec/changes/pipeline-steps-error-and-splits/.openspec.yaml`
   - `openspec/changes/pipeline-steps-error-and-splits/files-modified.md`

### Phase 3: UI Review — FAIL

Servers were started with `start-servers.sh` and `assert-phase.sh servers` passed. I used a throwaway user `hel1501-eval-1791908178@example.test`, registered with curl, separate from the browser session, and seeded the "ops" persona template. Afterwards I deleted it by exact (id, email) with `buildUserDeleteSql`; the remaining user and pipeline rows are 0 and 0. The steps fetch was failed by an in-page XHR `open` rewrite of the GET `/api/pipelines/:id/steps` call followed by in-app navigation. No data was mutated.

Observed:
- **Happy path:** 8 steps and the output schema render, with no JS errors.
- **Failed fetch:** the tabpanel contains only `<p class="ui-page-status ui-page-status--section-error" role="alert">Couldn't load this pipeline's steps.<button>Retry</button></p>`. There is no "+ Add transformation step" button and no footer step count. Run and Dry run stay enabled, as assumed call A2 intends.
- **Retry fails again:** the error is shown again; the steps fetch count went 1 to 2.
- **Retry succeeds:** I delayed the response 2.5 s and activated Retry from the keyboard with Enter on the focused button. During the delay the `role=status` "Loading steps" skeleton showed and the error was gone. Afterwards the cards rendered, the footer read "8 steps" and the output schema was restored.
- **Console:** only network 404s, namely the forced failure URL and the pre-existing "no schedule" `/schedule` 404. There were no exceptions.
- **Themes:** light and dark both colour the error with `--app-error`.

Issue:
3. **The steps error renders bare in the tabpanel, with no inset.** Every other Steps-tab state renders inside `.pipeline-detail-page__river`, which has `padding: var(--space-4) var(--space-5)` and a centred 800px `river-inner` column. This includes the "Loading steps" skeleton the user sees one click earlier. `.pipeline-detail-page__tabpanel` has `padding: 0` and `.ui-page-status--section-error` has `margin: 0`. Measured:
   - the error's left edge minus the tabpanel's left edge is 0px at 1280, 1100, 768 and 360;
   - at 768 and 360 the text starts at viewport x=0, touching the screen edge;
   - at 1280 it sits flush against the sidebar border and the tablist rule (y=139 = tabpanel top), out of line with the tabs (first tab x=260).
   
   This is objective breakage at breakpoints, not a taste call. Evidence (persisted):
   - `/home/matt/Development/helio/.concertino/runs/HEL-1501/evidence/.playwright-mcp/hel1501-eval-steps-error-dark-1280.png` (sha256 prefix 750b99b5cf94caaf)
   - `/home/matt/Development/helio/.concertino/runs/HEL-1501/evidence/.playwright-mcp/hel1501-eval-steps-error-light-1280.png` (9e203465bec05d91)
   - `/home/matt/Development/helio/.concertino/runs/HEL-1501/evidence/.playwright-mcp/hel1501-eval-steps-error-light-768.png` (26b347fcb8109647)
   - `/home/matt/Development/helio/.concertino/runs/HEL-1501/evidence/.playwright-mcp/hel1501-eval-steps-error-light-360.png` (1e3e35118a21081f)
   
   The positional claims rest on the `getBoundingClientRect` numbers above, not on file mtimes.

### Overall: FAIL

### Change Requests
1. `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` L292-301 (the `stepsFailed` branch): render the `PageStatus` inside the same container the sibling states use, so it gets the river's `--space-4`/`--space-5` inset and the centred 800px column at every breakpoint. For example, `<div className="pipeline-detail-page__river"><div className="pipeline-detail-page__river-inner"><PageStatus status="failed" size="section" … /></div></div>`, or an equivalent existing class. Do not add new CSS values outside the token scale. Re-check at 1440, 1100, 768 and 360 that the error's left edge is inset from the tabpanel and is not at viewport x=0. Optionally add a DOM assertion that the error is a descendant of `.pipeline-detail-page__river`.
2. `proof/` evidence: make the four cited logs part of the branch. Either rename them to `.txt` (`switch-test-base.txt`, `switch-test-after.txt`, `steps-error-red.txt`, `steps-error-green.txt`) and update the references in `tasks.md` 6.3 and 7.1, or `git add -f` them. As things stand, `tasks.md` cites files `.gitignore:27` keeps out of the commit.
3. `openspec/changes/pipeline-steps-error-and-splits/files-modified.md`:
   - replace the `.../proof/` directory line with one complete repo-relative path per committed proof file;
   - add the seven missing change-dir files listed under Phase 2 issue 2;
   - add `evaluation-1.md` (this report).

### Non-blocking Suggestions
- `proof/hook-split-verify.py`: the call-site insert check passes any inserted block that merely contains an extracted hook's name. My mutation added `if (id === "x") navigate("/");` on the line after `usePipelineClearRunOnLeave({ dispatch, id });` and the script still exited 0. I diffed commit 3's actual host additions by hand and confirmed they are pure call sites, so the split is sound. The script should still match each insert exactly against the expected call-site text.
- `usePipelinePageLoad.ts` `retryStepsLoad`: the `if (!mountedRef.current) return;` gate (planner note b) has no test. Removing it leaves all 23 stepsError and switch tests green. Consider a test that unmounts or navigates mid-Retry and asserts no `analyzePipeline` dispatch afterwards.
- After Retry, whether it fails again or succeeds, focus falls to `<body>`, because the Retry button unmounts while the request is pending. A keyboard user loses their place.
- While the steps are unknown, the footer still says "OUTPUT: no output yet" (steps is `[]`), which is the same kind of unverified claim as "0 steps". Consider treating it like `stepCount` (skeptic's call).
- `PipelineDetailPage.stepsError.test.tsx` adds another copy of the `makeStore`/`renderPage` boilerplate. A candidate for the shared test-utils module in a later ticket.
