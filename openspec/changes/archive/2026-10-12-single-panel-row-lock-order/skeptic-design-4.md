## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at HEAD 968835477e67901a21c5d9fd8d22f7918a6558c3 (equal to origin/main after `git fetch`). The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/single-panel-row-lock-order/HEL-1498`.
- **Migration max:** after `git fetch`, `git ls-tree origin/main backend/src/main/resources/db/migration/ | sort -V` ends at `V127__dashboard_layout_version.sql`. D1 and C4 ("max + 1, V128 at planning time") still hold.

#### Round-3 CR1 (HEL-1526 version assertion): fixed

- The fix is option (c), recorded in design.md:113-123, tasks.md 5.3 and the delta spec `dashboard-contents-replace`.
  - The start order is named: gate first, then replace, then the create, in both runs.
  - The race spec asserts only `(None, None)` and that the panel and item sets match.
  - A separate non-racing spec covers the version.
- **Re-trace against the code: post-fix is green and there is no version assertion in the race.**
  1. `insertAndAppend` (`PanelLayoutPlacement.scala:42-56`) takes the dashboard `FOR UPDATE` and computes `CreatePlacement.append` from that locked read.
  2. Post-fix, replace holds the dashboard row before it blocks on the gate at its DELETE. The create therefore waits on the row.
  3. After replace commits, the create re-reads the latest row (READ COMMITTED re-check under `FOR UPDATE`) and appends to replace's layout.
  4. V127 then bumps the version again. That is why dropping the version check from the race is correct.
- **Pre-fix red:** unchanged from my round-3 trace. `DashboardContentsOps.scala:55-72` does an unlocked read, a DELETE blocked by the gate, then writes a computed layout over the create's committed item.
- **Non-racing version spec, red pre-fix:** pre-fix returns `existingDash.copy(layout = newLayout, ...)` (`DashboardContentsOps.scala:60,71`), so its `layoutVersion` is the pre-read value. V127 (`V127__dashboard_layout_version.sql:23-36`) bumps the stored version only when the layout value changes. See the non-blocking note on this.
- **Round-3 non-blocking notes, both adopted:**
  - Per-racer pid: a one-connection pool, or a per-pool `ApplicationName` (design.md:117-118).
  - The gate runs as superuser or schema owner (design.md:114).
- **C5:** the gate is a test session only. The production changes are D3's steps (1)-(6).

#### Fresh review: W1-W8 post-fix outcomes against D6's shared assertion

D6 says every W1-W8 race spec ends in `(None, None)` post-fix. D6 and task 5.1 also define `LockRaceSupport`'s strict `sqlState`: it returns `Some` for a `PSQLException` and rethrows anything else. I checked each writer's post-fix outcome after the gate's dashboard delete commits:

| Writer | Post-fix outcome | Evidence |
|---|---|---|
| W1 | Dashboard `FOR UPDATE` read returns `None`, so the result is `None` | D3 step (2) |
| W3, W4, W6, W7 | Delete proceeds; the panels are already gone | — |
| W5 | Succeeds | `deleteInternal` returns `None` or `Some(n)`, with no non-PSQL throw (`PipelineStepRepository.scala:1000-1033`) |
| W8 | Succeeds | Deletes by `inSet` with no row-count assertion (`WorkspaceTeardownRepository.scala:148-167`) |
| **W2** | **Fails with `NoSuchElementException`** | Traced below |

How W2 fails:

1. Post-fix, `batchUpdate`'s id-ordered `FOR UPDATE` over A and B waits on the gate's lock on A.
2. The gate deletes the dashboard, which cascades to A and B, and commits.
3. `FOR UPDATE` skips the deleted rows.
4. Each item's `SELECT` then finds no row, so the repo fails with `NoSuchElementException("Panel '...' not found")` (`PanelMutationRepository.scala:93-95`). That is not a PSQL error, so the strict `sqlState` rethrows it and the spec errors on correct code.

The service layer does not avoid this:

- `PanelBatchWrites.scala:61-66` turns every failure, 40P01 included, into `Left(BadRequest)`.
- So a spec at that layer cannot see the red, and the spec has to call the repository.

### Verdict: REFUTE

### Change Requests

1. **D6 and task 5.2: W2's post-fix assertion cannot pass on correct code. Specify W2's expected post-fix outcome.**
   - **Where:** design.md:110-111 ("pre-fix 40P01, post-fix `(None, None)`" for W1-W8) and tasks.md 5.2.
   - **What happens:** the D2 W2 fix runs `PanelMutationRepository.batchUpdate` against a dashboard the gate deleted. Post-fix it ends in `Failure(NoSuchElementException)` (`PanelMutationRepository.scala:93-95`). `LockRaceSupport`'s strict `sqlState` (D6, task 5.1) rethrows it, so the W2 spec errors after the fix. This is the same class of defect as the round-3 CR: a guaranteed false red that C3's red/green discipline cannot absorb.
   - **What to write into D6 and task 5.2:**
     - The gate side asserts `None`.
     - The writer side is asserted to be one of: a success, or a failure whose cause is exactly the repo's "Panel '<id>' not found" `NoSuchElementException`. No `PSQLException` is allowed, and any other non-PSQL error is still rethrown.
   - **Alternatives** (state which one is chosen):
     - Give `LockRaceSupport` an explicit per-spec "expected non-PSQL outcome" parameter, so the strict rethrow stays the default.
     - Have the W2 gate delete something other than the dashboard. If so, say what this does to the delta scenario "Dashboard delete racing a batch panel update in descending id order".
   - **Pre-fix red is unaffected:** with items in descending order, B is updated (row-locked) and then the update of A waits on the gate. The gate's cascade then waits on B, which is 40P01.

### Non-blocking notes

- **The HEL-1526 non-racing version spec must supply a layout different from the stored one.** V127 bumps `layout_version` only when the layout value changes (`V127__dashboard_layout_version.sql:23-36`). Replacing an empty layout with an empty layout would be green pre-fix, so the recorded red required by C3 would not exist. Worth stating in task 5.3.
- **D6 describes the create as "blocks on its own panel INSERT" (design.md:115-116).** That is the pre-fix wait. Post-fix, the create waits on the dashboard row that replace holds. Both are `wait_event_type = 'Lock'` on the create's pid, so the per-pid await covers both. The wording describes only one run.
- **The race specs call `replaceContents` with `Some(layout)` pre-fix and a required `DashboardLayout` post-fix.** The specs need a trivial signature edit between the recorded red and the green run, which is fine. The PR evidence should note it so the "red then green on the same spec" claim stays honest.
