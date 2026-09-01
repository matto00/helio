## Skeptic Report — final gate (round 2, dimension: route/ACL correctness, skeptic-final-2-acl.md)

Filename note: `next-report-number.sh` returned `number=1 path=.../skeptic-final-1.md` — it does
not see the round-1 dimension-suffixed reports (`skeptic-final-1-acl.md` et al.), so its number is
stale. Per the orchestrator's explicit round-2 instruction this report is written to
`skeptic-final-2-acl.md`, which does not exist and cannot collide with any sibling.

Reviewed at HEAD `abd7ff22` (round 1 reviewed `856e23f0`).

### What I verified (with evidence)

**1. Round 1's two change requests — both genuinely landed, verified by reading the files, not the commit message.**

- CR1 `PipelineProtocol.scala:15-22` (`CreatePipelineTransactionalStepRequest` doc): now reads
  *"ratified as a single real Slick transaction (design.md D3, option iii) spanning
  `PipelineRepository`/`PipelineStepRepository`/`OutputRepository`
  (`PipelineRepository.runTransactionally`, `DbContext.withUserContext`), **not a
  compensating-delete of the just-created pipeline row**. The compensating-delete approach was an
  earlier cycle's implementation and was deleted outright once the real transaction shipped."*
  This is the exact inversion of the round-1 defect and it now matches the code. Correct.
- CR2 `PipelineService.scala:96,100`: both `withSystemContext` mentions are gone; the doc now says
  *"`PipelineRepository.runTransactionally`, `DbContext.withUserContext` under the hood"* and
  *"not a create-then-compensate delete (that was cycle 4's implementation … it has been deleted,
  not patched)."* Ground-truth cross-check: `PipelineRepository.scala:300` is
  `def runTransactionally[R](userId: String)(action: DBIO[R]): Future[R] = ctx.withUserContext(userId)(action)`.
  Doc and code agree.
- Repo-wide sweep: `grep -rn "compensat\|withSystemContext" backend/src/main/scala/` returns no
  remaining claim that pipeline creation compensates or runs privileged. The only
  `PipelineProtocol.scala` hit is the past-tense "was deleted" sentence above. No vestige survives.

**2. New work in `abd7ff22` (all-Outputs preview) — ACL-gated equivalently to the single-Output arm.**

- Route (`PipelineRunStatusRoutes.scala:53-59`): `outputId` is now
  `parameters("outputId".optional)`; both arms enter the same `runService.previewOutputs` and the
  same `ServiceResponse.run`. Mounted only on the authenticated tree (`ApiRoutes.scala:744`), so
  there is no anonymous reach.
- Service (`PipelineRunService.scala:284-317`): single-Output arm gates on
  `outputRepo.findById(id, user)` (sharing-aware `withUserContext`, `outputs_select` RLS via
  `helio_can_access_pipeline`) plus an explicit `output.node.pipelineId != pipelineId` → 404
  cross-pipeline guard. All-Outputs arm gates on `pipelineRepo.findByIdShared(pipelineId, Some(user))`
  → 404 before any read, and only then calls the privileged `listByPipelineInternal`. Both gates
  are the same sharing-aware level (owner + editor/viewer grantee, unrelated caller 404), and
  `previewAtNode` re-runs `findByIdShared` per node regardless of arm. The privileged
  `listByPipelineInternal` is reached strictly downstream of the pipeline ACL gate and is scoped to
  that one pipeline id — no widening. Correct.
- HTTP triad actually tested for the new arm (`OutputRoutesSpec.scala:617-634`): owner 200 with
  both Output ids in the envelope, editor grantee 200, unrelated caller 404. Not inferred — read.

**3. The run-state-unchanged assertion genuinely covers the all-Outputs arm (the executor's claim, checked at the test body).**

- `PipelineRunServiceSpec.scala:1115-1140` ("all-Outputs arm"): seeds a pipeline with a step and
  TWO Outputs (one source-bound, one step-bound, so the fan-out really does more work), asserts
  `lastRunStatus`/`lastRunAt` are `None` before, then performs a REAL `service.submit(otherPid,
  isDry = false, …)` on a *different* pipeline and asserts that one's run state became `defined` —
  a live control proving the assertion mechanism can detect a mutation — then runs
  `previewOutputs(pid, None, …)`, asserts 2 entries came back (so the fan-out really executed),
  and re-reads `findByIdInternal(pid)` asserting both fields still `None`. This is a real guard,
  not a vacuous one.
- Mirrored at the HTTP layer (`OutputRoutesSpec.scala:643-656`) over a real DB round-trip.

**4. Round 1's sound findings re-confirmed at the new HEAD.**

- Fresh gate run (my own, this round):
  `sbt testOnly OutputRoutesSpec PipelineRunServiceSpec PipelineCreateTransactionalSpec PipelineRepositoryRunTransactionallyRlsSpec PipelineAclSpec`
  → `Tests: succeeded 117, failed 0, canceled 0` / `All tests passed.`
- Full owner/grantee/other triad still present for every route in scope — re-derived from the spec
  sources this round (`POST|GET /pipelines/:id/outputs`, `GET|PATCH|DELETE /outputs/:id`,
  `/panels`, `/assertion-status`, `/rows`, `GET /outputs`, both preview arms). `DELETE /outputs/:id`
  and `PATCH /outputs/:id` remain deliberately owner-only (`findByIdOwned`'s explicit
  `r.ownerId === ownerUuid`), proven by the grantee-404-and-row-intact test
  (`OutputRoutesSpec.scala:376-384`) — a grantee 404 strictly implies an unrelated-caller 404, so
  the missing literal `other` case is not a gap. The two `403`s on the pipeline-nested create/list
  remain `AccessChecker.requireAccess`'s codebase-wide convention, unchanged.
- Transaction-boundary rollback: `PipelineCreateTransactionalSpec`'s 5 tests pass, including the
  raw-SQL `select count(*)` boundary observation and the mid-request `parentStepId` rejection.
- RLS empirical result: `PipelineRepositoryRunTransactionallyRlsSpec` passes against the real
  `NOSUPERUSER` role; `PipelineRepository.scala` carries no leftover justification comment for a
  posture it no longer has.

### Verdict: CONFIRM

Both round-1 change requests landed as described and were verified against the files, not the
commit message. The cycle-10 all-Outputs preview arm is ACL-gated at the same sharing-aware level
as the single-Output arm, has a real owner/grantee/other triad, and its run-state-unchanged guard
is a genuine control-backed assertion. Nothing in the route/ACL dimension blocks delivery.

### Non-blocking notes

- `PipelineRunServiceSpec.scala:1142-1148` ("with outputId absent, 404s for a pipeline the caller
  cannot see") uses a random non-existent `PipelineId`, so it proves the not-found path rather than
  the cross-tenant path its name promises. The genuine cross-tenant case IS covered at the HTTP
  layer (`OutputRoutesSpec.scala:631`), so this is naming, not a hole.
- Round 1's non-blocking notes that remain open and unchanged: the second
  `PipelineCreateTransactionalSpec` rollback test still asserts via `listSummaries` rather than a
  raw `pipeline_steps` count; `PublicDashboardRoutes.resolveDataAsOf` is still an N+1 per
  `OutputPanel` on the public route; `POST /pipelines/:id/steps` still has no editor-grantee 200
  case (pre-existing).
