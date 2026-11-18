## Evaluation Report — Cycle 2 (evaluation-2.md)

**What was reviewed:** HEAD `7de8fff15dc5543ead8447351e9e816fdbfcdf10`. Cycle 2 consists of:
- `e33ee4084`, the cycle-1 fixes;
- `0da85ecfa`, a merge of `origin/main` at `f2358c16d` (HEL-1757 and HEL-1760);
- `7de8fff15`, a tasks note.

**Base:** resolved live to `f2358c16d`, which equals `origin/main`. The page origin was asserted as `localhost:7178` throughout; the backend was `10085`.

**Persisted evidence:** all files are under `/home/matt/Development/helio/.concertino/runs/HEL-1746/evidence/`.
- `.concertino/scratch/HEL-1746/eval2/e2e.txt`: the full affected e2e run, 140/140.
- `.concertino/scratch/HEL-1746/eval2/flake-repeat.txt`: the phone repeat run.
- `.concertino/scratch/HEL-1746/eval2/scroll2.txt`: the phone sheet scroll probe.
- `.concertino/scratch/HEL-1746/measure.txt`: the raw file that `measurements.md` claims to quote.
- `e2e-evidence/HEL-1746/ask-sheet-dark-phone.png`, `ask-viewer-dark-phone.png` and `ask-sheet-draft-dark-desktop.png`.

### Gates (my own fresh runs, on the merged head, in WORKTREE_PATH)

| Gate | Result |
| --- | --- |
| lint, format:check, typecheck, `npm --prefix frontend run build` | pass |
| `check:schemas`, `check:openspec` | pass |
| `npm test` | pass: root 579/579; frontend 9915/9915 in 820 suites; 20 snapshots |
| backend | The backend, schemas and fixtures are unchanged since `64a91ca33` (`git diff --stat 64a91ca33 HEAD -- backend schemas shared-test-fixtures` is empty), and the merge brought no backend files. The cycle-1 `sbt testFull` (9904 passed, 0 failed) therefore stands for this tree. I re-ran `sbt -J-Xmx3g "testOnly *AskSeamSpec"` fresh: 6/6 succeeded. |
| e2e, full spec files, 2 workers | **140 passed, 0 failed**: `hel1746-ask-ui`, `hel1744-insight-panel`, `hel1003`, `hel666`, `hel1575-dashboard-tabs`, `hel1510`, `hel1331`, `hel1668-header-meta`, `hel813-mobile-touch-target-floor`, `hel1583-glass-nav`, `hel1582-mobile-pipeline`. Teardown deleted all 148 throwaway users. |
| formerly flaky phone test, `--repeat-each=5` | **10/10 passed** (light and dark phone) |

### Cycle-1 change requests, verified against the tree

1. **Shared button recipe: done.**
   - The code: `AskQuestionForm.tsx` now uses `ui-modal-btn ui-modal-btn--primary`, and `AskAnswerCard.tsx` uses `ui-modal-btn ui-modal-btn--secondary`. All hand-rolled button CSS and the `min-height: 44px` block are gone from `ask.css`.
   - Measured live in my run (e2e log), for Ask and Pin at 390px in both themes: `{"height":32,"hitAbove":true,"hitBelow":true,"hitFar":false}`. The buttons paint at 32px, and the hit region reaches past ±5px but not ±14px.
   - The screenshots show both buttons at the same height as the sheet's Save and Cancel.
2. **FormField: done.** `AskQuestionForm.tsx` wraps the textarea in `FormField`, with `label`, `htmlFor`, `hint` and `hintId`, and threads `hintId` into the textarea's `aria-describedby`. The `.ask-form__label` and `.ask-form__hint` rules were removed. The `openingState` snapshot is unchanged and green.
3. **Focus wait before typing: done.** `hel1746-ask-ui.spec.ts:429-430` waits with `await expect(askField(page)).toBeFocused()`. The free-user path types nothing. The repeat run was 10/10 green.
4. **R6 mutation record: done, and spot-verified.** `mutations.md` M13-M28 covers every guard I listed. I re-applied four of them independently in a throwaway detached worktree (since removed), with targeted jest:

   | Mutation | Change | My result | Recorded |
   | --- | --- | --- | --- |
   | M13 | truncated decided by message text | 3 failed | 3 |
   | M17 | free-tier check dropped | 1 failed | 1 |
   | M24 | Ask after the assistant | 2 failed | 2 |
   | M26 | command-bar kebab with no selector | 1 failed | 1 |

   `red-evidence.md` now states plainly that the frontend tests are proven by mutation.
5. **`measurements.md`: NOT done, and the new text misquotes its source.**
   - The padding is fixed to 40px, the edit-mode results are added, and the e2e row assertion is corrected (`rowWidth - 40 < 680`).
   - But lines 10-11 claim to quote the raw file **exactly**: "`measure.txt`, second sampling: `1175 rowW 871 ... "Edit layout"` then `1160 rowW 856 ... ""`" and "`leftW` was 368 at 871".
   - `.concertino/scratch/HEL-1746/measure.txt` (persisted) has **12 lines, one sampling, viewports 1300 down to 1190 only**. No 1175 or 1160 row exists, no `rowW` 871 or 856, and no `leftW` 368. Its only labelled-to-icon-only switch is between rowW 896 (`leftW` 393) and 886 (`leftW` 497). The "very first sampling ... on one load" framing likewise has nothing to refer to.
   - Line 18 repeats "368px with Ask against 408px without". Neither number is in the scratch files.
   - So an evidence record presents numbers as quoted from a file that does not contain them. The constants themselves are right, since my own probe confirms switches at content widths 860 and 680 in both view and edit mode. The defect is in the record, but a fabricated quotation in an evidence file cannot pass a gate.
6. **Screenshots: done.**
   - `ask-viewer-dark-phone.png`: the answer and both chips with no Pin beneath them.
   - `ask-sheet-draft-dark-desktop.png`: the disabled "Pin as insight" with "Save or discard your draft to pin." in frame.
   - The new `ask-sheet-{light,dark}-phone.png` show the answer, the chips, "Based on ..." and the 32px Pin button. Horizontal overflow is asserted to be 0.
   - `visual-check.md` is updated.
7. **Residue: done.** `SELECT count(*) FROM users WHERE id = 'b8728b04-2f6b-40c0-9ef8-e4032d0b94a9'` returns 0, and the leftover registry directory is gone.

### Phase 1: Spec Review — PASS
The ACs, task items and constraints C1/C2 and R1-R9 are as found in cycle 1. The cycle-2 diff adds no scope. The merge's incoming changes (web-fonts fixture and chart preload) are main's, and the ask code is untouched by them.

### Phase 2: Code Review — FAIL
- **One issue: the `measurements.md` record** (item 5 above).
- **Code quality now complies:** the shared recipes are reused, there is no hand-rolled button CSS, and no `min-height` remains on a button.
- **Two cycle-1 suggestions are also adopted:**
  - `useId` now supplies the pin-reason id.
  - The unused `askScope` alias is gone; `useAsk` calls `askDashboard` and `askOutput`.

### Phase 3: UI Review — PASS
- The full e2e is green, and the formerly flaky test is stable.
- Phone buttons are measured at 32px painted with a 44px hit region.
- I re-opened these images and judged their content correct, with legible dark/light parity:
  - `ask-sheet-dark-phone.png` (the one the executor had not re-opened) and `ask-sheet-light-phone.png`;
  - `ask-viewer-dark-phone.png`;
  - `ask-sheet-draft-dark-desktop.png`;
  - `ask-answer-dark-phone.png` and `ask-answer-light-desktop.png`.
- **One observation on `ask-sheet-{light,dark}-phone.png`, not a defect of this change:**
  - The sheet header is scrolled out of frame and an empty band shows under the footer. The capture calls `answer.scrollIntoView({block: "center"})`, which also scrolls the `<dialog>` itself.
  - My probe (`scroll2.txt`) shows that the phone Output-sheet dialog is already scrollable on its own: `dialog 912/758, overflowY=auto` with the ask group closed, and still `912/758` with the ask group removed from the DOM. So that outer scroll exists without this change.
  - The content shown is correct. Only the framing is off; see the suggestions.

### Overall: FAIL

**Category:** mechanical, because the defect is an evidence record that misquotes its source.

### Change Requests
1. Fix the false quotations in `openspec/changes/ask-ui-pin-insight/measurements.md`.
   - **Lines 10-11:** delete the "second sampling" quote (`1175 rowW 871`, `1160 rowW 856`, "`leftW` was 368 at 871") and the "very first sampling ... on one load" sentence. Either quote what `measure.txt` actually contains (one sampling, 1300 to 1190px: labelled at rowW 896 with `leftW` 393, icon-only at rowW 886 with `leftW` 497), or say plainly that the before-state raw data is not usable for picking the constants.
   - **Line 18:** drop "368px with Ask against 408px without", or cite a file that really contains those numbers.
   - Keep the paragraph that already rests on the evaluator's verified probe, which shows switches at content 860 and 680 in view and edit mode with no overflow.
   - Do not quote any number as "quoted exactly" unless it can be found in the cited file with grep.

### Non-blocking Suggestions
- In the new `ask-sheet-*-phone` capture (`hel1746-ask-ui.spec.ts`, near the end), use `answer.scrollIntoViewIfNeeded()` as the viewer capture does, or an element screenshot of the answer. That keeps the sheet header in frame and avoids scrolling the outer `<dialog>`.
- The phone Output-sheet `<dialog>` has its own vertical overflow (912/758) beside its scrolling body. This happens without the ask group too. It may be worth a separate ticket (a second scroller on a phone sheet), since it does not belong to this change.
- `AskQuestionForm`: the over-length message is passed as the `hint` while `aria-invalid` is set. `FormField`'s `error` prop (with an `errorId` threaded to `aria-describedby`) is the recipe for an invalid state. This is minor, because submit is also disabled.
- The PR-description points from evaluation-1 still stand:
  - propose splits for `OutputEditorSheet.tsx` and `App.tsx` (CONTRIBUTING.md asks for this when a file is over about 400 lines);
  - state that the dashboard drawer is effectively owner-only today, and that the viewer AC is proved on the Output sheet plus `AskDataServiceSpec` and `AskSeamSpec`;
  - state the `/ask` browser seam and the not-yet-rendered placement under parked HEL-1743.
