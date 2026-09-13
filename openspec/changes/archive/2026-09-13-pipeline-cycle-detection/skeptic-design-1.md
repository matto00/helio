## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD: ac5d1e6be868d83f2709d04d25a88ae56a70843e

### What I verified (with evidence)
- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/cycle-detection-write-back/HEL-1101`.
- Read ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-cycle-detection/spec.md in full.
- **Graph model (Decision 1) is correct.** With nodes = sources and edge S1->S2 for "a pipeline reads S1 and writes S2", a direct cycle is a self-loop and an N-hop cycle is a directed cycle. A diamond is a DAG. This part is sound.
- **PipelineProposalService.apply -> create: TRUE.** `PipelineProposalService.scala:101-112` resolves roots and then calls `createPipeline`, which goes through `pipelineService.create`. The patch-set paths (`PatchSetApplyForward.scala:87/93/99`, `PatchSetApplyRollback.scala:156/206`, `PatchSetUndoService.scala:232/266`) also go through `pipelineService.create/addStep/updateStep`, so wiring at the service level covers them. The design does not mention them.
- **"Inside the existing `.transactionally` block" (task 4.1, Decision 4): FALSE for 3 of the 4 paths.**
  - `addRoot` (`PipelineService.scala:780-818`) runs its checks as separate Futures. It then calls `PipelineRootRepository.add` (`PipelineRootRepository.scala:51-62`), which uses its own `withUserContext`.
  - `addStep` runs its checks as separate Futures, then calls `persistNewStep`. That calls `spliceInsertAtInternal`/`attachTailInternal`, which run under `withSystemContext(... .transactionally)` (`PipelineStepRepository.scala:240/408`). That is a different privileged role and connection.
  - `updateStep` calls `updateInternal` under `withSystemContext(action.transactionally)` (`PipelineStepRepository.scala:308-327`).
  - `create` has **two** paths. The simple path (`PipelineService.scala:150-161`, no steps or outputs) calls `pipelineRepo.create`. Only the steps/outputs path (`createTransactional`, `runTransactionally` at :369) is one composed DBIO.
  - A `pg_advisory_xact_lock` only helps if the graph read and the edge insert run in the same transaction as the lock. No such transaction exists today on addRoot, addStep, updateStep or simple create.
- **Lock key and graph scope with editor grantees: not defined.** addRoot, addStep and updateStep all let a non-owner editor mutate (`requireEditorAccess`; "Grantee path" at ~:1785).
  - `hashtext(ownerId)` of the *caller* does not serialize an editor's write with the pipeline owner's write.
  - A graph built from what the *caller* can see differs from the pipeline owner's graph.
  - The design never says whose graph is checked or whose id is the lock key when caller != owner. It also never says how a cycle that crosses a shared pipeline is handled.
- **Rejection order makes service-level tests impossible as written.** `addStep` rejects any type not in `PipelineStepKind.All` before decode (~:1720). `create` does the same via `validateStepKinds` (:1495). `upsertsource` is deliberately unregistered. So the service-level tests in tasks 3.1, 3.3 and 3.4, and the spec's "Creating a pipeline with a self-cycle is rejected" scenario, can never reach the cycle check in this ticket. design.md's Risks section says tests call the validator directly, and tasks 3.x ask for service-level rejection tests, so the plan contradicts itself.

### Verdict: REFUTE

### Change Requests
1. **Concurrency design (Decision 4 / task 4.1).** Replace "inside the existing `.transactionally` block" with a concrete plan for each path: create-simple, createTransactional, addRoot, addStep (splice and attachTail branches), and updateStep. For each, say how the advisory lock, the two graph-edge reads and the insert/update are composed into one DBIO on one connection. Address the fact that step writes run under `withSystemContext` while root writes run under `withUserContext`: which context the combined transaction uses, and why RLS is still correct there. If this restructuring is too big for this ticket, say so and escalate or file a tracked gap, as the ticket allows. Do not claim the race is closed.
2. **Editor grantees (Decision 2/4, tenancy requirement).** When caller != pipeline owner, define:
   - whose graph is checked (the pipeline owner's, the caller's, or both);
   - whose id is the lock key. Keying on the caller does not serialize with the owner;
   - how the cycle message avoids naming resources the editor cannot see.

   Add a spec scenario and a task/test for an editor-grantee write.
3. **Testability of the wiring (tasks 3.1, 3.3, 3.4; spec "Every edge-adding write path is checked").** Pick one of these and state it in design.md:
   - (a) Give a concrete seam so service-level tests can drive the check with an `upsertsource` config while the registry gate stays in place. For example, the validator is called with the decoded edge set from a path that tests can reach, or the registry is injected in tests only.
   - (b) Limit this ticket's service-level tests to the read-edge side (addRoot, and create with roots against a seeded write edge), and move the write-edge wiring tests to HEL-1100 as a named task on that ticket.

   Also fix the self-contradiction between the design's Risks note and tasks 3.x. State where the cycle check runs relative to the `PipelineStepKind.All` check, so HEL-1100 has no ordering gap.
4. **Both create paths (task 3.1).** List the simple path (`pipelineRepo.create`, steps and outputs empty) and the transactional path as separate wiring points. Only the transactional path can carry a write edge in the same request. But the simple path adds read edges that can close a cycle against existing writers, so it must be checked.
5. **The diamond guard must be failable (task 2.1).** Name the specific bug the diamond test must catch. The usual one is marking any already-visited node as a back edge instead of only nodes still on the stack (three-colour DFS). The test must fail if that change is made. Include the case where the second path into the shared node is explored after the first path has finished.
6. **Several pipelines on one source pair (Decision 3).** Several pipelines can produce the same S1->S2 edge. State that edges carry the pipeline id and name, so the graph is a multigraph or edges are labelled. Also state which pipeline the message names, so the exact-path tests in task 2.2 are deterministic.

### Non-blocking notes
- Record in design.md that patch-set apply, rollback and undo reach the checked service methods, so they are covered transitively.
- The graph-edge queries in tasks 1.1 and 1.2 must spell out the owner/grant join they use, because the step "Internal" methods bypass RLS.
