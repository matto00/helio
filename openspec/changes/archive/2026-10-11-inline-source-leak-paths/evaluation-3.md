## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed commit: 4aa54e3f8f2447db1bc211bcf2c343f5410d9d5b (base resolved live: bcb0e891923094c1a1e85ecc053f30a73ee6d70f).
Scope: the delta c123f4239..4aa54e3f8, which answers the change requests in skeptic-final-1.md. Logs are in the run dir:
`/home/matt/Development/helio/.concertino/runs/HEL-1475/HEL-1475-eval3-head.log` and `HEL-1475-eval3-mut.log`.

### Phase 1: Spec Review — PASS
Issues: none.
- **Skeptic CR1 (proposal-apply Connector cleanup untested).** The new `PipelineProposalImplicitConnectorCleanupSpec` runs
  `PipelineProposalService.apply` with real repositories and no fault injection. The first root is a bare-url `rest_api`
  source; the second names an unknown `sourceId`, which makes the apply return NotFound and roll back through `resolvedSoFar`
  (`PipelineProposalService.scala:146`). The test checks that the `data_sources` and `connectors` counts for the exact owner
  id are unchanged. This covers the AC2 "pipeline-proposal apply's own failure cleanup" site.
- **Skeptic CR2 (query (a) mislabelled).** `prod-count-queries.md` query (a) is now labelled an UPPER BOUND with mixed causes:
  this leak, ordinary source deletes (`DataSourceService.delete` never removes a Connector), and failed creates before the fix.
  The query text is unchanged and read-only.
- red-evidence.md has a Cycle 3 section that records both items.

### Phase 2: Code Review — PASS
- **Production delta:** one line in `SourceService.scala:198`. `createRestWithConfig(...)` is now wrapped in
  `Future.unit.flatMap(_ => ...)`, so a synchronous throw after `connectorRepo.create` still reaches the `transformWith`
  Connector cleanup. Success and error results are unchanged. This answers the skeptic's non-blocking note and follows the
  same `Future.unit.flatMap` idiom already used in `InlineSourceCompensation` and `cleaningUpOnFailure`. No new test pins
  the sync-throw case; that is acceptable for a defensive one-liner (non-blocking).
- **Fresh targeted run on HEAD:** `PipelineProposalImplicitConnectorCleanupSpec`, `SourceCreatePostInsertCleanupSpec`
  (it exercises the changed `createRest` path), `*PipelineApplyProposalSpec` and `*PipelineProposalService*Spec`.
  Result: **34 succeeded, 0 failed**, `[hel1468-guard] failed=0`.
- **My own mutation on the new spec,** chosen to differ from the executor's. The executor forced the flag to `false` where
  it is set, in `resolveRestSource`. I instead dropped the flag where it is consumed: in `rollbackSourceOnly` I changed
  `cleanupSource(resolved.id, resolved.implicitConnector, user)` to `cleanupSource(resolved.id, false, user)`. I ran this in
  a throwaway detached worktree at 4aa54e3f8, removed afterwards. The spec goes RED: `1 was not equal to 0`
  (`PipelineProposalImplicitConnectorCleanupSpec.scala:95`), `[hel1468-guard] failed=1`.
- **The executor's claimed logs exist and match what was claimed:**
  - `HEL-1475-c3-mutation.log`: RED, `1 was not equal to 0`, `[hel1468-guard] failed=1`.
  - `HEL-1475-c3-green.log`: 1/1, `[hel1468-guard] failed=0`.
  - `HEL-1475-c3-testFull.log`: **6824 succeeded, 0 failed, 4 canceled**, `[hel1468-guard] failed=0`. That is 6822 from
    cycle 1 plus the cycle-2 route test plus this spec. Both new tests are named in the log.
- **How the testFull was tied to this commit:** the log's mtime (05:22) equals the commit time (05:22:51). This rests on
  mtime only, and I state it as such. Corroborating it, the test count rose by exactly the two added tests and the new
  spec's name appears in the log. I accept the run and did not re-run testFull.
- **Constraints C1, C2, C4, C5:** the new spec uses `VerifiedEmbeddedPostgres.start` and has imports only (no inline FQNs).
  No engine, migration, schema, protocol or route change.
- **Minor (non-blocking):** the new spec passes `null` for one `PipelineProposalService` constructor argument, which matches
  existing spec conventions for unused collaborators.

### Phase 3: UI Review — N/A
No UI-trigger paths changed.

### Overall: PASS

### Non-blocking Suggestions
- Carried over: `SourceService.scala` and `PipelineProposalService.scala` are above the ~400-line split threshold. Note a
  split in the PR description.
- Carried over from the skeptic's note: the proposal's own `newConnector` cleanup belongs in the 4.5 follow-up.
- `evaluation-3.md` (this file) is untracked. Commit it with the archive, alongside evaluation-1.md and evaluation-2.md.
