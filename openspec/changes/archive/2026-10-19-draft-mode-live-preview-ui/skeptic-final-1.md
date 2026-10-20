## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `fdfeca1ddbc125096aed61237b3282f7e6b7cdd7`. Base resolved live with `resolve-review-base.sh`: `538a867d718204775f7c0844450f683889e145e3`. That is 3 commits and 99 files.

Evidence directory: `/home/matt/Development/helio/.concertino/runs/HEL-1631/evidence/.concertino/scratch/HEL-1631/`. The `sk-*` files listed below are in it.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/live-draft-mode-ui/HEL-1631`.

**Owner rulings** (`.concertino/runs/HEL-1631/events.jsonl`):
- Line 11: `escalation.answered` `block-during-draft-recommended`, `answer_source: human`, `resolution_channel: chat`.
- Line 34: `escalation.answered` `accent-22-amend-design`, `answer_source: human`.
  - Line 33 is an `escalation.answer_discarded` recorded 8 ms after the raise. The human answer came 58 s later, so the ruling stands.

**Gates I re-ran myself** (`nice -n 19`):
- Frontend typecheck exited 0.
- Lint exited 0.
- Jest over `features/pipelines|theme/|rawElementGuard|shared/chrome` with `HELIO_JEST_MAX_WORKERS=2`: 208 suites and 3377 tests passed (`sk-jest-pipelines.txt`).
- e2e `hel1631-draft-mode.spec.ts` + `hel1668-phone-sheet.spec.ts`, under the e2e.lock flock with `--trace retain-on-failure` and 1 worker: 23 passed, rc 0 (`sk-e2e.txt`).
- I did not re-run the full frontend jest suite. The evaluator's `eval2-jest.txt` shows it green.

**Code read in full:**
- `state/pipelineDraft.ts`
- `hooks/usePipelineDraft.ts`
- `hooks/usePipelineDraftSave.ts`
- `hooks/usePipelineDraftFrames.ts`
- `state/draftStepView.ts`
- `hooks/useDraftLeaveGuard.ts`
- `hooks/useStepCardPersist.ts`
- `ui/PipelineDraftDialogs.tsx`
- The diffs of `usePipelineDetailPage.ts`, `pipelinesSlice.ts`, `outputsSlice.ts`, `useStepPreviewFetch.ts`, `usePipelineDebouncedAnalyze.ts`, `PipelineSpineHeader.{tsx,css}` and `StepPreviewTable.{tsx,css}`.
- Backend `DraftDiff.scala`. Its config 400s read `Step '<id>': …`, so the step-naming in `stepNamedBy` does work.

**Live app on 7063/9970**, with a throwaway pipeline on the dev account. All of it was deleted by exact id afterwards: output 200, pipeline 204, source 204, and a GET then returned 404 (`skeptic-created-ids.txt`).

| AC / requirement | Verdict | Evidence |
|---|---|---|
| Client-evaluable edit: 0 requests, < 50 ms | Met | Live: after a filter edit, a PerformanceObserver over `/api/` recorded `[]`, and counts read `14 → 8` (`sk-1280-dark-draft.png`). e2e: per-edit latency is about 5–11 ms. The C6 red-first artifact exists. |
| Server-only step via the transport, paced, no run | Met | e2e test 4 (6 draft-previews in 4.2 s, bound 10, no other request). |
| Discard exact, zero requests | **Partly met** | Exact: yes. Zero requests: **no** when the selected step was first opened during the draft. Reproduced twice live: 1 × `GET …/steps/:id/preview` after Discard. The e2e avoids this by pre-visiting every step before the draft (spec lines 228–232). See CR5. |
| Save & run: one request + run + one journal row, Undo | Met at the server; **UI defects** | e2e test 3. Live cascade 422 → dialog → confirm → saved → Undo works (`sk-1280-dark-cascade.png`, `sk-1280-dark-after-undo.png`). Two defects: CR2 and CR3. |
| 409 stale reload-only, 422 cascade, 400 names the step, refused run "retry in N s" + Run now | Met | jest `PipelineDetailPage.draftMode.test.tsx:445–656`; e2e tests 5–6; the 422 path checked live. |
| Sample label and age | Met | `SpineSourceCard`; evaluator screenshot `eval-1280-rest-sample-label.png`. |
| Leave guard (spec: "Leaving the page with a draft SHALL ask for confirmation") | **Not met** | Reproduced live. See CR1. |
| Structural actions disabled with the reason (ruling a) | Met on desktop; **phone styling defect** | Desktop: `disabled` + title on add source, add step, shape, Output open, + Output and Duplicate. Phone: see CR4. |
| Flash at 22% `--app-accent` (ruling b), Off = static | Met | Live, light, Off: 12 changed cells, `color(srgb 0.9176 0.702 0.031 / 0.22)`, `animation: none` (`sk-1280-light-flash-off.png`). DESIGN.md diff is one line (30% → 22%). |

**Your specific questions:**

- **Removed `castSaveError` / `enumSaveError` tests.**
  - What was lost: the HEL-1416/1422/1514 field-level surfacing. A rejected config used to show the server message, set `aria-invalid` on the specific control and link it with `aria-describedby`.
  - Now nothing ever calls `setSaveError`. The `saveError` / `saveErrorIsValidation` state and props still exist in `useStepCardEditorState.ts:117-118`, and Cast, FillNull, Window and Pivot still accept them, but they are dead.
  - Server validation now appears only at Save & run, as a page notice naming the step.
  - This follows from the ticket (no per-edit PATCH) and the spec only asks to name the step, so it is not blocking. Follow-up: route a 400 that names a step back into that step's editor, or delete the dead plumbing.
  - The replacement `StepCardFocused.draftEdits.test.tsx` asserts the new contract: the edit reaches the draft, no PATCH is sent and no false `aria-invalid` appears. It is a fair replacement for what still exists.
- **hel1668 item 2 rewrite (delete → move).** The intent is kept. It still checks that the toast is inside the open dialog, topmost at its centre, overlaps no sheet control, and is announced through an in-dialog assertive region that was connected and empty first. The alert-log baseline was moved before the sheet opens, which is correct because the region now connects at open. One sub-path is gone: "sheet closes on delete and reopens on failure". It no longer exists for saved steps, because delete is a draft edit. The test passed live at 375, 390 and 768.
- **Chip and name truncating at 1280.**
  - Acceptable. "Draft · …" stays legible, the name ellipsizes as it already did, and Discard / Save & run carry the state.
  - With a short name and no run chip it fits in full (`eval2-1280-dark-draft.png`).
  - One gap: the CSS comment (`PipelineSpineHeader.css`, the HEL-1631 block) says the words "stay as its accessible name and title". There is no `title`, so the dot-only chip below a 600 px container (`sk-900-dark-draft.png`) has no tooltip. See the non-blocking notes.
- **Desktop→phone switch mid-error.** Real but out of scope as a blocker. `usePipelineDraftFrames` and its `createViewTracker` live per layout, so a layout switch re-seeds the last-good frames from the saved walk. Downstream stale steps then show the saved count as their "last good" count. You only reach this by resizing across 768 px with an error open, and no data is lost. Non-blocking follow-up.
- **Back/forward drops the draft.** A real defect, and in scope. See CR1.

### Verdict: REFUTE

### Change Requests

1. **Back/forward and programmatic navigation silently discard the draft (spec unmet, new data loss).**
   - Reproduced live: opened the pipeline from `/pipelines` through an in-app link, made a draft (chip shown), then `history.back()`. The page went to `/pipelines` with no dialog. `history.forward()` came back with no draft and counts `14, 14, 14`.
   - `useDraftLeaveGuard.ts:5-9` documents this as a limitation, but no owner ruling accepts it. The spec says, without qualification, "Leaving the page with a draft SHALL ask for confirmation".
   - Before this change every edit was persisted, so Back was harmless. Now the most common way to leave (browser Back, mouse back button, phone swipe or Android back) loses work without a word.
   - The same happens for `navigate()` paths: the command palette and picker in `usePickerSelection.ts`, Settings from the rail and bottom nav, and `useResourceNavigator`.
   - Fix: make leaving by any route either ask first or not lose the draft. For example:
     - a popstate sentinel entry while `hasDraft`, which re-pushes and opens the existing "Discard your draft?" dialog; or
     - keeping the overlay in `sessionStorage`, keyed by pipeline id, and restoring it on remount through the existing `rebase` path and its "N of your edits no longer apply" notice.
   - Add an e2e that makes a draft, goes Back, and asserts the draft was not silently lost. If you choose restore over confirm, update the spec sentence to say so.
2. **The "Saved." toast keeps a stale Undo after a successful Undo.**
   - `usePipelineDraftSave.ts:189-194` pushes it with `duration: 0`. `undo()` (lines 142-161) never dismisses it.
   - Live: Undo → "Undone." → the Saved toast was still showing Undo. A second click got `409 /api/patch-sets/…/undo` and a banner with raw server text: "Undo was refused, nothing changed: Nothing was applied: changed since the preview: edit 0 (pipeline db51381f-…). Preview the patch set again before applying." (`sk-1280-dark-second-undo.png`).
   - A later save has the same problem: the older toast's Undo then targets a superseded application.
   - Fix: dismiss or replace the Saved toast when its undo succeeds, and when a newer save supersedes it. Add a jest assertion that, after a successful undo, no Undo action remains.
3. **The post-save Output refresh requests Outputs the save just deleted.**
   - `settleSaved` (`usePipelineDraftSave.ts:184`) calls `refreshVisibleOutputPreviews`, which iterates `allOutputsRef.current` (`usePipelineRunAndSaveActions.ts:54-61`). On the same tick that ref still holds the pre-save Outputs.
   - Live, after a cascade save that removed Output `b46bb976…`: 2 × `GET /api/pipelines/:id/preview?outputId=b46bb976… → 404`, both in the console.
   - Fix: refresh from `response.saved.definition.outputs` (pass the ids in), not the stale ref. Add a test that a save removing an Output requests no preview for it.
4. **The phone "+ Add step" is disabled during a draft but looks and acts enabled.**
   - `.spine-add-row` (`ui/mobile/PipelineMobile.css:368`) has no `:disabled` rule. Live at 375: `disabled=true`, `opacity: 1`, `cursor: pointer` (`sk-375-dark-draft.png`, `sk-375-light-draft.png`).
   - Its sibling "+ Output" is dimmed to 0.5, and desktop's `.spine-ghost-btn:disabled` is dimmed too. On touch the `title` reason never shows, so a tap simply does nothing.
   - Fix: give `.spine-add-row:disabled` the same disabled treatment as `.spine-ghost-btn:disabled` (opacity and `cursor: not-allowed`).
5. **Discard is not zero-request in a normal flow, and the e2e is shaped so it cannot see this.**
   - Reproduced live twice: edit step 1, select step 2 for the first time during the draft, Discard → 1 × `GET …/steps/<step2>/preview`.
   - `e2e/hel1631-draft-mode.spec.ts:228-232` pre-visits every step before drafting "so Discard has nothing left to fetch". The AC says "with zero requests".
   - Fix:
     - Add the first-view-during-draft case to the Discard e2e.
     - Then either make it zero-request, or record it as an AC deviation for the orchestrator to put to the owner. Do not leave the pre-warm loop as the only evidence.
     - Show it in the e2e either way.

### Non-blocking notes

- The phone add-step defect is CR4.
- Add a `title` (or tooltip) carrying "Draft · unsaved changes" to the chip, so the dot-only compact chip and the ellipsized 1280 chip can be read. The CSS comment already claims this exists.
- The TSX comment beside the chip (`PipelineSpineHeader.tsx`, "the page's accent is reserved…") contradicts the accent dot that the CSS applies. Reword it.
- During a draft that deletes a step, its Output card reads "from an unknown step" (`sk-1280-light-after-remove.png`). That looks like corruption. Something like "removed with its step on save" would be clearer. The cascade dialog does warn before the save.
- After a step error, an empty last-good frame shows "No rows to preview." flush to the card's left edge, while the error line above it is padded (`sk-1280-light-error.png`). The DataGrid empty state already looked like this, but drafts make it common.
- Cascade dialog: the server hints "Removes 1 step(s)." / "Removes 1 Output(s)." repeat the list above them.
- Dead `saveError` plumbing; see the castSaveError answer above.
- The last-good-frame reset on a layout switch is a follow-up.
- `draftSaveRunPending` clears the Output previews and the run chip before a save that may then 409 or 422. After a refused cascade the header loses its last run status until the next read. This is minor.
- Gate defect check: no mtime-ordering evidence was relied on here or in the evaluator reports I read.
