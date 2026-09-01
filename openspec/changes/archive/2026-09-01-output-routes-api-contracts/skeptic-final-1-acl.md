## Skeptic Report — final gate (round 1, dimension: route/ACL correctness, skeptic-final-1-acl.md)

Filename note: `next-report-number.sh` returned `number=1 path=.../skeptic-final-1.md`; per the
orchestrator's dimension-split instruction this report is written to the same number with the
`-acl` dimension suffix, so the three sibling skeptics running in parallel on round 1 cannot
collide on one `skeptic-final-1.md`.

### What I verified (with evidence)

**ACL triad, per route (all read from the spec sources, not from evaluation-7.md):**

| Route | owner | grantee (editor) | unrelated authenticated | Evidence |
|---|---|---|---|---|
| `POST /pipelines/:id/outputs` | 201 | 201 | **403** | `OutputRoutesSpec.scala:187,199` |
| `GET /pipelines/:id/outputs` | 200 | 200 | **403** | `OutputRoutesSpec.scala:226-242` |
| `GET /outputs/:id` | 200 | 200 | 404 | `OutputRoutesSpec.scala:245-258` |
| `PATCH /outputs/:id` | 200 | 404 (owner-only) | — | `OutputRoutesSpec.scala:262-274,305-315` |
| `DELETE /outputs/:id` | 200 | 404 + row intact | — | `OutputRoutesSpec.scala:376-384` |
| `GET /outputs/:id/panels` | 200 | 200 | 404 | `OutputRoutesSpec.scala:319-339` |
| `GET /outputs/:id/assertion-status` | 200 | 200 | 404 | `OutputRoutesSpec.scala:444-451` |
| `GET /outputs/:id/rows` | 200 | 200 | 404 | `OutputRoutesSpec.scala:480-500` |
| `GET /outputs` (list) | owner-scoped | grantee-owned row excluded from owner's list | — | `OutputRoutesSpec.scala:541-556` |
| `POST /pipelines/:id/preview?outputId=` | 200 | 200 | 404 | `OutputRoutesSpec.scala:577-592` |
| `GET /pipelines/:id/capabilities` | 200 | 200 | 404 | `PipelineCapabilitiesRoutesSpec.scala:205-216` |
| `POST /pipelines/:id/validate-expression` | 200 | 200 | 404 | `PipelineCapabilitiesRoutesSpec.scala:263-274` |
| `POST /pipelines/:id/steps` (`parentStepId`) | 201 | (pre-existing shape) | 404 cross-user | `PipelineStepRoutesSpec.scala:381-413`, `PipelineAclSpec.scala:253-262` |

The two `403`s (pipeline-nested Output create/list) are not a triad violation: they follow
`AccessChecker.requireAccess`'s pre-existing codebase-wide rule (authenticated caller, resource
exists, no grant → 403; 404 is reserved for the anonymous/public path), which
`PanelService.create`'s dashboard check already uses. The divergence is documented at the test
site (`OutputRoutesSpec.scala:194-197`) and is consistent, not accidental.

`parentStepId` cross-tenant safety: the resolver is membership-scoped, not id-scoped —
`PipelineService.scala:861` rejects any `parentStepId` not in `current` (this pipeline's own
steps), and the route's pipeline-level ACL gate has already run. A real step id belonging to
another tenant's pipeline therefore fails the same membership check as a garbage id. Correct,
though only the garbage-id case is directly tested (`PipelineStepRoutesSpec.scala:406`).

**Transaction rollback observed at the transaction boundary:** `PipelineCreateTransactionalSpec`
`:139-141` asserts `select count(*) from pipelines where name = 'Rollback on bad step'` via raw
SQL on `db` — a real boundary observation that cannot pass without a real transaction, and the
class doc `:29-35` records a mutation experiment (splitting one `runTransactionally` into two)
that made it fail. Confirmed genuine.

**RLS posture:** `PipelineRepository.scala:300` is
`ctx.withUserContext(userId)(action)` — the RLS-enforced app pool, not `withSystemContext`.
`PipelineRepositoryRunTransactionallyRlsSpec` stands up a real `NOSUPERUSER` role via
`SET ROLE helio_app_test_runtx_rls` on a dedicated Hikari pool, composes
`createAction` + `insertInternalAction` (steps) + `insertInternalAction` (outputs), and verifies
the three rows via the SUPERUSER connection. The experiment is not vacuous: the app pool really
is non-superuser and RLS really is enforced. Correct hardened outcome, as briefed.

**PublicDashboardRoutes rewire:** `dataAsOf` resolves `OutputPanel.outputId → output →
pipeline.lastRunAt` using ACL-bypassing `*Internal` lookups, but strictly downstream of the
route's `authorizeResourceWithSharing` dashboard gate, and only for a panel already on a
dashboard the caller may see. No new existence leak. Production wiring confirmed present
(`ApiRoutes.scala:629` passes both repos — the `Option` defaults are not silently `None` in prod).

**No silently-discarded write:** `PipelineService.scala:233`'s `.map(_ => ())` discards only an
inserted-row value inside a composed `DBIO`; any failure still propagates as a failed action and
aborts the transaction. Nothing route-level swallows a write result.

### Verdict: REFUTE

One surviving vestige of the deleted compensating-delete pattern — the exact class of defect this
dimension was asked to hunt. It is documentation-only (behavior is correct), but it states the
*opposite* of the shipped rollback contract on the request type that *is* the wire contract, and
this epic has a repeated history of confidently-false comments outliving the code they describe.

### Change Requests

1. **`backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala:16-18`** —
   the doc for `CreatePipelineRequest`/`CreatePipelineTransactionalStepRequest` still asserts the
   deleted pattern: *"rolls back the ENTIRE call, **deleting the just-created pipeline** (which
   cascades to its steps and Outputs, V23/V94) -- see `PipelineService.create`'s doc for why this
   is a **compensating-delete rollback, not a single literal Slick transaction spanning multiple
   repositories**."* The shipped implementation is exactly the thing this sentence denies: one
   `.transactionally` chain via `PipelineRepository.runTransactionally`
   (`PipelineService.scala:159-167`). It also forwards the reader to a justification that no
   longer exists in `PipelineService.create`'s doc. Replace the last clause with the real
   contract (one Slick transaction spanning the three repositories; no compensating delete, no
   cascade-on-delete reliance).
2. **`backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala:96` and `:100`** —
   `create`'s doc still names `DbContext.withSystemContext` twice as the mechanism
   (*"`PipelineRepository.runTransactionally`, `DbContext.withSystemContext` under the hood"* and
   *"once `DbContext.withSystemContext` was confirmed able to run an arbitrary composed `DBIO`
   action"*). Cycle 7 switched this to `withUserContext` (`PipelineRepository.scala:300`), which
   changes the RLS posture, not just a name. Update both mentions to `withUserContext` so the
   service-layer doc matches the repository doc it is describing.

### Non-blocking notes

- `PipelineCreateTransactionalSpec.scala:167` — the second rollback test is named *"pipeline AND
  the already-created step gone"* but asserts only `pipelineRepo.listSummaries(owner, Some(tag))
  shouldBe empty`; it never observes the `pipeline_steps` row, and unlike its sibling it uses the
  repository path rather than a raw count. It is not vacuous here (both pools in that fixture are
  superuser, so `listSummaries` would still see a surviving row, and the step would cascade), but
  giving it the same raw `select count(*)` treatment on both tables would make it match its own
  name and match the sibling's rigour. evaluation-7.md's AC-1 line implies both rollback tests
  carry the raw-SQL assertion; only one does.
- `PublicDashboardRoutes.resolveDataAsOf` issues two queries per `OutputPanel` under a
  `Future.sequence` — an N+1 on an unauthenticated public route (bounded only by `Page.MaxLimit`).
  A single batched output→pipeline lookup would be a straightforward follow-up.
- `POST /pipelines/:id/steps` has no editor-grantee 200 case anywhere (only owner and cross-user
  404, plus viewer-denied). That gap predates this diff and `parentStepId` does not widen it, but
  it is the one route in my scope whose triad is inferred rather than tested.
