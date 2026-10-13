## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 67cf9e0e0451b781be463e82db25c57a8c8795bf. The planning artifacts are untracked in the change dir
(ticket.md, proposal.md, design.md, tasks.md, specs/stored-object-lifecycle/spec.md).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/form-assistant-blob-cleanup/HEL-1530`.
- **V132 is still free.** After `git fetch`, `origin/main` tops out at V130. Of all open PRs, only #994 adds a
  migration (`V131__patch_set_applied_proposals.sql`), from `gh pr diff --name-only` per PR.
- **Round-2 CR1(a) is closed.** D7 now names the reachable post-commit failure sources. I checked the claim against
  the code:
  - `triggerAutoRunAwaited` is `autoRunTriggerService.triggerAutoRun(...).map(...).recover(...)`
    (`DataSourceService.scala:126-134`). A synchronous throw from `triggerAutoRun` happens before `.recover` is
    attached, so it escapes `triggerAutoRunAwaited`.
  - The call sits inside the lambda of `dataSourceRepo.appendBuiltRow(...).flatMap` (line 922; the call is at
    930). `Future.flatMap` turns a NonFatal throw into a failed future, after the append transaction committed.
  - `RowWriteResult.fromRepositoryRows` (line 931) is in the same position.
  - D7 drops the false `audit` / async `triggerAutoRun` sources. The minor imprecision ("escapes the `flatMap` at
    ~line 930") is harmless: the throw is caught by the line-922 flatMap, and the outcome is exactly what D7 claims.
- **Round-2 CR1(b) is closed.** Task 3.3 now requires all four assertions: non-2xx; exactly one committed row; a
  `form_submit_failed` row with `claimed_at='infinity'` and `not_before` about now+900 s; and, after the grace window
  and a drain pass, the queue row is gone while the object still exists. These assertions make the test unable to
  pass except through D7 plus the Authoritative branch:
  - A swallowed (async) failure gives 201 and turns the test red.
  - A missing enqueue leaves no queue row, so the test goes red.
  - A guard without the dataset-Authoritative branch deletes the object, so the test goes red.
- **Round-2 CR1(c) is closed.** The rolled-back variant asserts deletion after grace plus a pass, and carries the
  mutation check "removing the enqueue turns it red".
- **Round-2 non-blocking notes:**
  - **Folded in:** attempts bump, backoff formula and cap on both claim clauses, deferral never bumping (D6). Also the
    rollback / overlap deploy notes (Migration Plan), and the partial `storeFormFiles` failure (D7 bullet, spec
    scenario, task 3.3). Task 3.5 now reports the `stored_object_deletions` count before and after the suite.
  - **Picked but not reconciled:** the `lease_until` semantics. See note 2.
- **D7 safety rests on facts I re-checked.** `appendFormRow`'s only post-append steps are `audit` (returns `Unit`,
  `DataSourceService.scala:79-81`), `triggerAutoRunAwaited` and `fromRepositoryRows`. The pinned HEL-1434 test is at
  `FormSubmitRoutesSpec.scala:541`. It injects a rolled-back append failure (a wrong-shaped schema in `afterWrite`),
  so it can be flipped as task 3.3 says.
- **Queue schema accepts the new source_table value.** V128's `source_table` is `TEXT NOT NULL` with no CHECK
  constraint, so `form_submit_failed` is insertable. The new columns are additive (D1). V128 is not edited.
- **No contradictions between proposal, design, spec delta and tasks.** Every AC in ticket.md maps to a task:
  - AC1: 1.3, 3.1, 3.2.
  - AC2: 1.4, 3.1.
  - AC3: 2.1-2.3, 3.2.
  - AC4: 1.5, 3.1.
  - AC5: 2.4, 3.3.
  - AC6: C2, 3.1.
  - AC7: C1, 3.6.

  No placeholders and no TBD.

### Verdict: CONFIRM

### Non-blocking notes

1. **Test 3.3's named seam does not exist in `FormSubmitRoutesSpec` as wired today.** `AutoRunTriggerService` is a
   `final class` (`AutoRunTriggerService.scala:33`). `ApiRoutes` builds it internally from its own
   `PipelineRootRepository` (`ApiRoutes.scala:248,263-266`), and only when `autoRunDebounceRepo` is passed. The spec
   passes none (`FormSubmitRoutesSpec.scala:183-189`), so `autoRunTriggerService` is null there. The only injectable
   repos (debounce, pipeline) are reached inside `evaluateOne`'s `.recover`, which swallows. A "stub whose
   `triggerAutoRun` throws synchronously" therefore needs one of two things: a production-code change (drop `final`,
   or add an `ApiRoutes` param), or an equivalent seam.
   - The cheapest faithful equivalent: a `DataSourceRepository` subclass (the class is not final,
     `DataSourceRepository.scala:24`) whose `appendBuiltRow` returns `super.appendBuiltRow(...).flatMap(_ =>
     Future.failed(...))`. This is a committed append whose future fails, which is exactly what D7 must handle.
   - Whatever seam is used, the four assertions guard against a false green, because a swallowed failure returns 201.
   - Recommendation to the executor: use such a seam rather than loosening `final` only for a test, and record the
     choice in files-modified.md.
2. **`lease_until` is still read two ways.** D6 now says `lease_until` holds the lease *expiry* (claim time +
   `leaseSeconds`), but the claim predicate still reads `lease_until < stale`. If `stale` = now − lease, that
   reclaims only after twice the lease. This is safe, since it only delays work and never double-processes it. The
   repository should compare `lease_until < now()`, and its doc comment should say so.
3. **Partial `storeFormFiles` compensation must wait for every sibling write to settle.** `Future.traverse` fails as
   soon as one write fails, while other writes may still be in flight, and the keys are generated inside the
   traverse. If the code deletes "already written" keys at that moment, a sibling write that lands afterwards is
   leaked. That is a leak, never a wrong delete.
   - Fix: pre-generate the keys, settle every write (`transform(Success(_))`), and only then remove the successful
     ones.
   - Alternative: route all of the submit's keys through D7's grace-window enqueue.
   - The task 3.3 partial-failure test should include a slow sibling write.
