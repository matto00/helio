## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 4d3755079f642726a04dd54edc413c9146429d3a. The planning artifacts are untracked in the worktree. I read design.md, proposal.md, tasks.md, the spec delta and workflow-state.md cold, and checked each claim against the tree.

### What I verified (with evidence)

**Round-1 CR1 (legacy `filePath`): addressed.**
- The trigger and the guard both use `COALESCE(NULLIF(config->>'path',''), NULLIF(config->>'filePath',''))`.
- Decision 6 includes a legacy case with a `path`-only mutation, and task 1.1 counts `filePath`-only rows.
- The codec is `obj.fields.get("path").orElse(obj.fields.get("filePath"))` (`DataSourceConfigCodec.scala:32`). The only divergence is a row whose `path` is the empty string: the codec keeps `""`, while the trigger falls through to `filePath`. That is harmless and arguably more correct.

**Round-1 CR2 (RLS posture): addressed.**
- The posture is now fixed in the design, not left to the executor: SECURITY DEFINER, `search_path = pg_catalog, public`, `row_security = off`, re-owned to `helio_privileged` with the V100/V122 bracket, and a queue with FORCE RLS and no policy.
- The bracket matches `V100__zero_root_guard_rls_independent.sql` and `V122__strip_deleted_panel_layout_items.sql` exactly: CREATE OR REPLACE, then a transient GRANT CREATE, then ALTER OWNER, then REVOKE.
- The privileged pool is `SET ROLE helio_privileged`, and the app pool is DB_USER, which owns the tables (`DbContext.scala:14-64`). So the definer insert has its DML through the V38 default privileges, plus the explicit grants the design promises.
- The false precedents (`pipeline_auto_run_debounce` / `pipeline_run_rate_window`) are now called out explicitly.
- The owner-role proof shape exists in `V119OwnerFkMigrationSpec.scala:46-59`: a NOSUPERUSER NOBYPASSRLS LOGIN role that runs Flyway, with `helio_privileged` BYPASSRLS granted to it WITH ADMIN OPTION.
- The design requires asserting that both the outer delete and the source delete commit.

**Round-1 CR3 (behavioural red): mostly addressed.**
- `PipelineSchedulerService.tick()` exists (`PipelineSchedulerService.scala:101`), and every later collaborator is a nullable default (`:37-58`). A pre-fix copy built without the new parameter compiles, its tick does nothing to storage, and "object still present" is a genuine assertion failure. The red is feasible.
- The GCS double is a Mockito `Storage` mock (`GcsFileSystemSpec.scala:4-32`), so a GCS-variant "gone" assertion is a `verify(storage).delete(...)` check. That is feasible too.
- A forced row-delete failure is reachable through the existing P0001 path (`DataSourceService.scala:709-728`) or a test-only raising trigger. Pre-fix the file is deleted first (`:710-721`), so that red is real.
- See CR1 below for the parts of CR3 that do not hold.

**`claimed_at` lease (new in this revision): sound.**
- The claim transaction is short. Delete-then-dequeue plus an expiring lease is crash-safe, and a re-run is idempotent because `deleteIfExists` / GCS delete are idempotent.
- It mirrors V110 / the `staleClaimAfterSeconds = 300` precedent (`PipelineSchedulerService.scala:46`).

**Migration number:** V126 is the highest on the tree (sorted numerically), so V127 is free.

**Inventory and the other round-1 checks** still hold. Nothing in the revision changed them.

### Verdict: REFUTE

These are narrow evidence-plan defects introduced or left by the revision. The design itself is sound.

### Change Requests

1. **C1 contradicts Decision 6 and cannot be satisfied literally (tasks.md C1 / task 2.1, design.md Decision 6).**
   - C1 says "every path in design.md Decision 6 is shown failing on the pre-fix tree". Decision 6 itself says the queue/drain unit specs are "proved by mutation instead".
   - Several listed items are green on the pre-fix tree by construction, so they cannot be red there:
     - the rolled-back delete ("nothing enqueued, object kept");
     - "a non-file source enqueues nothing";
     - the drain-failure / attempts spec;
     - the teardown and normal-delete regressions;
     - the RLS "outer delete commits" assertion. There is no trigger pre-fix, so the delete trivially commits.
   - An evaluator holding C1 literally will FAIL a correct execution, and an executor trying to satisfy it is pushed to fabricate a red.
   - Fix: label every Decision 6 bullet as exactly one of:
     - **red-first on pre-fix**: cascade / raw `image_uploads` delete / legacy CSV, each through delete + `tick()` + object absent; the `DataSourceService.delete` forced-failure case; the create-path compensation cases;
     - **mutation-proved**, naming the mutation: shared-key guard removed; attempts increment removed; `path`-only extraction; the definer/owner mutations;
     - **regression guard, not failable by a pre-fix red**: rollback, non-file, teardown, normal delete. If no meaningful mutation exists, say so explicitly.
   - Then reword C1 to point at that classification.
2. **The RLS mutation list includes one mutation that cannot go red, and is ambiguous about which case each mutation reddens (Decision 6 RLS bullet, C6).**
   - The bullet says "drop `SECURITY DEFINER` / `row_security = off` from the trigger function". Read as two separate mutations, dropping only `row_security = off` while the function stays SECURITY DEFINER owned by `helio_privileged` (BYPASSRLS) is a pure no-op. V100's own header says so ("With a BYPASSRLS owner this clause is a pure no-op"). That mutation stays green, and the plan demands it be shown red.
   - Fix: state the mutations as distinct, each with its expected red case:
     - **(i) drop SECURITY DEFINER.** The trigger then runs as the invoking owner role against the FORCE-RLS, no-policy queue. Expect a loud failure that aborts the outer delete, at least in the service-path case (a). Record whether the cascade case (b) also goes red; do not assume it either way. Postgres's RI cascade machinery changes user and security context, and the evidence should report what was measured.
     - **(ii) leave the function owned by the migrating role.** Expect `42501` from the `row_security = off` tripwire, so the outer delete fails.
     - **(iii) `row_security = off` with no other change.** Either drop it from the list, or list it as the documented no-op tripwire whose value is proved by (ii). Do not list it as a red.

### Non-blocking notes

- **Tick latency (HEL-1477 precedent).**
  - Decision 2 wires the drain "the same ... way as the HEL-505/HEL-1208 passes", which are awaited in the `zip` at `PipelineSchedulerService.scala:141`.
  - HEL-1477 detached the history-retention pass because awaiting it delayed every scheduled fire.
  - A backlog of 100 sequential GCS deletes is seconds, not minutes, so this is acceptable. Either state the per-delete concurrency and accept the bound explicitly, or detach the pass behind an in-flight guard like HEL-1477. If detached, the red/green specs must await the pass, not just `tick()`.
- **`ENABLE ALWAYS`.** V99 and V122 set `ENABLE ALWAYS TRIGGER` so the trigger fires under `session_replication_role = replica`. Decide whether the queue triggers should match; restore tooling may run in replica mode.
- **Attempt-capped rows.** Rows at the cap stay forever. Mention the `count(*) WHERE attempts >= cap` probe in measurements.md alongside the queue-growth risk.
- **Lease duration.** "A few minutes" should name the value. 300 s, matching `staleClaimAfterSeconds`, is the obvious choice. State whether a failed attempt clears `claimed_at` or deliberately keeps it as backoff.
- **Reading the queue in the owner-role spec.** The queue has FORCE RLS with no policy, so the owner role cannot see queue rows. The "key is queued" assertion must read through the superuser or a `helio_privileged` connection. This is worth a sentence so the executor does not add a policy to make the test pass.
