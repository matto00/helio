## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed at HEAD 968835477e67901a21c5d9fd8d22f7918a6558c3. After `git fetch`, this is equal to origin/main. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/single-panel-row-lock-order/HEL-1498`.
- **C4 (migration number):** after `git fetch`, `git ls-tree origin/main backend/src/main/resources/db/migration/ | sort -V` still ends at `V127__dashboard_layout_version.sql`. "V128 at planning time" still holds.
- **design.md is 149 lines** (`wc -l`), within the 150-line cap.

#### Round-4 CR1 (W2 post-fix outcome): fixed

The fix is at design.md:109-114, tasks.md 5.2 (line 42) and task 5.1.

- **The design text** now says:
  - W2's race drives the repo `batchUpdate`, not `PanelBatchWrites`.
  - The gate side must be `None`.
  - The writer side must be either a success or exactly `NoSuchElementException("Panel '<id>' not found")`.
  - Any other non-PSQL error is rethrown.
  - Every other writer must end `(None, None)`.
- **The message matches the tree.** `PanelMutationRepository.scala:94` is `DBIO.failed(new NoSuchElementException(s"Panel '${item.id}' not found"))`.
- **The red is hidden at the service layer, as the design says.** `PanelBatchWrites.scala:63-67` turns every failure into `Left(BadRequest("Batch update failed"))`.
- **Pre-fix red, re-traced (items in order B, A):**
  1. The item action for B selects B without a lock, then UPDATEs B, which row-locks it.
  2. The item for A then UPDATEs A and waits on the gate's `FOR UPDATE` of A.
  3. The gate's dashboard delete cascades to B and waits on the writer. That is a cycle, so 40P01.
- **Post-fix green, re-traced:**
  1. The id-ordered `FOR UPDATE` waits on A.
  2. The gate commits. READ COMMITTED skips A and B as deleted.
  3. The per-item `headOption` sees `None`, so the repo raises the not-found exception.
  4. That outcome is in the accepted set, so the spec passes.
  - The spec can still go red because the 40P01 is a `PSQLException` on one side.

#### Content preserved through the reflow

I checked every item the earlier rounds required against the current text.

**Round 1:**
- CR1, zero-panel dashboard: D3:69-73, D6:115-116.
- CR2, W3 as one transaction: W table row W3; D2:57-60; task 3.3.
- CR3, exact max+1: D1:42-47.
- CR4a, `PatchSetApplyTypes.scala:86-89`: D4:94.
- CR4b, `RETURNING id`: D2:59.
- Notes:
  - `CURRENT_USER` grant: D1:38.
  - W7 fixture: D6:131-132.
  - Ownership before the lock: D2:61, 63.
  - Per-edit pending ids: D4:85-86.
  - The 250-line budget holds after the overlay: D5:101-102.

**Round 2:**
- CR1, SHARE gate and window wording: D3:71-73, D6:116-122.
- CR2, stale V129: the only remaining "V129" is the C4 hypothetical at D1:43.
- Note, W2 as one `ORDER BY id` statement: D2:56.

**Round 3:**
- CR1: the start order is named, the race asserts no version, and the version has a separate spec (D6:116, 124-128).
- Notes:
  - Per-racer pid via a one-connection pool or `ApplicationName`: D6:121-122.
  - The gate runs as superuser or schema owner: D6:117.

**Round 4 notes:**
- The version spec uses a layout different from the stored one: D6:126-128 and task 5.3.
- Post-fix, the create waits on the dashboard row: D6:119-120.
- The signature edit between the red and green runs is recorded in the PR evidence: D6:128-130.

I found no lost content.

#### Fresh spot checks against the tree

- **`DashboardContentsOps.scala:55-72`:**
  - The dashboard read is unlocked, and `layout.getOrElse(existingDash.layout)` is the dead `None` branch.
  - It returns `existingDash.copy(...)`, which carries the pre-read `layoutVersion`.
  - V127 bumps the version only when the layout changes. So the non-racing version spec, using a different layout, is red before the fix and green after D3's re-read.
- **`DashboardContentsService.scala:98`** is the sole main caller, and it passes `Some(layout)`.
- **The ghost-layout guards** are at `PatchSetPreviewGhostLayoutSpec.scala:73` ("still reject a layout that overlaps...") and `:79` ("leave the layout unfiltered on a rename-only update..."). Both match task 6.3.
- **`PatchSetPreviewProjection.scala` is 403 lines**, which confirms the split is needed.
- **The binding inputs agree with each other.** proposal.md, the four delta specs, tasks.md and C1-C5 do not contradict design.md. All of AC1-AC8 map to tasks:

  | AC | Tasks |
  |---|---|
  | AC1 | 2.x, 3.x |
  | AC2 | 5.2 |
  | AC3 | 3.5 and the teardown delta |
  | AC4 | 4.x, 6.x |
  | AC5 | 1.x |
  | AC6 | 5.1, 6.3 |
  | AC7 | 3.1, 5.3 |
  | AC8 | C3/C4 |

### Verdict: CONFIRM

### Non-blocking notes

- **AC2's wording vs W2:** AC2 says "both sides `None`, no error" after the fix. W2's accepted post-fix outcome can be the not-found failure. AC2 needs only "at least one multi-panel writer", and W1 or W3 meet it literally, so this is not a defect. The PR body should still say that W2's not-found is the correct post-fix outcome, so a reader does not take it as a broken AC.
- **W2 fixture:** the pre-fix red needs both batch items to carry a real patch (for example a title). An item with no title, appearance or config issues only a SELECT and takes no row lock.
- **Task 3.6:** removing `PipelineStepRepository.delete` breaks `PipelineStepRepositorySpec.scala:213`, which calls `stepRepo.delete`. That test has to be removed or redirected in the same change. The compile will force it, but it is worth naming.
