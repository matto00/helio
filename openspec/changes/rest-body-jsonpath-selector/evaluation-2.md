## Evaluation Report — Cycle 2 (evaluation-2.md)

### Context

Re-evaluation of the fix for evaluation-1.md's sole Change Request (CR1). Prior Phase 1 (spec
review) and Phase 3 (live UI review) findings carry forward unchanged — this cycle's diff
(`7c8dc2dc..004fded8`) touches only `SourceService.scala`, `SourceServiceSpec.scala`, and this
change dir's own `evaluation-1.md`, all backend-only, no reason to suspect the frontend/UI findings
are stale.

### Phase 1: Spec Review — PASS (unchanged from cycle 1)

No new scope introduced by this fix — it is a pure reordering of an existing check plus a
regression assertion, exactly matching what CR1 asked for.

### Phase 2: Code Review — PASS

**Fix verified by direct diff read, not by trusting the commit message.** In
`SourceService.scala`'s bare-`url` branch of `createRest`:

- `RestApiConfig.rejectBodyOnSafeMethod(request.config.method.getOrElse("GET"),
  request.config.body)` now runs as the **first** operation inside the branch, evaluated directly
  against the raw `request.config` (method/body are both available there — no need to wait for
  `createdConnector.id`).
- `connectorRepo.create(...)` (the persistence + credential-encryption call) now only executes
  inside the `Right(())` arm, i.e. strictly after the guard passes.
- The `RestApiConfig(...)` construction and `createRestWithConfig` call are unchanged, just moved
  inside the same `Right(())` arm, after `connectorRepo.create`'s `.flatMap`.
- This exactly matches design.md Decision 3's stated placement ("before constructing
  `RestApiConfig`") and closes the orphaned-Connector-row side effect CR1 identified — a rejected
  GET+body bare-url create can no longer reach `connectorRepo.create` at all.

**Regression test verified, not just cited.** `SourceServiceSpec.scala`'s existing "reject a
GET+body request immediately... via the bare-url branch" test was extended (not merely renamed) to
capture `connectorRepo.findAll(user).size` before and after the rejected create call, asserting
`countAfter shouldBe countBefore`. I confirmed this by reading the diff hunk directly — the
assertion is real, not decorative — and by observing (below) that this specific test now passes
without a `NoKeyConfigured` failure, where it previously failed on exactly that gap (proving the
guard now fires before any DB/encryption call, in this environment as well as by inspection).

**Gates re-run fresh (not trusted from the executor's report):**
- `npm run lint` — PASS (0 warnings) — no frontend files touched this cycle, but re-run per policy
  anyway.
- `npm run typecheck` — PASS
- `openspec validate rest-body-jsonpath-selector --strict` — PASS ("Change ... is valid")
- `cd backend && sbt test` — **3582 succeeded / 14 failed** (down from 3581/15 in cycle 1),
  matching the executor's reported count exactly. I independently re-ran just the 5 previously-
  failing spec classes (`PipelineApplyProposalRollbackSpec`, `ApiRoutesSpec`,
  `DataSourceRoutesSpec`, `AuditMutationInstrumentationSpec`, `SourceServiceSpec`) and confirmed by
  name that the specific bare-url regression test ("...without persisting an orphaned implicit
  Connector") **no longer appears in the failed list** — it now passes. The remaining 14 failures
  are all still `ConnectorCredentialEncryptionFailed: ... NoKeyConfigured`, the same pre-existing
  environmental class established as a 13-failure `main` baseline in cycle 1 (independently
  verified then via a throwaway detached worktree at `main`), plus the one still-remaining new test
  ("...via the connectorId branch") that hits the same environmental gap for an unrelated reason
  (it exercises the connectorId path's own `toDomain`→`createRestWithConfig`→persistence flow,
  which was never part of this fix's scope). 13 baseline + 1 remaining new-but-env-gated = 14,
  consistent with the drop from 15→14 the fix should produce. No new failure class was introduced.

No other files were touched this cycle, so the rest of cycle 1's Phase 2 findings (canonical
compliance, DRY, security, decode-is-total invariant, etc.) stand unchanged and are not re-litigated
here.

### Phase 3: UI Review — PASS (carried forward from cycle 1, unaffected by this backend-only change)

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- (Carried from cycle 1, still open, non-blocking) Consider naming
  `RestApiConnectorDriverBodySpec.scala`'s real-echo-server coverage explicitly in the PR body
  alongside the hostile-template assertion so a future reader doesn't have to rediscover it exists.
