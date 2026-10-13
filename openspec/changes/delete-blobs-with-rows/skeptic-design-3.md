## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 4d3755079f642726a04dd54edc413c9146429d3a, which equals the freshly fetched origin/main. The planning artifacts are untracked in the worktree. I read ticket.md, proposal.md, design.md, tasks.md, spec.md, workflow-state.md, and the round-1 and round-2 reports cold. I treated the orchestrator's summary as a set of claims and checked each against the tree.

### What I verified (with evidence)

**Round-2 CR1 (C1 vs Decision 6): addressed.**
- Every Decision 6 proof now carries exactly one label: RED-FIRST R1-R6, MUTATION M1-M5, or GUARD G1-G5.
- tasks.md C1 now points at those labels. It requires R items to be red pre-fix, M items to be red under their named mutation, and G items to be labelled as guards.
- No item that is green on the pre-fix tree by construction is still listed as RED-FIRST. Rollback, teardown, normal delete and non-file are all GUARDs, and the RLS "outer delete commits" check is M4.

**Each RED-FIRST item really is red on the pre-fix tree, through existing entry points:**
- **R1/R2/R3:** `PipelineSchedulerService.tick()` exists (`PipelineSchedulerService.scala:101`), and every collaborator after `clock` is a nullable default, so a pre-fix spec compiles. The pre-fix tick never touches storage, so "object still present" fails as an assertion. The GCS variant is red as an unmet `verify(storage).delete(...)` on the Mockito double.
- **R4:** `deleteAfterPrecheck` deletes the file before `dataSourceRepo.delete` (`DataSourceService.scala:710-721`). A forced row-delete failure therefore leaves the row with no file, so it is red.
- **R5:** `ImageUploadService.upload` runs `fileSystem.write(...).flatMap(_ => repo.insert(...))` with no compensation (`ImageUploadService.scala:78-83`). A failing insert (an FK-violating owner, or a raising test trigger) leaves the object behind, so it is red.
- **R6:** `AssistantConversationService.create` follows the same write-then-`repo.create` shape with no compensation, so it is red the same way.

**Each named mutation can actually go red:**
- **M4.i (drop SECURITY DEFINER):** the trigger then runs as the invoking table-owning NOBYPASSRLS role against a FORCE-RLS, no-policy queue. The INSERT is default-denied, which is red at least on (a). The design correctly says to record (b) rather than assume it.
- **M4.ii (skip the re-own):** a definer owned by a NOBYPASSRLS role, with `row_security = off` against a FORCE-RLS table, raises `42501`, so it is red.
- **`row_security = off` alone** is correctly removed as a mutation target. The V122 header documents the same no-op (`V122__strip_deleted_panel_layout_items.sql:27-40`).
- **M1 / M2 / M3 / M5:** each mutation removes exactly the behaviour its test asserts. M5's lease can be exercised by writing a `claimed_at` older than 300 s directly, with no real wait.
- **G4:** dropping the `source_type` gate enqueues the static/rest row, so it goes red.
- **G5:** a trigger left at plain `ENABLE` does not fire under `session_replication_role = replica`, so the queue stays empty and the test goes red. The test sets replica mode as superuser, which is allowed.

**Round-2 CR2 (RLS mutation list): addressed.** The list is now split into M4.i and M4.ii, each with its expected red case, and the no-op `row_security = off` clause is documented as a belt-and-braces setting rather than a mutation.

**Round-2 non-blocking notes, as taken:**
- **Detached drain:** it mirrors HEL-1477. On this tree, `runPasses` starts `outputHistoryRetentionService.purgeIfDue` without awaiting it (`PipelineSchedulerService.scala:136-142`). The service has an `AtomicBoolean` in-flight guard (`OutputHistoryRetentionService.scala:53,73-87`), and a wiring spec precedent exists (`PipelineSchedulerServiceDetachedRetentionSpec.scala`). The design follows the same pattern.
- **300 s lease:** matches `staleClaimAfterSeconds = 300L` (`PipelineSchedulerService.scala:46`), and a failed attempt clears `claimed_at`.
- **Stuck-row probe:** tasks 1.2.
- **Queue read via superuser/privileged connection:** stated in Decision 6.

**Is ENABLE ALWAYS appropriate here?** Yes. It is the repo's precedent for triggers that must not be skipped (V91:116-136, V99:83, V122:98).
- Under replica mode, FK cascades do not fire, so only direct deletes reach the trigger. For those, enqueueing is the correct outcome.
- `pg_restore --disable-triggers` uses `DISABLE TRIGGER ALL`, which still turns ALWAYS triggers off, so restores are unaffected.
- Delete-then-reinsert maintenance is protected by the drain's shared-key check.
- I found no harmful case.

**RLS and privileges ground truth:**
- The V122 definer bracket is at `:27-40` and `:84`.
- The owner-role harness shape is at `V119OwnerFkMigrationSpec.scala:46-52`: a NOSUPERUSER NOBYPASSRLS role, `helio_privileged` BYPASSRLS, and `GRANT ... WITH ADMIN OPTION`.
- The design asks for explicit idempotent grants. That matches the V105/V113 practice of explicit grants to `helio_privileged` rather than relying on V38's default privileges.

**Migration number:** origin/main's highest migration is V126 (sorted numerically after a fresh fetch), so V127 is free.

**Inventory and scope:**
- AC1 (inventory) is in the design table.
- AC2 is satisfied: the trigger queue plus drain is chosen over a sweep, with an in-flight-safety argument that holds by construction.
- AC3 (read-only measurement, owner-run prod procedure, no deletion) is covered by tasks 1.1-1.3 and C3.
- The OWNER REVIEW parking is noted and is not re-litigated here.

### Verdict: CONFIRM

### Non-blocking notes

1. **Wiring proof.** Once the drain is detached, the green specs "await the drain pass itself". That alone would not catch a missing `runPasses` or `Main.scala` wiring.
   - Add one spec, like `PipelineSchedulerServiceDetachedRetentionSpec`: `tick()` on a wired scheduler leads to the object being gone, using `eventually`.
   - The final gate should confirm live that a raw `DELETE FROM users` for a throwaway user removes its object on a running backend.
   - Alternatively, write the R1-R3 assertion as `eventually { object absent }` after `tick()`. The same spec text then serves both red and green.
2. **Attempt cap versus retry cadence.** A failed attempt clears `claimed_at`, so a row is retried every tick (about 30 s). A cap of 10 is reached after roughly 5 minutes of a GCS outage, and the row then stays stuck forever. That is a leak the stuck-row probe will show, but not a self-healing one. Consider a backoff on `last_attempt_at`, or a larger cap.
3. **TRUNCATE.** `TRUNCATE users CASCADE` / `TRUNCATE data_sources` fire no row triggers, so a raw-SQL TRUNCATE still leaks. List it next to the refresh race as a known gap. The "raw SQL" claim covers DELETE only.
4. **Spec delta.** Requirement 3 has a scenario only for the image upload. An assistant-conversation scenario would mirror R6.
5. **Shared dev DB.** Applying V127 from this worktree to the shared dev DB is subject to the known Flyway-collision hazard if another lane also takes V127. C5's re-check covers commit time but not live application, so watch it.
