## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 968835477e67901a21c5d9fd8d22f7918a6558c3 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed READY, branch `bug/single-panel-row-lock-order/HEL-1498`.

**Round-1 CR2 (W3 as one transaction): fixed.**
- D2, the W table and task 3.3 now specify `OutputRepository.deleteWithPanelsInternal`: lock, then `DELETE ... RETURNING id`, then the output DELETE, all in one system transaction.
- In the tree, `OutputService.scala:243-244` is the only main caller of `deleteByOutputIdInternal`.
- `outputRepo.deleteInternal` keeps test callers (`OutputHistoryPublicRoutesSpec:153`, `PublicProvenanceRoutesSpec:229`, `PatchSetUndoPanelDashboardSpec:187`). The design only removes `deleteByOutputIdInternal`, so those callers are unaffected.

**Round-1 CR3 (migration number): fixed in substance, with stale text left behind.**
- C4 is recorded in `workflow-state.md`, `tasks.md` and D1's body, and task 2.1 says `V<max+1>`.
- `git fetch` followed by `git ls-tree origin/main` shows the max is still V127.
- Stale text remains: D1's header still reads "(V129 planned)" (design.md:37). See CR2.

**Round-1 CR4: fixed.**
- (a) `PatchSetApplyTypes.scala:86-89` is `priorStateJson` / `toOutcome`, confirmed.
- (a) `PatchSetApplyService.scala:92-98` is `staleTargets`, and `:202` is the journal `priorState`, both confirmed.
- (b) "RETURNS void" and "RETURNING id" are reconciled.

**Round-1 non-blocking notes: all addressed.**
- `GRANT EXECUTE` now goes to `CURRENT_USER`.
- The W7 fixture constraints are recorded.
- Pending ids are per edit.
- The file budget is required to hold after the overlay too.
- Ownership before lock: I checked each service.
  - `PipelineService.delete:130-135` runs `findByIdOwned` before the repo delete.
  - `PipelineRootWrites.removeRoot:166-174` runs `findByIdShared` plus the editor check first.
  - `DataSourceService` runs `findReferences` and an owned lookup before `deleteAfterPrecheck`.
  - So placing the lock after the service checks, as D2 says, is achievable.

**Other citations re-verified:**
- `HistoryThinBatching.scala:42` (text-array `SetParameter`).
- `PanelLayoutPlacement.scala:47` (`forUpdate` on the dashboard row).
- `CreatePlacement`, `StepPlacement`, `LayoutCasRetry`, and `defaultSizesFor` (used in `PanelLifecycleWrites`/`PanelBatchWrites`).
- `PatchSetPreviewProjection.scala` is 403 lines, and `PipelineStepProjectionSupport` lives in `PatchSetPreviewProjectionSteps.scala`, matching D5's "stays put".

**Round-1 CR1 (HEL-1526 red-first spec): NOT fixed. The revised scenario still cannot go red on the pre-fix code.** Mechanism:

- Pre-fix `replaceContents` (`DashboardContentsOps.scala:55-72`) inserts each replacement panel as its own statement (`panelTable += pr`, :63).
  - Non-deferred FK checks are AFTER ROW triggers. They fire at the end of each statement, in trigger-name order.
- `panels` has these RI check triggers. I read them from the catalog with a read-only query; no backend was started:

  ```
  RI_ConstraintTrigger_c_16444|FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE
  RI_ConstraintTrigger_c_16539|FOREIGN KEY (owner_id) REFERENCES users(id)
  RI_ConstraintTrigger_c_60097|FOREIGN KEY (output_id) REFERENCES outputs(id) ON DELETE CASCADE
  ```

  - The dashboard FK was created in V2 (`V2__cascade_delete.sql:2-4`) and the output FK in V94 (`V94:344`).
  - No later migration recreates either one (grep of the migration dir).
  - So in any freshly migrated DB the dashboard FK's trigger OID is smaller and sorts first. That ordering only flips in the rare case where the OID counter crosses from 5 to 6 digits between V2 and V94.
- Therefore, at replace's first INSERT:
  1. The dashboard RI check takes `FOR KEY SHARE` on the dashboard row.
  2. Only then does the output RI check block on the gate's `FOR UPDATE` of O1.
- The concurrent `insertPlaced` begins with `SELECT ... FOR UPDATE` on that dashboard row (`PanelLayoutPlacement.scala:47`). `FOR UPDATE` conflicts with `FOR KEY SHARE`, so it blocks behind replace.
- When the gate releases, replace commits first. `insertPlaced` then reads the committed layout and appends its item. The created panel keeps its item: green on pre-fix code. The C3 red-first requirement cannot be met as specified.
- The live window does exist, but it is narrower than D3 states. It runs between the unlocked read and replace's first dashboard-row lock, which is the first INSERT's FK check, or the layout UPDATE when there are no replacement panels. It is not "between the DELETE and the layout UPDATE".

### Verdict: REFUTE

### Change Requests

1. **D6, task 5.3, and the D3 exposure sentence: pick a gate whose block point comes before replace's first dashboard-row lock on the pre-fix code, and record why.**
   - An output-row gate cannot do this, because the `dashboard_id` FK check (V2, sorts first) takes `KEY SHARE` on the dashboard before the `output_id` check (V94) waits.
   - Workable example: the gate holds `LOCK TABLE panels IN SHARE MODE`. Then:
     1. Replace blocks at its 0-row DELETE (needs ROW EXCLUSIVE), after its unlocked read.
     2. `insertPlaced` takes the dashboard `FOR UPDATE`, then blocks at its INSERT.
     3. The gate releases.
     4. Replace's INSERT FK check waits on `insertPlaced`, which commits its item.
     5. Replace then blind-writes its computed layout: the item is lost (red).
     6. Post-fix, replace holds the dashboard `FOR UPDATE` (taken after its panel lock, which needs only ROW SHARE) before blocking. `insertPlaced` waits on it and appends afterwards (green).
   - A test-only `BEFORE INSERT` trigger that waits on an advisory lock, filtered to O1, is another option.
   - Whatever is chosen, the spec must await each racer's lock wait separately. Today's `awaitLockWait` (`DashboardDeleteRacesPanelDeleteSpec.scala:74-82`) returns on *any* non-excluded waiter, so it cannot tell which session formed the interleave.
   - Correct D3's window wording as described above.
2. **Remove the stale V129 text that contradicts C4:**
   - design.md:37's D1 header "(V129 planned)".
   - The design.md:124 Risks bullet and the tasks.md:4 C2 gloss, both premised on "a V129 applied ahead of HEL-1434's V128". With C4 the hazard is a duplicate V128 (different checksum) on the shared dev DB. C2 still prevents it, but the stated reason is wrong.
   - design.md:123 "renumber if needed" should defer to C4 (exactly max+1, re-checked at push and by the auditor).
   - An implementer reading the D1 header alone would create V129 and reintroduce exactly the gap CR3 closed.

### Non-blocking notes

- W2 (`batchUpdate`) uses an app-level `FOR UPDATE` on the system pool. That is fine because the privileged pool bypasses RLS. Keep it as one statement with `ORDER BY id`. Slick's `sortBy(...).forUpdate` emits `ORDER BY ... FOR UPDATE`, which is correct.
- The `users` FK (`owner_id`) also takes `KEY SHARE` on the user row at every panel INSERT. That is harmless for these races, but it is worth knowing when reasoning about future gates.
