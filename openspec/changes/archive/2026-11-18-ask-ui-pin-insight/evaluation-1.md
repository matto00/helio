## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit `64a91ca33eb9c4b539a6e096ef4174777ca6ff9f`. The base was resolved live: `ecefad62a`, which equals `origin/main`, so nothing is left to merge.
Lane ports were confirmed: the Playwright pages ran on `localhost:7178` against backend `10085`, and each probe asserted the port.

Evidence (persisted, under `/home/matt/Development/helio/.concertino/runs/HEL-1746/evidence/`):
- `.concertino/scratch/HEL-1746/eval/e2e.txt`: the full affected e2e run, 137 passed and 1 failed.
- `.concertino/scratch/HEL-1746/eval/eval-probe.txt`: meta-row measurements in view mode, plus phone button geometry.
- `.concertino/scratch/HEL-1746/eval/eval-edit.txt`: meta-row measurements in edit mode.
- `.concertino/scratch/HEL-1746/eval/eval-console2.txt`: the 4xx responses and console errors seen during the probe.
- `.concertino/scratch/HEL-1746/eval/eval-sheet-phone-{light,dark}.png`: the Output sheet ask group on a phone.
- `e2e-evidence/HEL-1746/ask-viewer-light-phone.png` and `ask-sheet-draft-dark-desktop.png`: the two cited screenshots that do not show their subject.

### Gates (my own fresh runs, in WORKTREE_PATH)

| Gate | Result |
| --- | --- |
| `npm run lint` | pass |
| `npm run format:check` | pass |
| `npm run typecheck` | pass |
| `npm test` | pass: root 579/579, frontend 9904/9904, 20 snapshots |
| `npm --prefix frontend run build` | pass |
| `npm run check:schemas` | pass |
| `check:scala-quality`, `check:openspec`, `check:spec-structure` | pass |
| `cd backend && sbt -J-Xmx3g testFull` | `Tests: succeeded 9904, failed 0`, `All tests passed.`, exit 0. All 6 `AskSeamSpec` cases ran and passed. |
| e2e (2 workers, DEV_PORT 7178), full spec files | **137 passed, 1 failed** (details in Phase 3, issue 1) |

The e2e run covered these spec files:
- `hel1746-ask-ui` and `hel1744-insight-panel`.
- The executor's list: `hel1003`, `hel666`, `hel1575-dashboard-tabs`, `hel1510`, `hel1331` and `hel1668-header-meta`.
- Three specs I added because they also cover touched files:
  - `hel813-mobile-touch-target-floor`, which covers the meta row and the command-bar kebab at phone widths.
  - `hel1583-glass-nav`, which covers the meta row.
  - `hel1582-mobile-pipeline`, the only other `BottomSheet` consumer (`MobileStepSheet`).

So the executor's list was not complete for the touched files. All three added specs pass.

### Phase 1: Spec Review — PASS (with record defects folded into Phase 2)

**Acceptance criteria**
- The ask/answer/pin flow is met under the driver rulings. "Appears and renders" is read as "appears, placed, not yet rendered" (HEL-1743 is parked).
- The fake-model correction holds. Only `/ask` is faked through `page.route`, using fixtures that `AskSeamSpec` proves equal to the real route output. The pin POST, the placement and the not-yet-rendered panel all run against the real backend, and I re-ran them.

**Executor claim 3 (viewer premise): verified against the tree.**
- `GET /api/dashboards` is owner-only. `DashboardService.findAll` calls `DashboardRepository.findAll(ownerId)`, which filters `_.ownerId === ownerUuid` (`DashboardRepository.scala:57-59`).
- `DashboardRoute.tsx:28-48` renders "Dashboard not found" for any id that is not in that list.
- So a dashboard-only grantee cannot reach the dashboard ask drawer in the authenticated shell. Testing "a viewer sees no pin" through a pipeline viewer on the Output sheet is the correct reachable path.
- **The AC is met, in two halves:**
  - The client renders no pin when `pin` is null. The e2e checks this with a schema-validated `pin: null` fixture.
  - The server withholds the pin. `AskDataServiceSpec:359-361` covers a pipeline viewer and a dashboard-only viewer, and `AskSeamSpec` covers the dashboard viewer at route level.
- One consequence belongs in the PR: in practice the dashboard drawer is reachable only by the dashboard owner today.

**Other checklist items**
- Tasks are all ticked and match the code.
- I found no scope creep. The `BottomSheet` `size` passthrough and the `ModalSize` export are planned (task 3.0).
- C1 is honoured.
- C2 is honoured: a CSS-text guard backed by mutations M2 and M3, plus a phone e2e assertion that the sheet width equals the viewport width, which passed in my run.
- R9 is honoured: there is no production backend change, no migration, no model picker and no billing copy.

### Phase 2: Code Review — FAIL

**Issue 1. DESIGN.md §3 "The 44px touch floor" [mechanical] is violated.**
- **The violation:** `frontend/src/features/ask/ui/ask.css:141-146` sets `min-height: 44px` on `.ask-form__submit` and `.ask-answer__pin-button`, inside the touch gate.
- **The rule:** DESIGN.md says: "Do not reintroduce `min-height: 44px` on a button". Compact painted buttons must use the sized `::after` hit expander.
- **Measured in the running app** at 390px (`eval-probe.txt`): the Ask submit and Pin buttons paint at **44px** tall. The same sheet's `.ui-modal-btn` Save and Cancel buttons paint at **32px**, with their expander.
- **Visible in the screenshots:** the inflated orange Ask button and the outlined Pin button stand taller than the footer buttons in both themes.

**Issue 2. A shared button recipe is hand-rolled (DESIGN.md §6 "do not hand-roll equivalents"; DRY).**
- `.ask-form__submit` (`ask.css:36-63`) copies `.ui-modal-btn` + `.ui-modal-btn--primary` (`shared/ui/Modal.css:203-248`) almost line for line: height, padding, radius, type, transition, accent fill, hover and disabled.
- `.ask-answer__pin-button` (`ask.css:103-126`) copies `.ui-modal-btn--secondary`.
- Every other Output-sheet button already uses `ui-modal-btn` (for example `OutputEditorFooter.tsx:37-66` and `OutputSheetPreviewCard.tsx:64`).
- Reusing the shared classes also fixes Issue 1, because they carry the hit expander.

**Issue 3. The question field re-derives `FormField` (DESIGN.md §6: "new forms use it instead of re-deriving `.xxx__field`").**
- `AskQuestionForm.tsx:38-56` hand-rolls the label and hint.
- `ask.css:13-29` styles them as `.ask-form__label` and `.ask-form__hint`.
- `shared/ui/FormField` takes `label`, `htmlFor`, `hint` and `hintId`, which covers exactly this.

**Issue 4. R6 / red-first: the frontend unit tests have no red run, and the mutation table that replaces it does not cover every guard.**
- `red-evidence.md` admits the frontend unit tests were written after the module. Their red proof is `mutations.md` M2-M12.
- R6 requires every guard to have a recorded mutation. These load-bearing guards have none:
  - `parseAskError`: TRUNCATED versus UNGROUNDED decided by `code` (not by text); 403 maps to `tierForbidden`; any 5xx maps to `unavailable`.
  - `AskPanel`: a free tier sends no request (`tier === "free"`); a 403 shows the upsell.
  - `ask.contract.test.ts`: the fixtures are validated against their schemas, and the negative cases are rejected.
  - `useAskPin`: the thunk path when the list is loaded, versus the service path; and "cannot be repeated".
  - `AskQuestionForm`: the 2000-character bound, and Enter versus Shift+Enter.
  - `DashboardMetaRow`: Ask comes immediately before the assistant; at tier 2 it becomes a kebab item with the kebab selector.
  - `CommandBar`: the kebab item and its restore selector.
  - `OutputEditorSheet`: the group is absent in create mode (M11 covers only the draft-Output case).
  - `AskDrawer`: focus moves to the field on open.
- Reading the tests, most of them look capable of failing. That is not the evidence the rule asks for, though, and a test written after its module is exactly where a vacuous pass hides.

**Issue 5. `measurements.md` cites numbers its own raw output does not contain, and states the wrong padding.**
- It says the row has 36px of padding. The live row has 40px: in my probe, `content = rowW - 40` at every width.
- It says the switch was at "856px border box" before and "icon-only from 906px" after. The executor's own `measure.txt` and `measure-after.txt` show labelled-to-icon-only between 896 and 886 before, and between 926 and 916 after.

My own re-measure (`eval-probe.txt`, `eval-edit.txt`) confirms the new constants work: each tier switches exactly at content widths 860 and 680. **Claim 4 is therefore supported on substance.**

| Mode | Checked range (viewport) | Result |
| --- | --- | --- |
| View | 1440 to 900px | No row overflow and no actions overflow. Facts column at least 397px at tiers 0-1. |
| Edit (the part not re-sampled) | 1440 to 1120px; edit mode itself ends below about 1100px | Ask present at tiers 0-1, no overflow at any width, icon-only switch at content < 1010 (1016 shows labels, 996 is icon-only). Facts column is 303px just before that switch. |

The edit-mode facts minimum is the same as before Ask was added, because both the threshold and Ask moved by +40. So the unsampled offset is fine. Only the record is wrong.

**Executor claim 1 (test edits): legitimate, not bent.**
- `OutputEditorSheet.history.test.tsx` renders with `tier = "free"` by default (`renderSheet(..., tier: UserTier = "free")`, line 84). The new ask group therefore renders `AskUpsell`, whose link has the same accessible name, "Request Beta access (opens in a new tab)". The unscoped `getByRole` would legitimately find two links. Scoping the query to the History section keeps every assertion intact.
- The `openingState` snapshot gains exactly the textarea and the disabled Ask button, and only in the edit-mode entries. Create-mode entries are unchanged, which matches the `hasServerRow` gate. jsdom exposes the contents of a closed `<details>`, so this is a true consequence of the new group.

**Non-blocking points** (also listed as suggestions):
- `AskAnswerCard.tsx:90,96` hardcodes the id `id="ask-pin-reason"`. It should come from `useId`.
- `askService.ts:66-72`: `askDashboard` and `askOutput` are used only by tests; production uses the `askScope` alias.
- `OutputEditorSheet.tsx` was 418 lines and is now 428; `App.tsx` was 454 and is now 469. CONTRIBUTING.md asks a change that touches a file over about 400 lines to propose a split in the PR description.

### Phase 3: UI Review — FAIL

**Issue 1. A flaky e2e test: `hel1746-ask-ui.spec.ts`, "a viewer sees no pin ... error states", phone.**
- **Result:** it failed in my full run (dark phone). With `--repeat-each=4` on the phone variants it failed 1 time in 8. That is 2 failures in 10 phone executions in total.
- **Symptom:** the snapshot shows the textbox empty but `[active]`, and Ask `[disabled]`. The typed question never reached the field, so no answer card appeared.
- **Probable cause:**
  - This test types right after `openAskByKeyboard`, without waiting for focus (lines 397-403).
  - `AskDrawer` moves focus to the field in a `setTimeout(0)` after the sheet opens (`AskDrawer.tsx:20-25`).
  - The first test does `await expect(askField(page)).toBeFocused()` before typing and never failed.
  - My probe runs the same phone kebab flow with that wait, and passed twice.
- This would flake in CI.

**Issue 2. Two cited visual evidences do not show their subject.**
- `ask-viewer-<theme>-<viewport>.png` should prove "viewer sees no pin" on the Output sheet. `ask-viewer-light-phone.png` shows the History and Preview cards, and the ask group is cut off at the field label. No answer is visible.
- `ask-sheet-draft-<theme>-desktop.png` should show "Pin disabled with the reason". `ask-sheet-draft-dark-desktop.png` ends at the question field: neither the answer, the disabled Pin nor the reason is in frame.
- `visual-check.md` reports both as observed by eye ("in a draft, Pin is disabled with 'Save or discard your draft to pin.'"). The DOM assertions do pass, but those screenshots are not evidence of it.
- The Output sheet ask group was also never captured on a phone. All `ask-sheet-*` shots are desktop-only, while the AC asks for desktop and phone. I captured it myself (`eval-sheet-phone-{light,dark}.png`): it fits at 390px with no horizontal overflow (`dialogOverflowX: 0`), and shows the inflated buttons from Phase 2 Issue 1.

**Checked and fine:**
- **Happy path:** owner asks, the chips open real provenance, Escape returns focus to the chip, the real pin is created and placed, and the panel shows "Not yet rendered".
- **Error states:** 422 ungrounded, 422 truncated and 503 each show their copy, with Retry where it belongs. The question is kept.
- **Free tier:** the upsell is shown and zero ask requests are sent.
- **Focus:** it returns to the meta-row button, and to the kebab trigger from a kebab item at 900px and on a phone.
- **Drawer width:** 540px on desktop; equal to the viewport on a phone.
- **Light/dark parity:** I opened the desktop and phone answer, pinned, placed and unavailable screenshots, the phone upsell, and both themes of the sheet. Everything uses tokens, and nothing was illegible.
- **Console:** the only console errors and 4xx responses during a sheet ask, a pin and a phone drawer ask were the pre-login 401 on `/api/auth/me`, a 404 on the pipeline `schedule` GET (no schedule set; this already happened before the change), and an error caused by my own probe's init script running on `about:blank`. None is ask-related.
- **Glyph:** I judge the Ask glyph distinct from the assistant glyph.

**DB residue**
- All users I created were deleted by the run teardowns. Every teardown printed `deleted N`, and no registry directory of mine remains.
- **Executor residue remains:** `.e2e-user-registry/1795007098796-3295251/3295274.jsonl` (05:05, before my review) records user `b8728b04-2f6b-40c0-9ef8-e4032d0b94a9` (a `hel1746` address). That user still exists: `SELECT count(*) FROM users WHERE id = ...` returned 1. Task 4.4 is ticked but not complete. I did not delete it, because it is not mine.

### Overall: FAIL

**Verdict category:** mechanical. The failures are a DESIGN.md [mechanical] violation, an unmet lane-rule record (R6), a flaky e2e test and incomplete evidence.

### Change Requests

1. Replace the hand-rolled buttons with the shared recipe, which removes the forbidden inflation.
   - `AskQuestionForm.tsx:58`: use `className="ui-modal-btn ui-modal-btn--primary"`.
   - `AskAnswerCard.tsx:86-88`: use `className="ui-modal-btn ui-modal-btn--secondary"` (keep the BEM class only if a layout hook is needed).
   - Delete `.ask-form__submit`, `.ask-answer__pin-button` and the `min-height: 44px` touch block at `ask.css:36-63,103-126,140-146`.
   - Re-run the phone e2e and record the measured painted height (32px) and a 44px hit region, using an `elementFromPoint` bisect or the `expectTapExpander` pattern.
2. Build the question field with `shared/ui/FormField`. Pass `label="Your question"`, `htmlFor`, the `hint`, and `hintId` threaded into the textarea's `aria-describedby`. Remove `.ask-form__label` and `.ask-form__hint` from `ask.css`. Keep the accessible name "Your question" so the e2e and the `openingState` snapshot are unaffected.
3. In `e2e/hel1746-ask-ui.spec.ts`, add `await expect(askField(page)).toBeFocused();` before the first `page.keyboard.type`:
   - in the owner drawer flow of the "viewer ... error states" test (after line 400);
   - in the same test's free-user path, before any typing.

   Then re-run that test with `--repeat-each=5` on the phone variants and record 0 failures.
4. Complete R6 in `mutations.md`. Add a recorded mutation and its failing test for each unmutated guard listed in Phase 2 Issue 4. At minimum:
   - `parseAskError`: switch to `message` text; make 422 always `ungrounded`; make 403 map to `unknown`.
   - `AskPanel`: drop the `tier === "free"` check; drop the 403-to-upsell mapping.
   - `ask.contract.test.ts`: make the schema accept any `code`.
   - `useAskPin`: always take the service path.
   - `AskQuestionForm`: remove the 2000-character bound.
   - `DashboardMetaRow`: put Ask after the assistant.
   - `CommandBar`: drop the restore selector.
   - `OutputEditorSheet`: render the group in create mode.
   - `AskDrawer`: drop the focus-on-open effect.

   State plainly in `red-evidence.md` and the PR that the frontend unit tests are proven by mutation, not by a red run.
5. Fix `measurements.md`:
   - Row padding is 40px, not 36px.
   - Quote the switch widths that `measure.txt` and `measure-after.txt` actually contain.
   - Add the edit-mode result: no overflow from 1440 to 1120px viewport, icon-only below content 1010, facts minimum 303px, and edit mode ends below about 1100px.
   - Optionally tighten the stale `expect(rowWidth).toBeLessThan(640)` at `hel1746-ask-ui.spec.ts:528` to the 680 tier plus padding.
6. Make the screenshots show what they claim:
   - Before each `ask-viewer-*` and `ask-sheet-draft-*` capture, call `scrollIntoViewIfNeeded()` on the answer region, or use an element screenshot of the answer card, so that "no pin" and the disabled Pin with its reason are in frame.
   - Add an Output-sheet phone capture in light and dark.
   - Update `visual-check.md` after re-reading the new images.
7. Delete residue user `b8728b04-2f6b-40c0-9ef8-e4032d0b94a9`, the one recorded in `.e2e-user-registry/1795007098796-3295251/3295274.jsonl`. Use the guarded `buildUserDeleteSql` with that exact id and email (for example via the registry-dir teardown path). Then remove that registry directory, and note the deletion in tasks 4.4 and the PR.

### Non-blocking Suggestions
- `AskAnswerCard.tsx:90,96`: take the pin-reason id from `useId()` instead of the literal `"ask-pin-reason"`.
- `askService.ts:66-72`: either use `askDashboard` and `askOutput` from `useAsk`, or drop them and keep `askScope`. Today production calls one name and the tests call two others.
- PR description:
  - Propose splits for `OutputEditorSheet.tsx` (428 lines) and `App.tsx` (469), per the ~400-line rule in CONTRIBUTING.md.
  - State that the dashboard drawer is effectively owner-only today, because grantees cannot open a dashboard in the shell. The viewer AC is proved on the Output sheet, with the server half in `AskDataServiceSpec` and `AskSeamSpec`.
- `ask.css:21`: `min-height: 72px` is a literal. `rows={3}` already sizes the textarea, so the line can probably go.
