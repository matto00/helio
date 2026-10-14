## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 27a30bb97289040c44c8fae547d7b2fa8df8a208 (the change dir is untracked, so it is planning-only). cwd guard: `READY ambient=/home/matt/Development/helio branch=task/late-finisher-capture-at-start/HEL-1565`.

### What I verified (with evidence)

- **The seam claims in design.md Context are accurate** (`backend/src/test/scala/com/helio/services/pipelines/LateFinisherSpecBase.scala`):
  - `GatedRunRepo.updateRunTerminal` captures `terminalGate` at the start (l.82) but reads `terminalWritten` inside `.andThen` (l.84). Confirmed.
  - `HookSnapshotRepo.overwriteRowsWith` reads `nodeWrites`, `foldDone` and `afterNodeWrite` inside the `.flatMap`, after `super` completes (l.98-101). `nodeWrites` is a shared `val AtomicInteger` that is reset with `set(0)` (l.92, l.134). Confirmed.
  - `HookBackend.execute` reads `afterEngine` inside the `.flatMap` (l.55). Confirmed.
  - `HookOutputRepo` (l.64-67) and `HookBinaryRepo` (l.111-113) read their hooks at call start. Confirmed.
  - `afterEach` assigns fresh values (l.126-137). The specs are plain `AnyWordSpec` with no `ParallelTestExecution`, so tests run sequentially. Confirmed.
- **The consumers that would be hurt exist.** `LateFinisherDeleteAfterWonSpec` captures `terminalWritten` at test start in 4 tests (l.20, 30, 41, 55, 75) and `foldDone` in 3 (l.56, 76, 93), then gates deletes and binary writes on them. So the shape does matter for these specs.
- **FALSE: "a failed submit can return while the run's own terminal write is still in flight."** design.md Context, last bullet, states this as ground truth. The proposal's Why also presents a stray completion as a live flake path. I checked it against the production chain at this HEAD:
  - `PipelineRunSucceededWrites.scala:241-242` does start `updateRun` eagerly, and the chain (l.277-286) awaits it on success.
  - On failure, `PipelineRunDeletedRecovery.recover` (`PipelineRunDeletedRecovery.scala:35-38`) first runs `settle(siblings)`. The siblings include `updateMeta = updateRun.flatMap(...)` (l.243, l.290). It then runs `won.transformWith` on `updateRun` itself before any answer, success or failure.
  - `publishTerminalAfter` (`PipelineRunTerminalWrites.scala:34-42`) returns only after `writes` completes.
  - `GatedRunRepo`'s returned Future is the `.andThen` future. Scala's `andThen` completes only after its callback has run, so `terminalWritten.trySuccess` has already run before `updateRun` resolves.
  - Result: for the guard 404/409 and D7 paths, `submit` cannot return before the run's own terminal write and its callback are done. The node fold (inside `materializedWrites`, also a sibling) and the engine (`PipelineRunExecutor.scala:244-256`, sequential `transformWith`) are awaited too.
  - So in a passing run of the current specs, no seam call outlives its test. That matches the ticket's original "No current test is affected". The reachable trigger is a test that fails or times out (`submitWith`'s `Await.result(fut, 60.seconds)`, `awaitDb`) and leaves its chain in flight. That poisons the next test, so a single failure cascades into the following tests. That is a real reason to fix it, but it is not the one the artifacts state.
- **The ticket and ACs still justify the work.** The hazard's shape exists (AC1), and AC2-AC4 ask for the capture, the regression test and the mutation whether or not it is reachable today. Scope widening to `HookSnapshotRepo`/`HookBackend` is justified: the same file has the same shape, and the driver asked for a re-derivation. No production change is planned (C2). That is consistent with the evidence above, which shows no production defect.
- **Vacuity risk in D3/D4 for `HookSnapshotRepo`.** I reasoned it out against l.98-101 and l.134. On the unfixed base, a late old write after `nodeWrites.set(0)` gets `n = 1`, so `if (n == 2) foldDone.trySuccess(())` never fires on either promise. An assertion "NEW `foldDone` not completed" therefore PASSES on the base: it is not red-first. And "OLD `foldDone` completed" only holds after the fix if the old per-test counter was already at 1 when the held write started. D3's generic recipe ("hold, reset, release, assert OLD driven and NEW not") does not say this, and it only asks for "one test per affected seam". D4 mutates only "one `HookSnapshotRepo` capture". As planned, `foldDone` and the counter capture could ship with no failing proof.

### Verdict: REFUTE

### Change Requests

1. **Correct the false premise in design.md Context (last bullet) and proposal.md Why.** Replace "a failed submit (e.g. a node guard 404/409) can return while the run's own terminal write is still in flight" with what the code shows: since HEL-1564, `PipelineRunDeletedRecovery.recover` settles the siblings and `updateRun` before answering, and `publishTerminalAfter` waits for the chain. Cite `PipelineRunDeletedRecovery.scala:35-38` and `PipelineRunSucceededWrites.scala:241-243,288-291`. A PASSING test therefore cannot leave a seam call in flight. The live path is a failed or timed-out test (`submitWith`'s 60 s `Await`, `awaitDb`) that leaves its chain running into the next test, plus any future test that does not await its submit. Restate the justification as test-failure isolation and latent hazard. Keep D1's probe, but say that this reading is the expected outcome to confirm or refute, so evidence.md cannot repeat the false claim.
2. **Make the `HookSnapshotRepo` regression red-first for each captured field.** In D3 and task 1.2, spell out a forced ordering and assertion for each of the three, each shown red on the unfixed base:
   - **`afterNodeWrite`:** a late write calls the NEW hook.
   - **Node-write counter:** a late write increments the NEW counter.
   - **`foldDone`:** the OLD test has already done one write (counter at 1). Its second write is held, reset runs, the NEW test is at 1 (or the reset leaves 0 and the new test does one write). Releasing completes the NEW `foldDone` on the base and the OLD one after the fix.

   Also name the hold mechanism. `HookSnapshotRepo` has no delegate; the in-spec precedent is passing `andThen = DBIO.from(release.future)` (`LateFinisherRunSpec.scala:149-153`).
3. **Extend D4/task 2.2 so each capture can be shown to fail.** Revert each capture on its own: `terminalWritten`, `foldDone`, `afterNodeWrite`, the node-write counter and `afterEngine`. Show the matching test going red for each and restore it. Record all five in evidence.md. Mutating only one `HookSnapshotRepo` capture leaves the other two as unproven guards.

### Non-blocking notes

- D3's "the callback fires on any outcome" for an unknown run id is true for `.andThen`. But if `super.updateRunTerminal` fails, `Await.result` on the seam Future throws. Use `Await.ready` there, or assert the outcome explicitly.
- Capture-at-call-start isolates a call that STARTS during its own test. It does not cover a call that an outliving chain starts after `afterEach`: the fold's next node write, or `HookOutputRepo`, which consumes and resets `beforeOutputList`/`beforeNodeFold` at call start. That matches AC2's literal wording ("a call that outlives its test"). Name this limit in the spec doc comment so nobody reads the fix as full isolation.
- `binaryTarget` is not reset in `afterEach` (l.126-137). `HookBinaryRepo` reads it at call start, so it is harmless, but `resetSeams()` is the natural place to include it.
