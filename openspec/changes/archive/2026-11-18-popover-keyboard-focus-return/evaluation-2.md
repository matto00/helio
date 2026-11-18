## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD 28fe1068cfc9c07d8448cfaf49a3434cd360ffd7 (the cycle-2 delta 478e5a24c..28fe1068c, on base 9054da2a6). My scratch files are in /home/matt/Development/helio/.concertino/scratch/HEL-1759/eval2/.

### Phase 1: Spec Review — PASS
- Cycle-1 CR1 is resolved. tasks.md 5.4 now cites the evaluator's persisted comparison and screenshot paths, and that evidence is real (evaluation-1.md, Phase 3).
- C16: files-modified.md's shared-file diff is byte-identical to `git diff 9054da2a6..HEAD -- frontend/src/hooks/usePortalPopover.ts`, ignoring `index` lines (checked by script).
- No new scope. Every non-retired CONSTRAINT is honoured in the diff.

### Phase 2: Code Review — PASS
I ran the gates fresh in WORKTREE_PATH:
- lint: EXIT 0
- format:check: EXIT 0
- typecheck: EXIT 0
- jest (maxWorkers 3): 579 root tests and 9757 frontend tests passed, EXIT 0. The frontend count is one more than cycle 1, which is the new unit case.
- frontend build: EXIT 0

**Tab-flag expiry (`usePortalPopover.ts` onKeyDown, `setTimeout(0)`).** The executor claimed a microtask would clear the flag too early. I checked this in a real browser and it holds. On the running app (Chromium, localhost:7191, HEAD 28fe1068c), I added probe listeners to the document. On a Tab keydown, each listener queued one microtask and one `setTimeout(0)`; a separate listener logged focusout. I then opened the actions menu and pressed Shift+Tab. The order was:
1. keydown, with focus on Rename
2. the microtask, with focus still on Rename
3. focusout, from Rename to the next button
4. the `setTimeout(0)`, by which point focus was already back on the trigger

So a microtask expiry would run before the focus move and break the feature. One timer tick runs after the move.
- Evidence: /home/matt/Development/helio/.concertino/runs/HEL-1759/evidence/.concertino/scratch/HEL-1759/eval2/tab-timing-probe.txt
- The timer is cleared on every keydown and in the effect cleanup, so there is no leak and no stale clear after the popover closes.

**New unit case** ("does not refocus the trigger for a Tab that moved no focus (the flag expires)"). It sends a Tab keydown with no focus move, waits 5 ms, then moves focus programmatically. Without the expiry the flag would still be set and focus would bounce back to the trigger. Mutation M7 (expiry removed) turns exactly this test red (scratch mutations.txt).

**e2e changes.** The phone editor cases now use `test.skip` with a stated reason. A new per-theme test asserts that the editor trigger is hidden at 390. The comment wording is corrected to "rendered but hidden".

### Phase 3: UI Review — PASS
- e2e on this lane's ports (DEV_PORT=7191, 2 workers): I ran hel1759, hel1756, hel1750, hel1003, hel1090, hel1085 and hel1572. 59 passed, 4 skipped, EXIT 0.
  - The 4 skips are exactly the phone editor cases (2 cases x 2 themes).
  - Both "trigger hidden" tests passed, as did every desktop editor case and the actions-menu cases at desktop and phone.
- Live check: Shift+Tab out of the actions menu closes it and focus lands on its trigger (probe above).
- Console: the 3 errors seen were 401s from the browser's stale session of my already-deleted cycle-1 user, logged before re-registering. None came from the tested flows.
- Throwaway user a2aebe45-97b3-42eb-ae2d-d16ccf0c2623 was deleted by exact id via deleteRecordedUsers ("deleted 1").

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `PHONE_EDITOR_REASON` says the trigger is hidden at 768 and 390, but the hidden-trigger test only asserts 390. Either add 768 to the test or drop 768 from the reason.
- Process disclosure: during this review I ran one `pgrep -c` with a nonsense pattern. It was a no-op count with no side effects, but it is outside C3's letter. Nothing was killed.
