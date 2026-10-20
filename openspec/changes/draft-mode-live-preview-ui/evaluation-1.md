## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `d0315b833058d227014f04fd4ff3cf27e18f400e`. The base was resolved live as `538a867d718204775f7c0844450f683889e145e3` (origin/main). There is one commit, 95 files.

### Fresh gate runs (evaluator's own)

All gates were run in WORKTREE_PATH under `nice -n 19`. Jest used `HELIO_JEST_MAX_WORKERS=2`.

- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm run typecheck`: exit 0.
- `npm --prefix frontend run build`: exit 0.
- `npm test`: exit 0. Root suite: 61 suites, 524 tests. Frontend suite: 745 suites, 9261 tests.
- e2e: the new spec and the 4 touched specs ran under the e2e.lock flock with `--trace retain-on-failure` (`hel1631-draft-mode`, `hel1579`, `hel1582`, `hel1668`, `hel958`). Result: 62 passed, exit 0.
  - Burst per-edit latency was 6.3 to 14.7 ms.
  - The server-only step sent 6 draft-preview requests in 4288 ms, against a bound of 10.
  - Every test's worst 60 s /api window was at most 37, with zero 429s.
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1631/evidence/.concertino/scratch/HEL-1631/eval-e2e-touched.txt` and `.../eval-jest.txt`.
- I did not re-run the full e2e suite. The executor's 642/1 claim is unverified by me. It is a Delivery-phase gate.

### Phase 1: Spec Review — PASS

Issues: none blocking.

- AC1, zero requests and < 50 ms: met. The e2e asserts an all-/api log (any method) is empty over 10 edits plus 1.5 s. I measured live that a client-evaluable edit sent no PATCH and no preview. The one request I saw was the expected draft-preview for the downstream convertformat step.
- AC2, server-only transport: met. Draft-preview is paced and never hits `/run`.
- AC3, exact Discard: met. The e2e checks the definition and fingerprint are deep-equal and that no requests are sent.
- AC4, Save & run with one journal row: met. The e2e counts `patch_set_applications` rows.
- AC5, sample label and age: met, see Phase 3, task 3.10.
- AC6, under the /api limit: met, as measured above.
- Owner ruling `block-during-draft-recommended`: honored on both layouts (Phase 3, item 8).
- Constraints: C1, C2, C3 and C5 are honored. C3: the abort probe's pipeline `b5f6163a-…` and source `68078d8b-…` no longer exist in the dev DB. I queried both exact ids and got 0 rows. The probe registered through `registerAndLogin`, so the HEL-1301 global teardown deleted its user by exact id, and the rows went with it. This is not a FAIL item. C4 was verified by me below; its colour aspect is CR 1. C6 is missing its red-first evidence (CR 3).
- Orchestrator item 7, the `useStepSelection` change: it belongs in this ticket. Discard after a draft delete makes the deleted step reappear. The effect then re-ran on every URL change and put that step back over the user's click. That is a defect draft mode introduces. The change is small and has its own test, so it is not scope creep.

### Phase 2: Code Review — FAIL

Issues:

1. **DESIGN.md §11 [mechanical] rule broken: changed-row flash colour.** §11 says: "those rows flash an `--app-accent` wash at 30% that fades to transparent over `--motion-duration-highlight` on `--motion-ease-out` ... Colour comes from the accent token via `color-mix`" (tagged **[mechanical]**).
   - The code uses `color-mix(in srgb, var(--app-text) 14%, transparent)` at `frontend/src/features/pipelines/ui/spine/StepPreviewTable.css:165`, `:179` and `:185`.
   - Measured live, the flashing cell background is `oklab(0.95 … / 0.14)`, a neutral wash.
   - The CSS comment (`:159-161`) explains this choice by C4's "accent only on Save & run, selected step, focus". But §0's accent list includes "active indicators", and §11 names this element explicitly. design.md D8 does not record this deviation, and neither does its "reversible calls" list.
   - DESIGN.md's preamble says "Never silently diverge."
2. **Changed-row flash has no automated test (orchestrator item 5, confirmed).**
   - No Jest or e2e test references `step-preview__cell--changed`, `FLASH_ROW_CAP` or the flash state.
   - The untested logic is at `StepPreviewTable.tsx:131-160`: rows compared with the previous frame of the same step, the first frame compared with `baseRows`, no flash on a step switch, the 200-row cap, and the motion-Off static class.
   - None of it is pinned by a test.
3. **The draft leave guard (design D13, task 3.9) has no automated test.**
   - No Jest test references `useDraftLeaveGuard` or "Discard your draft".
   - The untested paths are the `beforeunload` registration, link-click interception (`useDraftLeaveGuard.ts:20-31`), Keep editing / Discard and navigate, and the modifier-key and `target` exclusions.
   - I verified the dialog live (`eval-1280-leave-guard.png`), but a regression would not be caught.
4. **Orchestrator item 4, the deleted `castSaveError` and `enumSaveError` tests: no FAIL.**
   - `StepCardFocused.draftEdits.test.tsx` covers the cast legacy-target edit and the three enum controls (fillnull, window, pivot).
   - For each, it checks the value is kept and reported, nothing is marked invalid, and nothing is sent.
   - The server's verdict now arrives on save. `PipelineDetailPage.draftMode.test.tsx:617` checks that a 400 names the step.
   - What is lost is the per-control `aria-describedby` link for a server 422. That is inherent to the draft model and acceptable.
5. **Orchestrator item 6, hel968: no FAIL.**
   - `e2e/hel968-multi-root-editor-flow.spec.ts:117-121` still waits for PATCH or PUT on `/pipeline-steps/`.
   - The spec is quarantined in `playwright.config.ts:116` (`testIgnore`, HEL-991), so it never runs and is not a gate. It will fail if un-quarantined. See the non-blocking note.
6. Everything else checked out:
   - Type safety: the one `eslint-disable` (`useDraftPreviewTransport.ts`, exhaustive-deps) is justified inline.
   - There is no `any`, ts-ignore, TODO or FIXME.
   - CSS uses tokens and motion tokens; no literal durations.
   - Tests for the pure modules (`pipelineDraft`, `draftEvaluation`, `draftStepView`, `draftPreviewRequest`) are meaningful.

### Phase 3: UI Review — PASS (observable checks)

I tested against the running app on 7063/9970 (servers already healthy, `PASS servers`) with a real draft open. The draft showed the chip, Discard / Save & run, "14 → 11" counts, and the live, stale and error statuses.

- **Widths and themes.** I checked 1280, 900, 375 and 430, each in dark and light.
  - Accent audit: an in-page computed-style walk over `.pipeline-detail-page`, allowing only the primary button, the selected row and focus. A positive control (an injected accent element) was flagged, so the audit works.
  - Result: 0 accent leaks in every combination. The only hit was the pre-existing `spine-strip__denial` warning tint, which uses the warning token, not the accent.
  - The primary was Save & run at every width.
  - At 900, Discard and Save & run stay on one row and are not clipped. The chip shrinks to a dot and keeps its accessible name.
- **Statuses.**
  - `live` caption with a success dot.
  - `stale` with "an earlier step has an error" and the last good rows, dimmed.
  - Error glyph and label on the erroring step.
  - Server-step count arrives through the draft-preview transport.
- **Motion.**
  - Full: animation `step-preview-flash`, 1.2 s, on exactly the 3 new rows.
  - Subtle: fades.
  - Off: animation `none`, with a static tint that holds.
- **Item 8, structural block on both layouts.**
  - Desktop: e2e plus Jest.
  - Phone, checked live at 375: "+ Add step" and "+ Output" are disabled with title "Save or discard your draft first". The header menu items "Add source" and "Add Outputs from a shape" are disabled with the same reason. Duplicate in the shared editor is disabled.
  - Enforced on both layouts.
- **Task 3.10, live-checked.** I used a fresh REST source (jsonplaceholder) on desktop at 1280 and on phone at 375. Both show "sample · 200 rows · fetched just now" and the "Refresh sample of …" button. The AC holds.
- **Leave guard.** An in-app link with a draft opens "Discard your draft?". "Keep editing" keeps the draft.
- **Console.** No errors during any flow, apart from the pre-existing 404 on `GET /api/pipelines/:id/schedule` (no schedule), which is unrelated.
- **Evidence.** All screenshots are persisted under `/home/matt/Development/helio/.concertino/runs/HEL-1631/evidence/.concertino/scratch/HEL-1631/`:
  - `eval-1280-dark-draft.png`, `eval-1280-dark-draft-step4.png`, `eval-1280-light-draft.png`, `eval-1280-light-draft-stale.png`
  - `eval-900-dark-draft.png`, `eval-900-light-draft.png`
  - `eval-375-dark-draft.png`, `eval-375-light-draft.png`, `eval-430-light-draft-preview.png`
  - `eval-1280-rest-sample-label.png`, `eval-375-rest-sample-label.png`
  - `eval-1280-leave-guard.png`
- **Throwaway data.** Everything I created was deleted by exact id, each DELETE returned 204, and a DB count confirmed 0 rows. The list is in `.concertino/scratch/HEL-1631/eval-created-ids.txt`: pipelines `b9a9937a…`, `8f069d29…`, `6be030b1…`; sources `926a17c8…`, `ed7cc123…`; connector `cea4e35c…`.

### Overall: FAIL

### Change Requests

1. **Flash colour (DESIGN.md §11, [mechanical]).** In `frontend/src/features/pipelines/ui/spine/StepPreviewTable.css:165`, change the keyframe `from` colour to `color-mix(in srgb, var(--app-accent) 30%, transparent)`. Use the same accent wash for the static Off / reduced-motion marker at `:179` and `:185`. Update the comment at `:159-161`.
   - If the orchestrator reads C4 as overriding §11 for this element, raise that conflict with the owner and record the ruling in design.md D8. Do not keep the silent divergence.
2. **Add Jest coverage for the changed-row flash** (`StepPreviewTable.tsx:131-160`). One focused test file should cover:
   - (a) A draft edit that adds rows marks exactly those rows' cells `step-preview__cell--changed`.
   - (b) The first draft frame is compared with `draft.baseRows`.
   - (c) Selecting another step never flashes (the remount is keyed by step).
   - (d) More than `FLASH_ROW_CAP` (200) new rows flashes nothing.
   - (e) Removing the class logic turns the test red. State the mutation in the PR.
3. **C6 red-first evidence for the zero-request e2e.**
   - Show that `e2e/hel1631-draft-mode.spec.ts` "a burst of client-evaluable edits sends no request of any kind…" fails at its `requests … toEqual([])` assertion (line ~197). Do it either against the pre-change editor (base `538a867d7` frontend, where the 400 ms PATCH fires) or under a mutation that restores a PATCH or preview fetch on edit.
   - Save the failing output to `.concertino/scratch/HEL-1631/` and cite it in the PR.
   - No such red run exists in scratch or in the change dir today.
4. **Add Jest coverage for `hooks/useDraftLeaveGuard.ts`.**
   - With `hasDraft`, a same-origin link click on another path is prevented and opens the dialog.
   - "Keep editing" keeps the draft and the location.
   - "Discard draft" discards and then navigates.
   - Modifier-key, `target="_blank"` and same-path clicks pass through.
   - A `beforeunload` listener exists only while `hasDraft`.

### Non-blocking Suggestions

- **Layout switch loses last-good frames.** If a draft has an error and the viewport crosses the phone breakpoint, the phone presentation starts without last-good frames.
  - Observed going from 1280 to 375: step 3 (the erroring step) is labelled "Step 3: Compute column, 14 rows in draft, has an error in the draft". 14 is the saved count, so "in draft" is wrong.
  - Step 4 shows "—" with "showing its last result" but no rows (`eval-375-light-draft.png`, `eval-430-light-draft-preview.png`).
  - On the phone alone, the same flow keeps "14 → 11" and the last-good rows correctly.
  - Suggestion: hold the last-good frames on the page hook, not per layout, or at least never label a base count "in draft".
- **Header truncation at 1280.** With the rail open, the draft chip reads "Draft · unsaved chan…" and the pipeline name is cut to "eval-hel1631-…" (`eval-1280-dark-draft.png`). This is a visual call for the skeptic.
- **Programmatic navigation drops the draft.** Back/forward and command-palette navigation drop a draft without asking. This is documented in `useDraftLeaveGuard.ts:7-8`; list it in the PR as a known gap.
- **No phone structural-block test.** Add a phone-layout test asserting the structural block ("+ Add step", "+ Output", the header menu's Add source and Add Outputs from a shape). It is enforced today but only desktop is pinned.
- **Quarantined hel968 spec.** `e2e/hel968-multi-root-editor-flow.spec.ts:117-121` still waits for a PATCH/PUT. Note in HEL-991 that it now needs a draft Save & run.
- **File sizes.** `hooks/usePipelineDraftSave.ts` is 357 lines and `hooks/usePipelineDetailPage.ts` is 502 (was 442). Both are over the ~250 soft budget. Propose a split in the PR per CONTRIBUTING.md.
