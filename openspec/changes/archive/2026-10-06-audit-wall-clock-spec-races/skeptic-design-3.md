## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 469f4ea9377729f90d32e640a22b61be3c487439 (planning artifacts untracked in the change dir).
Paths are relative to `backend/src/test/scala/com/helio/` unless stated.

### What I verified (with evidence)

- **Cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/audit-wall-clock-spec-races/HEL-1341`.
- **Escalation ruling (C6 / D9):** `.concertino/runs/HEL-1341/events.jsonl` line 7 is `escalation.raised` (options
  `A-explicit-5s-state-wait,B-leave-and-follow-up,C-prod-seam-in-this-PR`, about OutputRoutesSpec:756). Line 12 is
  `escalation.answered` with `answer: "A"`, `answer_source: "human"`, the same `escalation_id`, and t=1791351978188
  (2026-10-07 05:46 UTC, which matches D9's date). C6 is in tasks.md and in the workflow-state.md CONSTRAINTS.

#### Round-2 CR1 (D2 SQL must execute): RESOLVED

- design.md D2 now reads `objid = (key & x'FFFFFFFF'::bigint)::oid`. It also gives the resolved literal match
  `classid = 0 AND objid = 72901101 AND objsubid = 1` and states the non-negative-key assumption.
- I ran it against live Postgres. `select (72901101::bigint >> 32)::oid, (72901101::bigint & x'FFFFFFFF'::bigint)::oid`
  returns `0 | 72901101`.
- **Two-session probe:**
  - A holder psql session took `pg_advisory_xact_lock(72901101)` and slept 4 s. A second session then blocked on the
    same key.
  - The exact D2 predicate (`locktype='advisory' AND NOT granted AND classid=(k>>32)::oid AND
    objid=(k & x'FFFFFFFF'::bigint)::oid AND objsubid=1`) returned the waiter row (`advisory | f | 0 | 72901101 | 1`).
    The literal-constant form matched too.
- **First reading was anomalous; reproduced cleanly:**
  - The first run showed 2 ungranted rows. A third session on the shared dev DB was probably present (a `sbt run`
    dev server is live).
  - A re-run with pid detail showed exactly 1 granted holder and 1 ungranted waiter.
  - This does not affect the spec. `PipelineCycleDetectionServiceSpec` uses its own per-suite `EmbeddedPostgres`
    (:40, :52, :57), so no foreign waiter can satisfy its barrier.
- `PipelineCycleValidator.AdvisoryLockKey = 72901101L` (main PipelineCycleValidator.scala:39) is confirmed.

#### Round-2 CR2 (row 7 probe: OLD passes, NEW red): RESOLVED

- The D7 row 7 P is now "> 1500 ms delay before the rotation issues its delete, COMBINED with the not-awaited
  mutation: OLD passes, NEW red". The plain not-awaited M is kept. Task 3.2 references the combined probe.
- I checked it against the live spec (ConnectorRepositorySpec:433-472) and production
  (ConnectorRepository.scala:222-261, where the delete is the last action of the rotation transaction at :252).
  - **OLD:** the 1500 ms `isCompleted` poll ends while the rotation is still in its injected pre-delete delay.
    `isCompleted shouldBe false` holds, so OLD passes vacuously.
  - **NEW:** the barrier waits until the delete is blocked on the holder's `FOR UPDATE` row lock. With the delete not
    awaited, the rotation future has completed by then, so the unchanged poll sees `isCompleted` and goes red.
- The pair now proves that the barrier adds something.

#### Round-2 CR3 (counts agree): RESOLVED

I recounted from the inventory.

| Group | Rows | Sites | Files |
|---|---|---|---|
| F | 1, 2, 3, 8a | 4 | |
| V | 4, 5 (x2), 6, 7, 8 | 6 | 5 |
| Total | | 10 | 8 |

The 8 distinct spec files are: DatasetWriteAutoRunEndToEnd, PipelineCycleDetection, SqlEgressSocketFactories,
SqlConnectorRebinding, SqlConnectorConfigShape, ConnectorRepository, PipelineRunCrossInstance and OutputRoutes.

Every artifact agrees with these numbers:

- **proposal.md:** "three sites, plus OutputRoutesSpec:756"; "six sites in five files"; "8 spec files plus at most one
  shared test helper".
- **design.md fix count:** "rows 1-8 are 9 sites in 7 spec files; with row 8a, 10 sites in 8 spec files".
- **design.md other sections:** Goals/Non-goals say "rows 9-21". Planner Notes say "8 spec files (10 sites)".
- **tasks.md 3.4:** "spec files (8), at most one shared D4 test helper".

#### Independent re-verification of the inventory and decisions

- **Sleep-site count:** `grep -rn "Thread.sleep|pg_sleep"` over the spec tree finds 20 code sites in 15 files. This
  excludes the `pg_sleep` mention in the comment at PipelineCycleDetectionServiceSpec:463. design.md's "20 sites in
  15 spec files" holds.
- **Inventory line numbers:** every row 1-8a line number matches the live tree. Rows 1 (:279), 2 (:489) and 3/4
  (:68/:41) are correct, as are rows 5 (:60/:94), 6 (:66), 7 (:458), 8 (:151), 8a (:756) and 9 (:780).
- **Row 1 (F) mechanism:** confirmed at DatasetWriteAutoRunEndToEndSpec:264-280. `startNanos` is taken after
  `triggerAutoRun` returns, while `fire_at` is anchored at `lastWriteAt`. So elapsed is about 1 s minus the trigger
  time, and a slow trigger makes it red.
- **D1 boundary:**
  - The claim SQL is `WHERE fire_at <= $nowTs` (PipelineAutoRunDebounceRepository.scala:56). So t0+1000 ms fires
    inclusively and t0+999 ms does not.
  - `PipelineSchedulerService` takes a `Clock` at :28.
  - The `FakeClock` convention exists in DatasetWriteAutoRunCoalescingSpec:90.
  - The `fire_at = now` mutation fires at t0+999 ms, so NEW goes red.
- **D2 proof pair:**
  - The P (300 ms delay before tx1) turns OLD red, because tx2 takes the lock first and its acquisition precedes
    tx1's release by more than 50 ms.
  - NEW is unaffected by the P, because tx1 is held synchronously before tx2 starts.
  - Both T mutations make the mandatory waiter wait time out.
- **Row 8 / D6:**
  - The live site (PipelineRunCrossInstanceSpec:140-153) uses a non-thread-safe `mutable.Buffer`. D6 now requires a
    concurrent collection and a non-terminal marker.
  - The commit-order argument holds, and the bus-relay fallback is stated.
- **Row 8a P:** a 300 ms backfill delay exceeds the 150 ms default patience, so OLD goes red. NEW has a named 5 s
  state wait, so it stays green. A disabled backfill turns NEW red.
- **Round-2 non-blocking notes:**
  - D6's concurrent collection and D8's full `gh run rerun` / head SHA are both folded in.
  - D3's deadline is named `AcceptStateWaitDeadline` (task 1.3).
- **Scope:** every AC is covered.
  - AC1 (inventory) is the design.md table.
  - AC2 (fixes plus a probe or mutation per fix) is D1-D7, D9 and tasks 1-3.
  - AC3 (trial plus the default escalated) is D8 and tasks 4.x.
- **Driver constraints:** C1-C6 are recorded. No `ci.yml` change is planned in this PR.
- I did not run sbt. This is a design gate and no code has changed.

### Verdict: CONFIRM

All three round-2 change requests are fixed in substance, not just reworded: the SQL executes and matches the live
waiter, row 7 now has a discriminating probe pair, and the counts agree across all three artifacts. The revisions
introduced no new contradiction or placeholder.

### Non-blocking notes

- **D7 row 7 delay placement.** The injected delay must sit on the rotation future's own path, before the delete is
  issued and before the future completes. If the executor puts the delay inside the fire-and-forget branch, the
  rotation completes at once and OLD also goes red, so the probe proves nothing. The design's parenthetical implies
  the correct placement. The evaluator should check that the transcript shows OLD green.
- **D5 deadline.** D5's blocked-state barrier says "wait (bounded)" but names no deadline constant. Name one per C6,
  as D3 and D9 do.
- **D5 query.** For D5's `pg_locks` option, a row-lock wait shows up as an ungranted `transactionid` (or `tuple`) lock,
  not a lock on the table. `pg_stat_activity` with `wait_event_type = 'Lock'` and a query matching the
  `connector_credentials` delete is the simpler, unambiguous barrier.
- **D9 wording.** D9 says "ruled by the driver", but the event records `answer_source: "human"`
  (`resolution_channel: chat`). This is cosmetic.
