## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 469f4ea9377729f90d32e640a22b61be3c487439 (planning artifacts untracked in the change dir).
Paths are relative to `backend/src/test/scala/com/helio/` unless stated.

### What I verified (with evidence)

- **Cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/audit-wall-clock-spec-races/HEL-1341`.
- **The escalation is real:** `.concertino/runs/HEL-1341/events.jsonl` line 7 has `escalation.raised`
  (options A/B/C, about OutputRoutesSpec:756). Line 12 has `escalation.answered`, `answer: "A"`,
  `answer_source: "human"`, and the same `escalation_id`. C6 records the ruling in tasks.md and in
  workflow-state.md CONSTRAINTS.

#### CR1 (inventory incomplete): mostly resolved

- Row 8a was added for `OutputRoutesSpec:756`. I re-read the site at :755-763. It is a bare `eventually {}`, and the
  class mixes in `Eventually` at :60 without overriding patience.
- D9 plus task 1.4 now fix the site with a named `BackfillMaterializedStateWaitDeadline = 5.seconds`. That follows
  ruling A.
- The comparison class holds. `ApiTokenAuthSpec:384-393` is a 5 s deadline with a 50 ms poll on a fire-and-forget
  write.
- The claim "the only `eventually` on the 150 ms default is row 8a" is verified:
  - `grep eventually` finds :756 plus sites in PipelineRunRegistrySpec (explicit 2 s), SparkJobSubmitterSpec
    (explicit 30 s), and AuthoringTelemetrySpec / AssistantTelemetrySpec.
  - AuthoringTelemetrySpec:68 and AssistantTelemetrySpec:59 override `patienceConfig` at class level (2 s).
- Rows 19-21 were added and cover every site round 1 listed.
- **Not resolved: the proposal's counts.** CR1 asked for them to be updated. See CR3 below.

#### CR2 (D4 sentinel barrier): resolved and sound

- Every site creates its own listener per test, so an exact `[sentinelPort]` assertion is per-test. This holds even
  at SqlConnectorRebindingSpec :60 and :94, which are separate tests. Sources: SqlEgressSocketFactoriesSpec:16-26/31-43,
  SqlConnectorRebindingSpec:36-46/56-63/80-97, SqlConnectorConfigShapeSpec:55-68.
- **The orchestrator's question:** the spec does not need the port before the acceptor records it.
  - After `new Socket(loopback, port)` returns, `getLocalPort` is fixed.
  - The acceptor's `accepted.getPort` (the remote port) equals it on loopback.
  - The barrier is a bounded *membership* poll over the queue, so it does not matter whether the acceptor appended
    first.
  - The FIFO argument holds. Every operation under test is synchronous. A stray completes its handshake, and so
    enters the accept queue, before the refused call returns. Only then is the sentinel opened.
- Non-blocking: "from a known local port" could be misread as binding a fixed port. "Read `getLocalPort` after
  connect" is the intended meaning.

#### CR3 (D2 test-controlled lock): resolved in structure, but the literal SQL is wrong

- (a) A test-held raw JDBC lock, (b) a mandatory ungranted-waiter wait, and (c) release then assert are all present.
  They mirror NodePayloadTrimPurgeLockOrderSpec:143-165. The "pg_sleep is not a race window" sentence is gone.
- I checked the semantics against live Postgres (local `helio` DB). Holding `pg_advisory_xact_lock(72901101)`
  (`PipelineCycleValidator.AdvisoryLockKey = 72901101L`, PipelineCycleValidator.scala:39) shows
  `locktype=advisory classid=0 objid=72901101 objsubid=1`. The high/low/1 split is correct.
- **The expression as written does not parse:**
  `select (72901101::bigint & x'FFFFFFFF')::oid` -> `ERROR: operator does not exist: bigint & bit`.
  With `x'FFFFFFFF'::bigint` it returns 72901101.
- `(key >> 32)::oid` also raises `OID out of range` for any negative key. I ran `((-5)::bigint >> 32)::oid` to
  confirm. This key is positive, so it is not a live bug, but the text presents it as the general form. See CR1 below.

#### CR4 (per-row proof table): resolved for most rows; row 7 is not discriminating

I checked each M for failability:

- **Row 1:** `fire_at = now` makes the t0+999 ms FakeClock tick fire, so NEW goes red. Failable.
- **Row 2 (T):** with a different key, or with tx1 released early, tx2 never appears as an ungranted waiter. The
  10 s wait times out and NEW goes red. Failable, and correctly labelled test-side.
- **Row 3 (T):** if the acceptor never starts, the state wait times out. Failable.
- **Rows 4-6:** if the refusal path connects, the stray precedes the sentinel and the list is `[stray, sentinel]`.
  Failable even with a slowed acceptor, because the barrier keys on the sentinel.
- **Row 8:** with the `originInstanceId` check removed, A's LISTEN connection gets its own NOTIFY before B's marker
  (commit order), so the list is `[queued, queued, marker]`. Failable even with delayed delivery.
- **Row 8a:** a disabled backfill means the `/rows` state never holds, so NEW goes red. The P is sound: 300 ms is
  past the 150 ms default.
- **Row 7: M is failable, but the P/M pair never shows that NEW beats OLD.** See CR2 below.

#### CR5 (D1 real-clock case): resolved

- D1 now says explicitly that only the elapsed measurement is gated: the `>= 1000L` assertion is removed and the
  `println` is gated.
- `pollUntil(scheduler, 10.seconds)(runCount >= 1)` plus `runCount shouldBe 1` stays unconditional. Task 1.1 says the
  same.
- This matches the live spec at DatasetWriteAutoRunEndToEndSpec:262-282, which has `pollUntil` at :151 and the
  assertion at :280.
- The FakeClock convention exists at DatasetWriteAutoRunCoalescingSpec:90/157. A whole-second t0 was adopted, which
  was a round-1 note.

### Verdict: REFUTE

All three revisions are small text edits. None reopens the approach.

### Change Requests

1. **D2: correct the `pg_locks` match so it executes.**
   - design.md D2 currently reads `objid = (key & x'FFFFFFFF')::oid`. That is a SQL error (`bigint & bit`), verified
     above.
   - Write it as `objid = (key & x'FFFFFFFF'::bigint)::oid`. Alternatively, because the key is the positive
     constant 72901101 < 2^32, state the resolved match `classid = 0 AND objid = 72901101 AND objsubid = 1`.
   - State that the `::oid` form assumes a non-negative key. A negative key raises `OID out of range`.
   - If the executor copies the current text verbatim, the waiter poll errors on its first iteration. Fix it in the
     design.

2. **D7 row 7 / D5: name a probe where OLD passes and NEW goes red.**
   - The current P is "fire-and-forget delete plus slow completion: OLD passes". Under the reading where the
     rotation's future completes slowly after the delete, D5 itself admits NEW also passes.
   - The current M is "delete not awaited". With no injected delay, the rotation completes at once and OLD is red
     too.
   - So no row 7 proof shows that the blocked-state barrier adds anything.
   - The barrier's real value is the case where the rotation is slow to *reach* its delete. In that case OLD's
     1500 ms poll ends while the rotation is still in pre-delete work, and OLD passes vacuously.
   - Revise row 7 to: delay injected before the rotation issues its delete (> 1500 ms) **combined with** the
     not-awaited mutation. OLD passes (vacuous) and NEW goes red. Once the barrier sees the blocked delete, the
     un-awaited rotation has already completed.
   - Keep the plain M as the NEW-red check. Task 3.2 should reference the combined probe for row 7.

3. **Bring proposal.md and the design's counts in line with the revised inventory.** Each item is an internal
   contradiction an evaluator will trip over during the scope check:
   - proposal.md Impact says "in at most seven spec files". design.md says 8 files: rows 1-8 cover 7 files, plus
     OutputRoutesSpec. D4 also allows a shared helper, which is a 9th test-source file and not a spec.
     - Update the proposal.
     - Update task 3.4 ("lists only spec files") to allow the D4 helper if one is created.
   - proposal.md says the V rewrites are "seven sites in five files". Rows 4-8 are 1 + 2 + 1 + 1 + 1 = **6** sites
     in 5 files.
   - design.md says "10 sites (rows 1-8)". Rows 1-8 are 1+1+1+1+2+1+1+1 = **9**, so the total with 8a is 10.
   - design.md Goals/Non-goals says "rows 9-18 production hooks". It is now 9-21. The Planner Notes say "a fix count
     of 7".

### Non-blocking notes

- D6: `capturedA` is a non-thread-safe `mutable.Buffer` appended from the stream thread. When it is waited on by
  content, use a concurrent collection (for example `ConcurrentLinkedQueue`) so the poll reads safely.
- D8 notes from round 1 still apply and are not yet in tasks 4.2: use a full `gh run rerun`, not `--failed`, and
  record each run's head SHA.
- D3 / task 1.3 names a 5 s deadline. If it becomes a constant, give it a name in line with C6.
- I did not run sbt. This is a design gate with no code changed.
