## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 968835477e67901a21c5d9fd8d22f7918a6558c3. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/single-panel-row-lock-order/HEL-1498`.

- **Owner answer:** `.concertino/runs/HEL-1498/events.jsonl` has the escalation answer on lines 12-13.
  - Line 12 is `escalation.answered`, answer `adopt-skeptic-fix`, `answer_source: human`, id `HEL-1498-1791865415742-1af7c7`. Line 13 is the matching dashboard-channel record.
  - C5 in `workflow-state.md` records it, and so does design D6 (line 112).

- **Round-2 CR2 (stale V129 text): fixed.**
  - D1's header now reads "max-on-origin/main + 1, C4" (design.md:37).
  - The only remaining "V129" is the hypothetical in the C4 rationale (design.md:48), which is correct as written.
  - The risks entry (design.md:127-129) and C2 (tasks.md:4) now describe the hazard correctly: a duplicate V128 with a different checksum.
  - "renumber if needed" is gone.
  - After `git fetch`, `git ls-tree origin/main` still shows V127 as the max migration.

- **Round-2 CR1 (HEL-1526 gate): the gate is sound, and it goes red before the fix and green after.** I traced it against the code.
  - Pre-fix `replaceContents` (`DashboardContentsOps.scala:55-72`) runs in this order:
    1. An unlocked `SELECT` of the dashboard (ACCESS SHARE).
    2. `DELETE FROM panels WHERE dashboard_id` (ROW EXCLUSIVE). This conflicts with the gate's SHARE lock, so replace blocks here and holds no dashboard-row lock.
  - `insertAndAppend` (`PanelLayoutPlacement.scala:47-56`) runs in this order:
    1. The dashboard `FOR UPDATE`, which is granted.
    2. The panel INSERT (ROW EXCLUSIVE), which blocks on the gate.
    3. The layout UPDATE.
  - **Pre-fix, after the gate commits:**
    - Both ROW EXCLUSIVE requests are granted, since they are mutually compatible.
    - Replace's DELETE runs at once. Its snapshot cannot see the create's insert, because that row is not yet committed. It deletes 0 rows, so V122 locks nothing.
    - Replace's INSERT then hits the `dashboard_id` FK check. That check needs KEY SHARE, which conflicts with the create's `FOR UPDATE`, so replace waits.
    - The create inserts, appends its item and commits.
    - Replace's UPDATE writes its supplied layout over the latest row version. The item is lost while the panel row survives: **red**, as D6 says.
    - There is no deadlock: the create never waits on replace.
  - **Post-fix (D3 order), after the gate commits:**
    - The lock function's `FOR UPDATE` needs only ROW SHARE, which is compatible with SHARE, so it passes the gate.
    - Replace's dashboard `FOR UPDATE` is granted. Its DELETE blocks on the gate.
    - The create blocks on the dashboard row. That is a tuple/transactionid wait, which the per-pid check still sees as `wait_event_type = 'Lock'`.
    - Once the gate commits, replace finishes and commits. The create then re-reads the row and appends to replace's layout: **green**.
  - **The racers can start in either order.** If the create starts first:
    - Pre-fix the outcome is the same red.
    - Post-fix, replace waits on the dashboard row behind the create. Its DELETE then sees the committed panel and removes it, and the V122 trigger strips the panel's item, so the end state is still consistent: green.
  - **Per-racer detection is needed and is specified.** The current `awaitLockWait` (`DashboardDeleteRacesPanelDeleteSpec.scala:70-82`) counts any waiting session.
  - **C5 holds.** The gate is a test session only. Production code is limited to D3: required layout, the panel lock, the dashboard `FOR UPDATE`, the computed layout write, and the re-read.

- **D3's window wording is corrected** (design.md:73-76). The window now runs from the unlocked read to replace's first dashboard-row lock, which is the FK check, and the `dashboard_id` FK check fires before the `output_id` check.

- **Re-checked the W1 race shape** (the gate holds A `FOR UPDATE`; the dashboard delete cascades):
  - Pre-fix, the scan locks B and then waits on A, while the gate's cascade waits on B. That cycle is 40P01.
  - Post-fix, the function waits on A first, skips the deleted rows, the dashboard read returns `None`, and the result is `(None, None)`.
  - This is consistent with D6.

### Verdict: REFUTE

### Change Requests

1. **The HEL-1526 green assertion contradicts the interleave D6 describes. Specify the racer start order, or what "stored" means.**
   - The conflicting text is design.md:118-119 ("the returned `layoutVersion` equals the stored one"), tasks.md 5.3 ("returned layoutVersion current") and the D6 interleave itself.
   - D6 reads as replace starting first: the gate blocks replace, and then the create takes the dashboard `FOR UPDATE`.
   - With that order, post-fix replace commits first at layout_version v and returns v. The create is then unblocked and appends its item.
   - V127's trigger (`V127__dashboard_layout_version.sql:28-29`) bumps the version to v+1 on that layout change.
   - A test that compares the returned version with the stored row after both racers finish therefore fails on correct post-fix code. A guaranteed false red is exactly what C3's red/green discipline cannot absorb.
   - Pick one of these and write it into D6 and task 5.3:
     - (a) Start the create first. Await its lock wait at the panel INSERT, then start replace and await its wait (pre-fix: the DELETE; post-fix: the dashboard row). Replace then commits last on both pre-fix and post-fix code, so returned == stored is valid.
     - (b) Keep replace first, and assert returned == stored - 1, the version from replace's commit, with the create's bump accounted for.
     - (c) Drop the version check from the race spec. Prove the "Response carries the current layout version" scenario in a separate, non-racing spec.
   - Whichever is chosen, also state the order for the pre-fix run. Both orders are red pre-fix, per my trace above.

### Non-blocking notes

- **How each racer's pid is obtained is unspecified.** Both racers run production repository code on pooled connections: replace on the privileged pool and the create on the app pool. To await "each racer's lock wait", the spec needs each racer's backend pid. Two workable options:
  - one-connection pools whose pid is read before the race;
  - a distinct `ApplicationName` per pool, matched in `pg_stat_activity`.

  Record which one, so `LockRaceSupport` can be built once.
- **The gate session needs the right privilege.** `LOCK TABLE ... IN SHARE MODE` requires UPDATE, DELETE or TRUNCATE on `panels`, so use the superuser connection or the schema owner for the gate.
- **A residual flake path exists in the pre-fix red.** If the create could INSERT, UPDATE and COMMIT before replace's DELETE takes its snapshot, the pre-fix run would delete the new panel and look consistent. That needs several JVM round-trips to beat one server-side statement that is already granted, so it is negligible. If the recorded red ever comes out green, this is the reason; it is not a broken fix.
