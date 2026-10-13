## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `86ebb71d8e6b6dd61a820be96811c50fdcb2fa83`. The review base was resolved live with
`resolve-review-base.sh` (main/origin): `f63ab8365d2b0e6cac36154a83437b6d26b3a209`, which equals
SPLIT_BASE. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/pipeline-editor-steps-error-split/HEL-1501`.

### What I verified (with evidence)

**Hook split (commit b5ea46824), checked independently. I did not use hook-split-verify.py.**
- I extracted the body of each of the six new hooks at b5ea46824: from the line after the
  signature to the line before `return {`. I then searched for each body as an exact contiguous
  line block in the SPLIT_BASE `usePipelineDetailPage.ts`. My own script is in the session
  scratchpad. Every body matched exactly once:
  - `usePipelineOwnPipeline`: 43 lines at base L49
  - `usePipelineAnalyzeState`: 27 lines at base L93
  - `usePipelineEditorState`: 98 lines at base L123
  - `usePipelineStepsFingerprint`: 24 lines at base L287
  - `usePipelineClearRunOnLeave`: 10 lines at base L346
  - `usePipelineDirtyAndOwner`: 30 lines at base L371
  
  Each block appears in the same order in the host as in the base.
- I read every hunk of `git show b5ea46824 -- usePipelineDetailPage.ts` to check what the host
  gained. The only additions are:
  - import edits
  - the six call sites, each destructuring what the hook returns
  - the one deps edit the commit message lists: `onStepsSettled` changes from `[]` to
    `[setStepsFetch]`. That setter is a stable useState setter coming back from the hook, so its
    identity does not change.
  
  The evaluator was worried that a check accepting "any block containing a hook name" could let
  logic slip into the host. Nothing like that was added. `persistedSteps` (not a hook) stays
  between the K2 and K3 calls, where it was. The return object is unchanged.
- The host is 427 lines at HEAD and the largest new hook file is 147 lines. A3 covers the host
  being over ~400 lines.

**Slice split (commit 8235a09be), checked independently.**
- `diff` of each new module against the base `pipelinesSlice.ts` gives these lines that do not
  exist in the base:
  - `pipelinesThunks` and `pipelineScheduleThunks`: only the `createAsyncThunk` import
  - `pipelinesState`: two type imports and `export` added to the `PipelinesState` / `initialState`
    declarations
- The slice's base exports (grep `^export`) are 14 thunks, `FetchRunHistoryArg`, the 3 actions,
  `PipelinesState` and `pipelinesReducer`. That matches the literal list in
  `pipelinesSlice.exports.test.ts` plus the two type pins. The slice is 335 lines.
- No changed file belongs to parked PRs #998/#994. I grepped the diff for laneLayout,
  SecondaryInputPicker, patchSets and assistant: 0 hits.

**Steps error against the spec delta (commit e037e4734 and later).**
- The page's three-way branch is skeleton → `PageStatus status="failed" size="section"` with
  `onRetry`, inside the `.pipeline-detail-page__river` / `__river-inner` frame → river.
  `stepCount` is null while loading or failed.
- `retryStepsLoad` in `usePipelinePageLoad.ts`:
  1. Sets the phase to pending.
  2. Dispatches `fetchPipelineSteps(id)` only, with no pipeline refetch.
  3. Gates on `mountedRef`.
  4. Routes the settle through `onStepsSettled`.
  5. Re-dispatches analyze only if `analyzeStatusRef.current === "failed"`.
  
  This matches D8 and the spec's re-analyze clause.
- Live in the running app (servers on 6933/9840; throwaway `@example.test` user; finance persona
  template, 8 steps). I forced the steps GET to fail by patching XHR `open`, then navigated in-app:
  - The Steps tab showed "Couldn't load this pipeline's steps." with Retry. There was no
    "No steps yet" and no Add-step control. The footer had no step count.
  - Retry while still failing re-issued the request (counter 1 → 2) and showed the error again.
  - Retry after I un-forced the failure rendered all 8 cards, the footer read "8 steps", and the
    OUTPUT schema chips came back.
  - The only console errors were my forced 404s and the expected no-schedule 404.

**Visual judgement (DESIGN.md §6/§7, light and dark).**
- Dark: `/home/matt/Development/helio/.concertino/runs/HEL-1501/evidence/.playwright-mcp/skeptic-hel1501-steps-error-dark.png`
- Light: `/home/matt/Development/helio/.concertino/runs/HEL-1501/evidence/.playwright-mcp/skeptic-hel1501-steps-error-light.png`
- Recovered (light): `/home/matt/Development/helio/.concertino/runs/HEL-1501/evidence/.playwright-mcp/skeptic-hel1501-recovered-light.png`
- It uses the shared `PageStatus` section variant: `ui-page-status--section-error`, role=alert,
  with a link-style Retry. That is the same variant SettingsPage and RunHistoryModal use for
  section errors. No new styles or hardcoded values are added; the change adds no CSS.
- Measured with getBoundingClientRect: the error's left edge (x=360, width 800) lines up with the
  river column the step cards use (x=360, width 800). Light/dark parity holds, and intent-error
  red reads correctly on both canvases.

**Tests and gates, run fresh by me (foreground, nice -n 19, at most 3 workers):**
- `npm run typecheck`: exit 0.
- `eslint --max-warnings 0 src/features/pipelines`: exit 0.
- `prettier --check src/features/pipelines`: clean.
- Jest `src/features/pipelines/`: 135 suites / 1862 tests passed.
- Jest shard over every other area that imports pipelinesSlice (app, store, services, test,
  shared/chrome, audit, commandPalette, dashboards, onboarding, panels, proposals, settings,
  toasts): 305 suites / 3620 tests passed.
- I did not run the whole suite in one go. The two shards above are exactly what ran.
- `PipelineDetailPage.switch.test.tsx` run alone: 17/17 passed, 0 "not wrapped in act" warnings
  (AC5; the proof file records 13 on the base). `stepsError` 7/7 and `skeletonDom` 2/2 passed.

**Switch-test claims.**
- The renames, the scoped `getPipelineByIdIdsSince(callsAtSwitch)` not containing "A", and
  `toHaveBeenLastCalledWith("B")` are all present in the diff.
- The red-run transcript shows removing each `mountedRef` gate fails 2 tests. That fits the code:
  without the gate the continuation calls `getPipelineById("A")` after the snapshot. I did not
  re-run these mutations myself, because this role must not edit code.

**Characterization ordering.**
- `skeletonDom.test.tsx`, `pipelinesSlice.exports.test.ts` and the identity test were last
  touched in commit e6ab69ca3 (commit 1) and pass unchanged at HEAD (`git log` on those paths).
- AC3: one `settled()` helper. Each of the three files keeps a one-line alias, and no assertion
  changed (checked by reading the diff).

**Judgement on the assumed product calls (going to OWNER REVIEW):**
- **A1 (copy):** sound. It mirrors the page-level "Couldn't load this pipeline". Raw Axios text
  is deliberately left out, and a test pins that.
- **A2 (Run/Dry run stay enabled):** sound. A run executes the server's persisted definition and
  does not depend on the client's view of the steps.
- **A3 (hook at 427 lines plus a Follow-up):** sound and honest. The design decided this fallback
  in advance. The remaining work needs a reshaped return surface, which is not a verbatim move.
  The Follow-up is not filed yet; that is an orchestrator delivery step.

### Verdict: CONFIRM

### Non-blocking notes
- **Focus drops to `<body>` after Retry.** I reproduced this live: `document.activeElement` is
  BODY. The Retry button unmounts when the phase flips to pending. The page-level
  "Couldn't load" Retry and the other PageStatus section uses behave the same way, and DESIGN.md
  §8 has no focus-restore rule for this. It would still be a small a11y improvement to move focus
  to the Steps tab or the river. Worth a Follow-up, not a block.
- **The rest of the page does not know the steps are unknown.** This existed before this change:
  base had the same state on failure, and HEL-1483 has it while loading.
  - The Outputs tab shows "off an unknown step" on every card and keeps "+ New output" live.
    Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1501/evidence/.playwright-mcp/skeptic-hel1501-outputs-tab-while-failed-light.png`
  - The footer says "no output yet".
  - The header's add/remove source controls stay live.
  
  None of these got worse, and the ticket scopes the change to the Steps tab. A follow-up could
  make the Outputs tab and footer steps-aware.
- After a successful header remove-root while the steps are failed, `syncStepsFromServer`
  refreshes the steps, but `stepsFetch` stays "failed", so the error remains until Retry. This is
  harmless because Retry recovers, but it is an edge worth knowing about.
- **Real network requests in tests.** `PipelineDetailPage.stepsError.test.tsx` logs 14 jsdom XHR
  `AggregateError`s, from unmocked services such as sources that make real requests. Its siblings
  do the same: `PipelineDetailPage.test.tsx` 130, `draftCreate` 12, `creatingStep` 4. So it
  follows an existing pattern rather than adding a new hazard, but these tests do make real
  requests.
- My screenshot from the first capture landed at the main-checkout root because the Playwright
  MCP resolves relative paths against the session root. I moved it into the worktree's ignored
  `.playwright-mcp/` before persisting it, and nothing is left at the repo root.
- Throwaway user `8ca1a350-9997-4081-8f73-79024824a58c` /
  `skeptic-hel1501-1791909631-7845@example.test` was deleted by exact (id, email) through
  `buildUserDeleteSql`. Afterwards the user count is 0 and `/api/auth/me` returns 401. Servers
  were stopped with `stop-servers.sh` (`STOPPED ports=6933,9840`).
- No gate defect: none of the reports I drilled into rests on mtime ordering. My evidence is
  content- and measurement-based.
