## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `0fa5e42798a9190b904e8e868d0742cf4ceba05a`.
- Diff base: the live `resolve-review-base.sh` result, `96ed5156b`, which is the merge-base after `git fetch origin main`.
- `origin/main` has since moved to `6e334120a` (HEL-1754). `git merge-tree` of HEAD with `origin/main` is clean.
- Cycle-2 commits:
  - `2cd213560`, a merge of `origin/main`. `diff <(git diff 5bd0e7f94 953b47343) <(git diff 96ed5156b 2cd213560)` is empty, so the merge carries no extra changes of its own.
  - `0fa5e4279`, the fixes for CR1, CR2 and CR3.

Fresh gate runs, by me, in `WORKTREE_PATH`:

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | clean |
| `npm run typecheck` | exit 0 |
| `npm test` (3 workers, `nice -n 19`) | exit 0. Root: 66 suites / 579 tests. Frontend: 793 suites / 9686 tests. All passed. |
| `npm --prefix frontend run build` | exit 0 |
| `sbt -J-Xmx3g testFull` (`nice -n 19`) | `Suites: completed 709, aborted 0`. `Tests: succeeded 9688, failed 0, canceled 5`. `All tests passed.` I read the summary lines, not just the exit code. |

No live Anthropic call was made, and no converse request was sent.

### Phase 1: Spec Review — PASS

No AC or scope change since cycle 1. All tasks are still checked.
- Constraints C15 to C18 and C20 are all honored.
- The shared files are still untouched by this branch: `git diff --name-only 96ed5156b...HEAD` shows no change to `shared/ui/Select.tsx`, `selectPanelFit.ts`, `panelFit.ts`, `shared/chrome/ActionsMenu.*` or `hooks/usePortalPopover.ts`.

### Phase 2: Code Review — PASS

**CR1 (C13 mutations): verified.** `evidence/red-first.md` now records mutations a to h3 plus `ev`, each with the failing assertion. I re-ran a sample myself. I worked in a throwaway detached worktree at `0fa5e4279` under the lane scratch directory, reverted every mutation, then removed the worktree. All five went red with exactly the failure counts recorded:

| Mutation | Result |
|---|---|
| (a) `m.copy(model = Some(answered))` → `m.copy(model = None)` in the converse route | `AssistantModelSelectionRoutesSpec`: 3 FAILED, `Tests: succeeded 14, failed 3`. The failures were the stamp test, the two-model sequence test and the non-catalog server-default test. |
| (d1) weight SQL `message_count + $weight <= $limit` → `message_count < $limit` | `AssistantDailyUsageRepositorySpec`: 2 FAILED, `succeeded 11, failed 2`. The failures were "3 units left" and "concurrent weighted". |
| CR2 red: gate `composerPickerModel` on `serverDefault` instead of `defaultModel` (the cycle-1 behaviour) | `modelOptions.test.ts` + `ModelPicker.test.tsx`: 3 failed, 13 passed. |
| (h2) `modelLabel={undefined}` in `ActiveConversationPanel` | 1 failed, 22 passed. |
| (ev) drop the `modelError` reset in `selectConversation.pending` | 1 failed, 41 passed. |

The executor also argues that the `ModelPicker` optimistic `defaultModel.id` vs `serverDefault.id` is an equivalent mutant. That argument is correct: the option exists only when `defaultModel` is not selectable, and `defaultFor` then returns the server default.

**CR2 (honest clear option): fixed.**
- `composerPickerModel` now offers "Server default (<id>)" only when `defaultModel` is not selectable.
- A clear's optimistic value is now `defaultModel.id`.
- Verified in the running app (Phase 3).

**CR3: fixed.** The `CLAUDE_MODEL` row again names the prod pin (`cd-backend.yml`, `infra/deploy-backend.sh`) and HEL-1636. Both pins still exist, at `cd-backend.yml:101` and `deploy-backend.sh:123`.

**Cycle-1 non-blocking suggestion, also done.** `modelError` is now cleared on `selectConversation.pending` and on `startNewConversation`, and a test covers it.

No new issues in the cycle-2 diff:
- Tokens only.
- No dead code.
- The test names describe the behaviour they guard.

### Phase 3: UI Review — PASS

Lane servers were started with `start-servers.sh`, and `assert-phase.sh servers` passed. I logged in with the dev account.

- **CR2 with a saved default (Settings default = Sonnet 5.5).** On an existing conversation the composer picker lists exactly Haiku 5.5, Sonnet 5.5 (selected) and Opus 5.5. There is no "Server default" option, so nothing can snap back. Screenshot (dark, desktop, 1440): `/home/matt/Development/helio/.concertino/runs/HEL-1755/evidence/openspec/changes/assistant-model-picker/evidence/eval2-picker-saved-default-dark-desktop.png`
- **No saved default.** The list starts with "Server default (claude-opus-4-8)". Picking Haiku 5.5 and then Server default left `model: null` and `effectiveModel: claude-opus-4-8`, and the picker showed "Server default (claude-opus-4-8)". The clear is honest end to end.
- **Placement after the HEL-1750 merge.**
  - Desktop (1440, dark): the listbox opens upward above the trigger and stays within the composer column.
  - Phone (390, light): all four options are fully inside the viewport and clear of the bottom nav, with the trigger 44px tall beside Send. Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1755/evidence/openspec/changes/assistant-model-picker/evidence/eval2-picker-open-light-phone.png`
  - In cycle 1 I also checked light desktop, dark phone, 768 and 1100, and those were unaffected. This cycle changes only option membership, not styling.
- **Console:** no errors in the tested flows.
- **Dev state restored:**
  - The `assistantModel` preference is back to unset.
  - Conversation `c0d91cba-adf8-43ad-89f7-4d7b1fc6d551` is back to `model: null`.
  - Theme is back to dark.
  - The browser is closed and the servers were stopped with `stop-servers.sh`.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `composerPickerModel` now builds the option for a non-selectable effective model as `{ id: effectiveId }` with no label, so a catalog server default that has been narrowed out shows its raw id (e.g. "Server default (claude-opus-5-5)") rather than "Server default (Opus 5.5)". That is cosmetic; using `models.serverDefault` there when the ids match would keep the label.
- The Flyway ordering hazard from cycle 1 still stands. V140 can merge ahead of the reserved V138/V139, and the backend has no `outOfOrder` setting. This is for the driver to coordinate with the HEL-1740/1742 lanes.
- Process note: the shared Playwright browser was sitting on another lane's page (`localhost:7172/pipelines/...`) when this review started. Navigating away from it may have interrupted that lane's session.
