## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 67cf9e0e0451b781be463e82db25c57a8c8795bf. The planning artifacts are still untracked in the change
dir: ticket.md, proposal.md, design.md, tasks.md and specs/stored-object-lifecycle/spec.md.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/form-assistant-blob-cleanup/HEL-1530`.
- **V132 is free.** After `git fetch`, the highest migration on `origin/main` is V130. The open PRs are #996, #994,
  #991, #990, #986 and dependabot PRs, which matches round 1's per-PR diff check. Task 1.1 re-checks before push.
- **Round-1 CR1 (dataset authoritative only via the trigger's extraction) is closed.**
  - D5 now defines `dataset_rows` Authoritative as exactly D2's extraction: `lax $.**.storageKey`, string type,
    form-upload regex. Every other dataset hit, including bare strings and non-form keys, is DerivedOnly and deferred.
  - The spec carries "A `dataset_rows` row counts as holding a key in this authoritative sense only when its delete
    would record that key", plus the scenario "Non-form key copied into a dataset row".
  - Task 3.2 tests an image or transcript key copied into a dataset row.
  - The invariant is consistent: each Authoritative class has a re-queue path. `image_uploads` and `data_sources` use
    V128's row triggers (V128:41-71). `assistant_conversations` uses D3. `dataset_rows` uses D2 DELETE/UPDATE with the
    same extraction.
- **Round-1 CR2 (old drain can never claim new-style rows) is closed.**
  - I read V128's claim predicate in `StoredObjectDeletionRepository.claim` (lines 27-38):
    `attempts < max AND (claimed_at IS NULL OR claimed_at < $stale) AND <backoff>`. With
    `claimed_at = 'infinity'`, both disjuncts are false for any finite `$stale`.
  - V128's `dequeue` and `recordFailure` act only on ids the old process itself claimed, so they can never touch a
    new-style row. Nothing else in `src/main` touches the queue (grep `stored_object_deletions`).
  - D6 routes all of these through `not_before`/`lease_until` and never touches `claimed_at`: trigger inserts, the D7
    enqueue, deferral (which also converts a deferred legacy row to new-style) and new-style failure backoff.
  - Task 3.2a runs V128's SQL verbatim against all four new-style row kinds.
  - Crash recovery of a leased new-style row: `lease_until` lapses and the row is reclaimable by the new claim only.
  - Legacy rows that V128's two unchanged triggers write in the overlap can still be taken by an old drain with its
    2-table guard. That is V128's status quo, not a regression.
- **D7's safety argument holds.** `withUserContext` is `db.run((setUserVar andThen action).transactionally)`
  (`DbContext.scala`), so the future completes only after COMMIT or ROLLBACK. `appendBuiltRowAction` is one DBIO
  under `lockSource`. No timeout combinator wraps the append, and a Pekko request timeout does not fail the inner
  future. A committed row is Authoritative to the guard, so the files are kept.
- **Grants:** D1 grants SELECT on `dataset_rows` and `assistant_conversations` for the definer. The guard reads
  `binary_refs`, `node_snapshots`, `node_payload_history` and `alert_events` on the privileged pool, which existing
  repositories already do through `withSystemContext` (`BinaryRefRepository`, `NodeSnapshotRepository`,
  `NodePayloadHistoryRepository`, `AlertEventRepository`). The column names D5 uses exist: `node_snapshots.data`
  (V94:278), `node_payload_history.rows` (V116), `alert_events.value` JSONB (V61), `binary_refs.storage_key` (V46).
  `dataset_rows.id` is a TEXT primary key (V106), so D2's UPDATE diff by id is well-defined.
- **Round-1 non-blocking notes:** all four were folded in.
  - `alert_events` was added to the guard and the spec.
  - The legacy `pipeline_id IS NULL` `binary_refs` gap is documented, and the OWNER REVIEW query counts it.
  - The README updates are task 2.5.
  - The OWNER REVIEW draft is task 3.6.
- **Round-1 CR3 is only half closed (see CR1 below).** The rationale paragraph is now correct. It no longer claims any
  timeout, and `grep statement_timeout|lock_timeout backend/src/main` still finds none. But the named
  "committed-then-failed" source is wrong in the live code:
  - `DataSourceService.triggerAutoRunAwaited` (lines 126-134) ends in
    `.recover { case ex => log.error(...); Vector.empty }`, so an async failure of `triggerAutoRun` can never fail
    `appendFormRow`'s future.
  - `audit` (lines 79-81) returns `Unit`. It calls `AuditService.record`, whose Future "always completes
    successfully" and catches even a synchronous repository throw (`AuditService.scala:20-55`). It is not chained
    into the returned future either.
  - Round 1's CR3 asserted that `triggerAutoRunAwaited` "can fail after the row committed". That premise was mine to
    verify and it was wrong. The revision then propagated it into design.md D7, the spec rationale and task 3.3.

### Verdict: REFUTE

### Change Requests

1. **D7's "real committed-then-failed case" names a failure that cannot happen, and task 3.3 as written passes
   without exercising D7.** design.md D7 says the row commits and then "`triggerAutoRunAwaited` ... or audit fails
   the future". Neither can.
   - `triggerAutoRunAwaited` recovers every async failure to `Vector.empty` (`DataSourceService.scala:130-133`).
   - `audit` is fire-and-forget and never fails (`DataSourceService.scala:79-81`; `AuditService.record`).

   The natural way to implement 3.3 ("a failing `triggerAutoRunAwaited` keeps files") is a stub
   `AutoRunTriggerService` whose `triggerAutoRun` returns `Future.failed`. That stub is swallowed: the submit returns
   201 down the `Right` path, the files are kept trivially, and D7's enqueue and the guard's Authoritative branch
   never run. The test would be green while proving nothing. The OWNER REVIEW reader would also be told about a
   failure mode that does not exist.

   **Required:**
   - (a) Rewrite the D7 bullet to state the actual post-commit failure sources in today's code. These are a
     *synchronous* throw from `autoRunTriggerService.triggerAutoRun` (thrown before a Future exists, so the
     `.recover` never sees it, and it escapes the `flatMap` at line 930), a throw from
     `RowWriteResult.fromRepositoryRows` (line 931), or any future post-commit step. Alternatively, state plainly
     that no committed-then-failed path is currently reachable through normal failures and that D7 guards against it
     defensively.
   - (b) Respecify 3.3's committed-then-failed test so it can only pass through D7. Inject a failure that provably
     reaches `appendFormRow`'s future after commit (for example, an `AutoRunTriggerService` stub that throws
     synchronously from `triggerAutoRun`). Assert all of the following:
     - the response is non-2xx (the failure path was taken);
     - exactly one `dataset_rows` row committed;
     - a `form_submit_failed` queue row exists for the key, with `claimed_at = 'infinity'` and `not_before` about
       900 s out;
     - after advancing the clock past the grace window and running a drain pass, the queue row is gone and the
       object was NOT deleted (Authoritative dequeue).
   - (c) Keep the rolled-back variant asserting the object IS deleted after the grace window. It must also be
     mutation-checked: with the D7 enqueue removed, it goes red.

### Non-blocking notes

- **Attempt cap and backoff on new-style rows are underspecified.** D6 says failure backoff "only move[s]
  `not_before`" but says nothing on two points:
  - whether `attempts` is bumped;
  - whether the new-style claim clause keeps `attempts < maxAttempts`.

  Its claim clause as written has no attempts filter, so a permanently failing key would retry forever. That is
  harmless but differs from the legacy rows. Pin both points: bump `attempts` and stamp `last_attempt_at`, set
  `not_before = now + LEAST(3600, 60·2^(attempts-1))`, and apply the cap to both clauses. Keep the rule that a
  DerivedOnly deferral never bumps `attempts`.
- **`lease_until` naming versus the `< stale` comparison.** If it stores the claim time, `< now - lease` is right. If
  it stores `now + lease`, comparing against `stale` doubles the lease. Both readings are safe, because a longer lease
  only delays the work and never double-processes it. Pick one in the repository doc comment.
- **Rollback.** The OWNER REVIEW should say that after a rollback, V132's triggers keep enqueuing new-style rows that
  no one drains until the new revision returns. This is accumulation only, with nothing deleted. It should also say
  that the overlap old drain still processes V128-trigger (legacy) rows with its 2-table guard, as it does today.
- **Partial `storeFormFiles` failure.** If one of several file writes fails, the files already written are not
  compensated, because the failure happens before `appendFormRow`. This is outside AC5's literal scope. List it as a
  known gap or cover it with the same D7 enqueue.
- **TRUNCATE triggers on the shared dev/test database.** Many specs run `TRUNCATE ... data_sources/users CASCADE`
  (grep of `backend/src/test`). After V132, every such truncate full-scans and enqueues keys, and nothing drains them
  in the test DB. Task 3.5's full-suite run should report the queue size afterwards, so an unbounded growth problem
  is seen rather than assumed away.
