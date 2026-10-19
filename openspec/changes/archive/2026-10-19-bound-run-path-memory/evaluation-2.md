## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: 83359b0009f8ebb318ec5fc83c366cc60a0ff351 (cycle-2 delta reviewed against d21a78a86). The scope is still backend and openspec only.

### Phase 1: Spec Review — PASS
- The cycle-1 change request (CR1) is resolved:
  - `RunPathHeapSpec` is now opt-in (`assume(HELIO_MEASURE == "1")`). It cancels in `testFull`; I confirmed this in my run.
  - `MaxLiveCells` is now 2,600,000.
  - `RunLimitsGuardSpec` is the deterministic guard that runs in CI.
- AC6 as the ticket amended it ("Outputs on a middle node and the terminal", owner-accepted `accept-50kx6`) is met: 50,000 x 6 CSV, 10-step chain, both snapshots written. The tail-Output case moved to a separate 2,000-row test. That test still proves an Output on a non-trunk branch keeps its frame (`empty-retain-from-executor` turns both tests red).
- C1 holds. The ruled numbers are unchanged and `RunLimitsGuardSpec` pins them. 2,600,000 is within owner ruling 3 (at most 25% of 768 MB).

**Point 1. Does a three-Output 50k x 6 pipeline being refused need an escalation? No. It is a disclosure item, not a blocker.**
- The ticket's AC6 is the owner's own operational definition of "ordinary pipelines still fit" for ruling 3. It names two Outputs, and the owner accepted it at design round 1. Owner ruling 6 also accepts clean failure of pipelines over the caps.
- The margin-driven move from 3.0M to 2.6M therefore stays inside both the AC and the rulings. Nothing here contradicts or is ambiguous between the ticket and the spec in a way that would call for an ESCALATION.
- The owner should still hear the concrete consequence as a fact, in the PR body and the delivery summary: at the largest accepted CSV (50,000 x 6), a widening compute chain can keep about two non-terminal Output frames before the run is refused with a clean "Pipeline run memory limit" error. A third Output on that shape is refused, although it fit at the cycle-1 value of 3.0M.
- This is a capacity-versus-margin trade made inside ruling 3, so it should be visible and not buried. If the owner later wants more Output capacity, the lever is a re-measured `MaxLiveCells` or pricing that excludes released frames. That would be a follow-up, not a defect here.

### Phase 2: Code Review — PASS
Gates (fresh, run by me, under the sbtfull lock):
- `sbt testFull`: **Tests: succeeded 9368, failed 0, canceled 5**, EXIT=0. The new cancel is the opt-in `RunPathHeapSpec`, and the count matches `green-testfull-cycle2.summary.txt`.
- No frontend change, so the frontend gates do not apply.

**Point 2. AC6 margin argument: sound.**
- AC6's heap is independent of the budget: it holds 2,400,000 cells whatever the budget is, as long as it fits. Lowering the budget therefore cannot reduce its peak, and only a re-measure could raise it.
- Its two modes, about 150 and about 173 MB, both appear in the samples: 5 real-run samples across the executor's runs and mine (173.0, 150.4, 173.4, 149.8, 172.4). The worst observed is 173.4 MB, already the top mode, which leaves 18.6 MB under 192 MB.
- The rule "the worst budget-dependent shape ≤ 192 − largest swing (23.6)" correctly applies to the shapes that do depend on the budget. Just-under-light at 2.6M is 158.5 MB across 3 identical repeats, under 168.4 MB.
- One honest caveat for the record: AC6, not the just-under shape, is now the measured worst case, and its 173.4 MB rests on 5 samples, not on an applied margin.
- None of these numbers is asserted in CI any more, so the remaining risk is to the production heap target, not to flaky gates. That is acceptable for a measured, not proven, budget, the same standing as HEL-1630's `DraftPreviewHeapSpec` number.

**Point 3. Raw `mutation-*.log` files deleted: acceptable, with a durability note.**
- The logs were gitignored (`*.log`) and never persisted, so they could not have outlived the worktree anyway.
- In cycle 1 I spot-checked three of the original logs (memory-budget, d7-drop-soe-exemption, empty-retain-from-executor). Each recorded the exact source edit and a real `*** FAILED ***`.
- The three new guard mutations are valid by inspection of `RunLimitsGuardSpec`. A budget below 2.4M fails `peak(0)`, a budget above 2.6M fails the ceiling check, and a changed row cap fails the ruled-number check.
- `mutations.md` still records the file, the specs and the failing test names. It no longer records the old/new edit text for each mutation (see suggestion below).

Other checks:
- `RunLimitsGuardSpec` is deterministic: no GC, a pure `LiveCellTally` calculation.
- The `RunPathHeapSpec` repeat and `only` knobs exist only for measurement.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` change.

### Overall: PASS

### Non-blocking Suggestions
- `RunLimitsGuardSpec.scala`: the test name "refuse it one 50,000-cell column wider" and the class doc "while a wider one is refused" are inaccurate at 2.6M. The probe adds `MaxLiveCells - 2,400,000 + 1` = 200,001 cells. A pipeline one 50,000-cell column wider (2.45M) actually fits; about 4 columns of headroom remain. Rename it to something like "refuse it once the walk passes the budget by one cell".
- `evidence/mutations.md`: add the one-line old/new edit to each entry, as the deleted logs' headers had. The index would then be enough on its own to reproduce each mutation.
- Carried over from cycle 1: the PR description should propose a split of `InProcessPipelineEngine.scala` (1006 lines), and should note that an Output created mid-run gets no snapshot from that run (D3).
- Add the Point 1 capacity fact to the PR body (see Phase 1).
