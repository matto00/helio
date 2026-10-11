## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at HEAD `dae4bc4516791452ad5b3e27e871d39771bbd5a6`. The change dir is untracked, so there is no code diff yet. I reviewed the artifacts against the live code. origin/main has moved one commit since then (a29a7e5, a frontend-only change in usePipelineDetailPage). It touches nothing in this plan.

### What I verified (with evidence)

**Owner rulings**
- `.concertino/runs/HEL-1456/events.jsonl` line 7 holds the escalation questions, and line 8 holds `escalation.answered` with `sub_answers ["approve-v123","server-filter"]`, `answer_source: human`.
- The Q2 text defines server-filter as "DashboardService layout writes drop items whose panelId is not a panel of that dashboard". D5 implements that ruling and nothing more.

**Round-3 CR1 (filter the merged layout, not only the supplied breakpoints): closed**
- D5 and task 1.6 now filter BOTH `existing.layout` (all four breakpoints) AND the patch, via `DashboardRepository.panelIdsInternal`. That lookup is unpaged and runs in the system context (DashboardRepository.scala:181-184), so it is the right one.
- `DashboardWrites.applyUpdate` (DashboardWrites.scala:36-58) is the single merge point for both the `Validate` and `RestorePriorStored` policies. Filtering there covers both.
- `LayoutPolicy.sameItems`, `violations` and `merge` (LayoutPolicy.scala:52-88) run against whatever `existing` is passed in. With the filtered existing, the stored-bad-plus-ghost edge disappears, as D5 states.
- `LayoutValidator` violations are only Overlap and OutOfBounds, so a filtered subset of a valid breakpoint cannot newly 400.
- Task 3.9 requires a stale-existing test that is RED against a supplied-only filter.
- D6 is now consistent with D5 for layout-bearing PATCHes. There is one residual on a path with no layout in the PATCH; see the notes below.

**Round-3 CR2 (undo refused after the trigger strips a deleted panel): closed, and the fix is sound**
- Today `checkDashboard` (PatchSetUndoConflictCheck.scala:114-126) requires `live.layout == journaled.layout` exactly. My round-3 analysis of `[update D, delete P on D]` stands, and D7 now names it.
- **Is D7 sound?** It restricts both layouts to the panel ids on D at check time. The only items it stops comparing are items for panels that no longer exist on D, and a position for a non-existent panel carries no user intent.
- **Does it hide a real conflict?** I enumerated the cases:
  - A user moved a live panel Q after the apply. Q is current, so the conflict is still caught.
  - A user created panel Q after the apply. Q's item is in live but not in journaled, so the conflict is still caught. This is the same as today.
  - A user moved Q and then deleted Q. Before this change, undo was refused. After it, undo proceeds and restores a prior layout from which D5 drops Q. Nothing is lost, because Q no longer exists.
  - `[update D, create Q on D]` is still refused, as it is today. D7 does not change this pre-existing class.
- **Do the reads compose correctly?** Phase-1 runs before any undo action, so "current ids" does not include a recreated panel P'. `findById(…, Some(user))` confirms access before the privileged `panelIdsInternal` read, which matches that method's documented contract.
- **Is item order a problem?** Filtering preserves order, so the exact-equality semantics on live items are unchanged.
- **Conclusion:** D7 weakens the check in no way that matters.
- **Scope:** it is a minimal patch-set edit, and the brief's re-sync with HEL-1482 is tasked in 1.6a.

**Round-3 CR3 (task 3.9a vacuous): closed**
- Task 3.9a now names `[delete P on D, update D]` followed by undo, and the same pair plus a failing edit for rollback. Both must assert `restored` / `rolledBack`.
- I checked both sequences against code:
  - The `prior` of `DashboardUpdate` is resolved before any edit applies.
  - Restore goes through `fullDashboardInverse` with `RestorePriorStored` (PatchSetUndoService.scala:183-193, PatchSetApplyRollback.scala:103-107). These are full four-breakpoint restores that include P, which D5 filters.
- Without the fix, the restore stores P as a ghost, so both tests are RED today.
- Patch-set edits commit separately (no `transactionally` in services/patchsets), so `panelIdsInternal` sees panels committed by earlier edits.

**Round-3 non-blocking notes**
- The lookup is now named (`panelIdsInternal`).
- The AutoLayout stale-read residual is recorded in the Planner Notes and in task 1.7.
- The spec now states that unknown ids are "silently dropped".
- Seam test 3.10 now asserts adoption and that pending is cleared.

**Other checks**
- V121 is the newest migration on both the worktree and origin/main, and no sibling worktree holds V122 or above, so V122 and V123 are free.
- The V100 bracket and `helio_privileged` BYPASSRLS precedent exist (V100 lines 17-29, 88).
- Dashboard-delete cascade: when the trigger fires, the dashboard row has already been deleted in the same transaction. `FOR UPDATE` finds nothing and no update happens, which is benign. Task 3.5 pins it.

### Verdict: CONFIRM

### Non-blocking notes
- **Appearance-only PATCH residual (D5/D6 wording).** `writeUpdate`'s no-name branch writes `existing.layout` even when the PATCH carries no layout (DashboardWrites.scala:87-93). The full-row update is at DashboardRepository.scala:164-175.
  - If the filter is applied only when `layoutPatchOpt` is `Some`, an appearance-only PATCH whose unlocked read predates a delete commit can still write the stripped ghost back. That makes D6's "a stale PATCH can no longer restore a ghost" overbroad.
  - The impact is small: the window is milliseconds, it is the HEL-1457 class, and the next layout PATCH heals it because D5 filters existing.
  - Executor: either apply the existing-side filter whenever the no-name branch writes a layout, or narrow D6's sentence to layout-bearing PATCHes. Rename branches re-read the row, so they are unaffected.
- Task 3.9 would be stronger with a panel created by an editor (not the owner) on the owner's dashboard, followed by an owner PATCH. That pins that the filter's lookup is never RLS-scoped.
- D7 should call `panelIdsInternal` only after `findById` returns `Some`, so the privileged read stays behind the access check.
