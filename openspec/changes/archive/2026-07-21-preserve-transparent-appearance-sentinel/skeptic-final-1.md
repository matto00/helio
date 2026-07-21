## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Ground truth diff** (`git diff main...HEAD --stat`): only `frontend/src/features/panels/ui/PanelDetailModal.tsx` (+13/-9) and a new test file `PanelDetailModal.appearanceSentinel.test.tsx` (+148) touch product code; the rest is `openspec/changes/preserve-transparent-appearance-sentinel/**` planning artifacts. No backend/schema/contract files changed — matches `files-modified.md` and the ticket's frontend-only scope.

2. **Code inspection** (`frontend/src/features/panels/ui/PanelDetailModal.tsx`, read in full):
   - `initialBackground`/`initialColor` (lines 88-89) and `resetFormToPanel` (lines 142-143) now seed directly from raw `panel.appearance.background`/`.color` — no `getColorInputValue` call at the state-seed layer.
   - The only resolution to a display-safe hex happens at the `<AppearanceEditor>` prop boundary (lines 362, 364): `getColorInputValue(background, panelAppearanceEditorFallback)` / `getColorInputValue(color, panelTextEditorFallback)`. `setBackground`/`setColor` are passed through unwrapped.
   - `handleEditSubmit` (lines 207-212) builds `appearancePayload` directly from raw `background`/`color` state — no restore/touched-flag machinery.
   - Confirmed `AppearanceEditor.tsx` remains purely presentational: `background`/`color` typed `string`, setters typed `Dispatch<SetStateAction<string>>`, and the only call sites are the native `<input type="color">` `onChange` handlers, which always emit a 6-digit hex — so an edited field is legitimately overwritten with a real hex while an untouched field's setter is never invoked, keeping the raw sentinel. No other UI path (e.g., a "reset to default" control) writes into `background`/`color`.
   - `appearanceDirty` (lines 131-136) now compares raw-vs-raw (`background !== initialBackground`), consistent in meaning with the old resolved-vs-resolved comparison — verified this isn't a regression by reading both sides of the diff.
   - Confirmed both real call sites (`DesktopPanelGrid.tsx:294`, `MobilePanelStack.tsx:132-134`) key `<PanelDetailModal>` by `panel.id` (pre-existing HEL-307 pattern), which the new remount test (`it("remounts via key on panel switch...")`) mirrors faithfully — the fix correctly relies on existing behavior rather than inventing new reset logic.

3. **Regression tests genuinely guard the bug** (`PanelDetailModal.appearanceSentinel.test.tsx`): I did not just read the file, I reproduced the claim in `files-modified.md` that "3 of 4 tests fail against pre-fix code." Checked out the pre-fix version of `PanelDetailModal.tsx` (`git show d3cf7ebf^:...`), copied it in place of the current file, ran `npx jest --testPathPatterns=PanelDetailModal.appearanceSentinel`:
   - Result: **3 failed, 1 passed** — exactly the untouched-background, untouched-color, and remount tests failed with `Expected "transparent"/"inherit", Received "#1a1816"/"#f2efe9"`; the explicit-hex-pick test passed (as expected, since that path was never broken).
   - Restored the post-fix file (verified `git diff` on the file was empty afterward — clean restore), re-ran the same test file: **4 passed, 4 total**.
   - This directly satisfies AC 3 and proves the tests would catch a regression of this exact bug, not merely pass vacuously.

4. **Acceptance criteria traced to evidence**:
   - AC1 (untouched transparent/inherit sentinel survives save) — test 1 & 2, both independently reproduced to fail pre-fix and pass post-fix.
   - AC2 (explicitly chosen colors still persist correctly) — test 3, asserts `pending.appearance?.background === "#123456"` after firing a real `onChange` on the color input.
   - AC3 (regression test guarding the round-trip) — the 4-test suite, reproduced above.

5. **Re-ran all gates myself from `WORKTREE_PATH`** (not trusting the evaluator's pasted output):
   - `npm run lint` → exit 0, zero warnings.
   - `npm test` → root passthrough + `helio-frontend test`: **113 suites / 1186 tests passed**.
   - `npm run format:check` → "All matched files use Prettier code style!"
   - `npm run check:schemas` → "schemas in sync... panel-type enums in sync..." (expected no-op given zero backend/schema changes).
   - `cd frontend && npm run build` → Vite build succeeded (`✓ built in 552ms`), only a pre-existing unrelated chunk-size advisory warning.

6. **Scope / standards sanity check**: `git diff main...HEAD --name-only` confirms no edits outside the two named files + planning docs. No inline fully-qualified names introduced (grep for `com.`/`org.`/`scala.` patterns in the added lines returned nothing — N/A anyway, this is TS). No DESIGN.md exposure — zero JSX/CSS touched, confirmed by diff (only state-seed lines and prop-boundary resolution calls changed). CONTRIBUTING.md: no `any`, no new abstractions, reuses existing `getColorInputValue`/`panelAppearanceEditorFallback`/`panelTextEditorFallback` helpers, no dead code. File-size note (416→420 lines, over the informal 400-line soft-budget) is pre-existing and non-blocking, correctly flagged as such by the evaluator.

7. **UI/visual gate**: not applicable — confirmed via diff that no JSX/markup/CSS changed, so there is no rendered-output difference to screenshot; skipped per the orchestrator's brief (Playwright optional for this ticket) and my own confirmation that the only behavior change is the timing of `getColorInputValue` resolution (still resolves to the identical hex at the identical render point), not its existence.

### Verdict: CONFIRM

### Non-blocking notes
- `PanelDetailModal.tsx` remains over the informal 400-line soft budget (420 lines post-change, +4 from added documentation comments only, no new logic). Not a regression from this ticket; a future ticket could extract the appearance-state block into a hook.
