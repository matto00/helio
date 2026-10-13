## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `b3051d188a19de0c111b53aa60405fa5c0083599` against live-resolved base `290ab8a22c7f0adc16b4c0d070748657067081fe` (`resolve-review-base.sh`, exit 0).

### Phase 1: Spec Review — FAIL

Verified:
- **Item 1 (split), C1.** I checked this myself against the base commit, not from the executor's account:
  - I ran the base `PanelCard.test.tsx` in a temporary detached worktree at 290ab8a22. Its frontend `node_modules` was symlinked from the main checkout's `frontend/node_modules` and the worktree was removed afterwards. Result: 36 tests passed.
  - The three split files on HEAD also give 36 passed: Body 8, Header 10, Header.refreshFullscreen 18.
  - The jest `--json` `fullName` lists match. The sorted base and head lists are identical: symmetric difference empty, no duplicates.
  - Bodies: each of the base file's 9 top-level `describe` blocks (lines 115-807) appears byte-for-byte in exactly one split file. The 7 comment/const chunks between blocks also appear byte-for-byte, including `DIALOG_FOCUSABLE_SELECTOR`.
  - Preambles: the only differences from base lines 1-114 are unused imports and unused `jest.mocked` handle constants. All 5 `jest.mock(...)` calls are kept in every file, so no mock was dropped.
  - File sizes are 296, 284 and 399 lines, all under the 500-line budget.
- **Item 3 (dead code).** At base, `chartAppearance`/`setChartAppearance` were used only in the hook's state and return, the modal's destructure, and the `AppearanceEditor` props passed with `showChartSection={false}`. `handleEditSubmit` never read them, so removing them preserves behaviour.
  - `git grep` finds no remaining `ChartAppearanceEditor`, `showChartSection`, `buildInitialChart`, `panelDetailChartState` or `setChartAppearance` in frontend, e2e or docs.
  - HEL-1378: tests 1-2 and the capture wrapper were removed. Test 3, from its `it(` line to EOF, is byte-identical to base, and so are the `output` fixture and `beforeEach`/`openEdit` helpers (ignoring the removed `mockCaptured` line). The file runs 1 passing test.
- **CSS.** None of the 10 removed classes (`section-heading`, `chart-section`, `chart-subsection`, `chart-type-*`) has a remaining user under `panel-detail-modal__` anywhere outside the archive. At base their only users were `ChartAppearanceEditor.tsx` and the stylesheet itself. `chart-label` and `color-swatches` were kept because `PanelDetailModal.css.test.ts:179/:186` pins them; files-modified.md and an inline CSS comment record that they now have no renderer.
- **Items 2/4 (pointers).** The grep in task 5.1 for `PanelCard.tsx`'s `filteredPaginationRows` and `PanelCard`'s own pre-existing finds nothing in `frontend/src`. I checked each new pointer against the code:
  - `OutputPanelContent.tsx:142` defines `filteredPaginationRows`.
  - `PanelCardBody.tsx:101` owns the `useOutputMeta(outputId)` passed to `usePanelSortFilter`.
  - `usePanelCardInspect.ts:37/103` owns the `useOutputMeta` and the only `useCrossFilteredPanelData` call.
  - `OutputKindFields.tsx:128-132/176` renders the `Chart type` select and `ChartDisplayFields`.
- **Spec delta.** `openspec validate panelcard-split-leftovers --type change` reports the change as valid. The main spec still carries the old wording, which is expected: the delta is applied at archive (tasks 4.1/5.1).
- **Constraints.** C1 is honoured (above). C2: all my runs were in the foreground with `nice -n 19` and `--maxWorkers=3`, and the full suite was split into shards.

Issue:
- **This diff creates 4 new stale pointers of the class the ticket exists to remove.** Deleting `PanelCard.test.tsx` leaves comments that cite it as the home of tests and conventions that now live in the split files. Design D4 and task 2.4 put same-class pointer fixes in scope, and the AC asks for grep proof for item 4, so this is a scope miss on the ticket's own goal. See CR1. A fifth hit, `PanelCard.inspect.test.tsx:15` ("rather than growing the already-large PanelCard.test.tsx further"), is historical rationale and does not point a reader at content, so it is a non-blocking suggestion.

### Phase 2: Code Review — PASS

I re-ran every gate on HEAD b3051d188 in WORKTREE_PATH (`CLEAN_WORKTREE` not set):
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0 ("All matched files use Prettier code style").
- `npm run typecheck`: exit 0.
- `npm --prefix frontend run build`: exit 0.
- Root jest (`nice -n 19 npx jest --maxWorkers=3`): 51 suites, 469 tests passed.
- Frontend jest (`nice -n 19 npx jest --config jest.config.cjs --maxWorkers=3 --shard=N/4`, N=1..4, all in the foreground):

  | Shard | Suites | Tests |
  |---|---|---|
  | 1 | 148 | 1746 passed |
  | 2 | 148 | 1480 passed |
  | 3 | 147 | 2014 passed |
  | 4 | 147 | 1820 passed |
  | Total | 590 | 7060, 0 failures |

- Targeted runs: the 3 split files plus `chartTypeDefault`, 37 tests passed. Base `PanelCard.test.tsx` at 290ab8a22: 36 passed.
- No backend files changed, so `sbt testFull` was not applicable.

Standards (CONTRIBUTING.md / DESIGN.md):
- No new code was added. The removals leave no unused imports: `useMemo` and the `ChartAppearance` type were dropped where they became unused, and lint is clean.
- The new comments follow the ticket-reference rule (HEL-1395 with the decision stated inline).
- No [mechanical] violations found.

### Phase 3: UI Review — PASS

Triggered by `frontend/**`.
- Servers were started with `start-servers.sh` (`PASS servers`) and stopped with `stop-servers.sh` (`STOPPED ports=6827,9734`).
- Throwaway user `hel1395-eval-…@example.test` (id ef94d0b2-…) was created through `/api/auth/register`. It was deleted by exact (id, email) with `buildUserDeleteSql`; a check afterwards found 0 user rows and 0 dashboard rows.
- **Happy path.** I opened the panel detail modal from the panel's actions menu, chose Customize and entered edit mode.
  - The Appearance section renders Title, Background, Text, Preview and Transparency, with no chart section, as at base.
  - I edited the title and content and saved. Content was PATCHed (200). The staged title change persisted on the existing staged-save path ("Eval text v2" was later shown on the card), and the modal returned to view mode.
- **Breakpoints.** At 768 px the edit-mode dialog is 540 px wide with no horizontal overflow. At 390 px it is 390 px wide with no overflow, and the title input is present.
- **Console.** No app errors during the flow. The only errors were the pre-login `/api/auth/me` 401s and a 403 from my own first register call, which lacked the CSRF header.
- No screenshots are cited as evidence, so none were persisted.

### Overall: FAIL

### Change Requests
1. Repoint the comments that now cite the deleted `PanelCard.test.tsx` to the split file that holds the cited content. These are comment-only edits:
   - `frontend/src/features/panels/ui/detailModal/PanelDetailModal.errorRetry.test.tsx:15`: "covered separately in PanelCard.test.tsx" → `PanelCardBody.test.tsx`. Its `PanelCard — error state retry (HEL-539)` block is at :151.
   - `frontend/src/features/panels/ui/editors/OutputControlsEditor.test.tsx:3` and `:214`: "see PanelCard.test.tsx's established convention" / "(PanelCard.test.tsx convention)" → `PanelCardHeader.refreshFullscreen.test.tsx`. Its comment at :209 states the "`@testing-library/user-event` is not a dependency" convention, and its focus/Tab assertions are at :239/:282/:357.
   - `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.kindLock.test.tsx:90`: "(see PanelCard.test.tsx)" → `PanelCardHeader.refreshFullscreen.test.tsx`.
   - Afterwards, run `git grep -n "PanelCard\.test\.tsx" -- frontend e2e docs` and record the result in files-modified.md under task 2.4. The only acceptable remaining hit is the historical one in `PanelCard.inspect.test.tsx:15`, unless it is reworded.

### Non-blocking Suggestions
- `PanelCard.inspect.test.tsx:15`: consider rewording to "rather than growing the then-large PanelCard test file" so it does not name a file that no longer exists.
- `PanelDetailModal.chartTypeDefault.test.tsx`: the describe title `PanelDetailModal initial chart state (HEL-1378)` no longer describes its one remaining test, which is about title-only save. It was left unchanged under the byte-identical rule. Renaming it (and possibly the file) could be a follow-up.
- `chart-label` / `color-swatches` CSS rules and their `PanelDetailModal.css.test.ts` locks now guard rules that nothing renders. A follow-up ticket could delete the rules and their locks together.
- The planner's follow-up candidate still stands: requirements 2-3 of `chart-type-config-editor` still name the panel edit pane.
