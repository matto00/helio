## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 14c08def8a69f78fe1f81fcb86a7a3d928d06ab3 (main; the change dir is untracked planning artifacts only).

### What I verified (with evidence)

- **The defect mechanism is real.** `PipelineRootWrites.addRoot`/`removeRoot` (:110-135, :162-226) accept owner or
  editor. `PipelineRootRepository.add` (:88) runs under `ctx.withUserContext`. `removeRoot` commits through
  `pipelineRepo.runTransactionally(user.id.value)` (:216), which is `ctx.withUserContext` (PipelineRepository.scala:527).
  `pipeline_roots_insert/update/delete` are owner-only (V98:355-383). `pipeline_steps_owner` is owner-only for every
  command (V35:63-70). `DraftSaveRlsSpec.scala:57-88` already pins both symptoms on the NOBYPASSRLS fixture: a 500 on
  add, and a 200 with no change on remove.
- **D3 (do the locks lock for an editor today?): yes, settled from the SQL.**
  - `hel1629_lock_pipelines` is `SECURITY DEFINER`, owned by `helio_privileged`, with `SET row_security = off`
    (V137:42-77). Its header says it exists so an editor's lock does not silently match zero rows.
  - `PanelRowLocks.lockForDeletion` follows the V129 pattern, which works the same way.
  - The source `FOR KEY SHARE` (PipelineRootRepository:93) runs on a source the actor owns (`findByIdOwned`,
    PipelineRootWrites:138), so it passes `data_sources` RLS.
  - So the lock behaviour is the same on both pools. The executor task for D3 has nothing left to find, and the
    design can simply state this.
- **D2 scoping audit, statement by statement.** Every write in both chains filters explicitly:
  - add: `pipelineNameQuery` and `nextPositionQuery` filter by `pipelineId`.
  - remove: the steps read, both `node_snapshots` deletes and `compactPositions` filter by `pipelineId`.
  - `removeAction` (:155) filters by `rootId` only. Phase 1 has already checked that `rootId` is in this pipeline
    (PipelineRootWrites:180, privileged read).
  - Triggers: the only one on these tables is V99's zero-root guard, made RLS-independent by V100. There are no audit
    triggers on these tables; V91's triggers are on `audit_events` only.
  - **Exception, the cycle guard (CR2).** The design says the guard "already takes the user id explicitly". That is
    true, but the explicit filter is AND-ed with RLS under user context. `findUpsertWriteEdges`
    (PipelineStepRepository:185-200) joins `pipeline_steps`, which is owner-only, so an editor's guard today cannot see
    the owner pipeline's `upsertsource` steps. Its check is vacuous for editors. On the privileged pool it becomes
    effective. That is a behaviour change, not "no change".
- **D2 alternative analysis holds.** Editor-aware RLS on `pipeline_roots` alone would still leave the
  `pipeline_steps` deletes in the same transaction owner-only (V35). Editor step writes do run privileged after the
  service check (PipelineStepRepository:315-338, 416, 522, 1035). `runPrivileged` (PipelineRepository:311) is an
  existing privileged transactional runner the remove path can use.
- **D1 (existing contract, or a new product decision?).**
  - The ticket explicitly delegates the rule ("Decide the rule (owner-only, or editors too…)").
  - The service scaladoc (PipelineRootWrites:106, :149) says "Requires Editor or Owner".
  - The live spec `dataset-write-auto-run/spec.md:163` already describes "an editor grantee's own data source bound as
    a root on another user's pipeline".
  - Against that, the HEL-913 design that wrote V98 (`archive/2026-09-04-multi-root-pipelines/design.md:481-488`)
    calls a grantee being able to "add and remove that pipeline's roots" a **privilege escalation**, and required a
    test that a grantee "cannot write a root" (tasks 3.6b).
  - In production (non-BYPASSRLS app role), editors have **never** been able to add or remove a root.
  - So the decision is delegated and defensible. It is not "aligning code with an existing contract, so no new product
    decision is made": it newly enables a capability in prod that a prior design called an escalation (CR3).
- **Test plan on NOBYPASSRLS.**
  - `TwoUserRlsApiFixture` runs the app pool as `helio_app_test NOBYPASSRLS` (:126-144), so it does prove the RLS half.
  - It also blanket-grants `helio_privileged` full DML on every table (:136). This change adds main code's first
    privileged-pool INSERT/UPDATE/DELETE on `pipeline_roots`. The only `pipeline_roots` writers in main are
    PipelineRootRepository:99/:146/:156/:170 and PipelineRepository:399/:473, all on user context. The fixture cannot
    detect a missing production grant (CR4).
  - V38's `ALTER DEFAULT PRIVILEGES` should cover V98. But V100, V129 and V137 each re-grant on `pipeline_roots`
    explicitly "belt-and-braces", which suggests nobody has proven the default path for this table.
- **Existing pinned tests and the HEL-1629 race inventory.**
  - `DraftSaveRlsSpec` :57-88 (C5) asserts the current 500 and the no-op 200. Its comment says it is "pinned here so a
    change … (which WOULD create the race) turns this red."
  - HEL-1629's writer inventory (`archive/2026-10-17-atomic-draft-save-endpoint/evidence/g1-writers.md:58-59`, W29/W30)
    certifies "As an editor no race exists" for exactly these two writers.
  - This change makes both statements false. Neither the design nor the tasks mention them (CR1).
- **AC coverage.** Red-first editor add and remove: tasks 1.1 and 2.1/2.2. Viewer and stranger refusal: 1.2. "Never a
  500 / never a false 200": D4 and 2.3. AC (e), the HEL-1631 editor draft flow: Planner Notes, as a UI check only (see
  notes).

### Verdict: REFUTE

### Change Requests

1. **Plan the replacement of the C5 tripwire, and re-establish the race certification it guarded.**
   `DraftSaveRlsSpec.scala:57-88` asserts `InternalServerError` and an `OK` no-op for an editor, and will go red under
   this fix by design.
   - Add tasks that convert or remove those two cases, so they are not "fixed" by weakening their assertions.
   - State in design.md why the editor root add and remove are now covered by HEL-1629's lock protocol. The likely
     argument: D2 moves the **owner** path onto the same privileged transaction. Then `DraftSaveRaceSpec` "root
     add"/"root remove", `DraftSaveSetRaceSpec` and `DraftSaveDeadlockSpec` "a root remove against the save" exercise
     the new code. On the privileged pool, nothing in the transaction depends on caller identity except the
     cycle-guard filter.
   - Add a task to run those three race/deadlock specs green on the changed code and record the output.
   - W29/W30's "as an editor no race exists" is now false. Say so in design.md, since the archived inventory cannot be
     edited.
2. **Correct D2's cycle-guard claim and test the new behaviour.** Under user context an editor's
   `findUpsertWriteEdges` sees none of the owner pipeline's `upsertsource` steps (`pipeline_steps` is owner-only), so
   today's editor cycle check is vacuous. On the privileged pool it sees them.
   - Document this behaviour change in D2.
   - Add a NOBYPASSRLS test: an editor's root add that would close a read→write cycle through the owner pipeline's own
     `upsertsource` target answers 400 (`PipelineCycleRejected`) and writes nothing.
   - Otherwise the one place where the pool switch changes semantics, beyond the writes themselves, ships untested.
3. **Restate D1 accurately.** Replace "aligns code with an existing contract, so no new product decision is made".
   Record instead that this is the ticket-delegated choice, and that it:
   - newly enables editor root writes in production (they have never worked on the non-BYPASSRLS prod role);
   - departs from the HEL-913 design's framing of grantee root writes as a privilege escalation (multi-root-pipelines
     design.md:481-488), which applied to the RLS layer and stays true there because the policies are unchanged.
   Also list the consequences the owner may want to overturn:
   - an editor's root remove deletes the owner's steps and Outputs, and unbinds panels on the owner's and third
     parties' dashboards;
   - an editor-owned source bound as a root outlives a revoked grant (zero-root-guard design D9 already notes this);
   - the editor's dataset writes can auto-run the owner's pipeline.
   Carry this into the PR body so the owner sees it at merge time.
4. **Prove the production grant, not only the fixture's.** Add a task with checkable evidence that a database
   migrated by a non-superuser migrating role, **without** `TwoUserRlsApiFixture`'s :136 blanket grant, gives
   `helio_privileged` `INSERT, UPDATE, DELETE` on `pipeline_roots`. For example, a
   `has_table_privilege('helio_privileged','pipeline_roots','INSERT')` (and UPDATE, DELETE) assertion in the
   non-superuser Flyway migration harness. Steps and `node_snapshots` are already written privileged in prod. Root
   writes on that pool are new.
5. **Make D4/2.3 and 3.1 unambiguous.**
   - (a) After phase 1 a 0-row `removeAction` cannot be reached through the route without a race. Name the test seam:
     for example, compose the remove transaction directly against a root deleted beforehand, or use a hook between
     phase 1 and phase 2. State where 0 rows becomes a 404: a typed exception mapped outside `classifyDbError`, so it is
     not swallowed as a 500.
   - (b) Task 3.1 says "revert 2.1 **or** 2.2". Require both mutations, each independently re-redding its own verb's
     editor test.

### Non-blocking notes

- `removeAction(rootId)` filters by `rootId` only. Phase 1's privileged read makes this correct, and root ids cannot
  move between pipelines. Adding `pipelineId` to the filter costs nothing and makes the privileged statement
  self-scoping.
- `add` ignores `locks.lockPipelines`'s Boolean, and `pipelineNameQuery` is `.result.head`. A pipeline deleted between
  `findByIdShared` and the transaction gives a 500 (NoSuchElement or an FK error). This is pre-existing and
  race-only, and outside the role-based AC. Consider mapping a short lock count to 404, as V137's header asks of
  single-pipeline writers.
- AC (e): an editor UI check on the superuser local database proves the flow, not RLS (the design admits this).
  `DraftSaveRlsSpec` already covers editor draft save under NOBYPASSRLS (:14-48). Cite it as the RLS evidence for (e)
  rather than relying on the UI check alone.
- Optional: one editor-actor case in `DraftSaveRaceSpec` (editor root add vs owner save) would make CR1's argument
  measured rather than argued.
