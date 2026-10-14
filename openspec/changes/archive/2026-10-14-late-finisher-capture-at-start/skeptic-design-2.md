## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 27a30bb97289040c44c8fae547d7b2fa8df8a208 (the change dir is untracked; there is no code diff at this gate).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/late-finisher-capture-at-start/HEL-1565`.
- **Seam ground truth (`LateFinisherSpecBase.scala`):**
  - l.82-84 `GatedRunRepo` captures `terminalGate` at call start but reads `terminalWritten` inside `.andThen`. Confirmed.
  - l.98-101 `HookSnapshotRepo` reads `nodeWrites`, `foldDone` and `afterNodeWrite` inside `.flatMap` after `super` returns. Confirmed.
  - l.92 `nodeWrites` is a shared `protected val AtomicInteger`, reset with `set(0)` at l.134. Confirmed.
  - l.55 `HookBackend` reads `afterEngine` inside `.flatMap`. Confirmed.
  - l.63-68 `HookOutputRepo` and l.111-113 `HookBinaryRepo` read their state at call start. Confirmed.
  - l.126-137 `afterEach` does not reset `binaryTarget`. Confirmed; D3 now adds it to `resetSeams()`.
  - The Context bullets all match the code.
- **Context premise (prior CR1):**
  - `PipelineRunDeletedRecovery.scala:35-38` settles `siblings` before it answers.
  - `PipelineRunSucceededWrites.scala:288-290` passes `updateMeta` in `siblings`, and `updateMeta` is `updateRun.flatMap` (l.243).
  - `publishTerminalAfter` is at l.302.
  - So the revised claim holds: a PASSING test leaves no seam call in flight, and the live path is a failed or timed-out test. D1 now treats this as an expected outcome the probe must confirm or refute, not as a settled fact. CR1 is resolved.
- **Capture-at-start does not change existing tests:** I grepped every seam assignment in `LateFinisherRunSpec.scala` and `LateFinisherDeleteAfterWonSpec.scala`. Every `afterEngine`, `terminalGate`, `afterNodeWrite`, `beforeNodeFold` and `beforeOutputList` assignment happens BEFORE `submit`/`submitWith`. The `terminalWritten` and `foldDone` reads (DAW l.20, 30, 41, 55-56, 75-76, 93) are also captured before submit. No test reassigns a seam variable while a call is in flight, so D2 keeps the existing behavior. AC5 is plausible.
- **Prior CR2 (red-first for each `HookSnapshotRepo` field):** I traced D3's three orderings against l.98-101 on the unfixed code. Each one is red:
  - **Counter:** the late write gives NEW count 1, but the test asserts 0. Red.
  - **`afterNodeWrite`:** the NEW hook is invoked instead of the OLD one. Red.
  - **`foldDone`:** after the reset, the held second write gets n=1, so neither promise completes. The assertion "OLD completed" is red.
  - With the fix, the captured OLD counter at 1 gives n=2 and completes the OLD `foldDone`. Green.
  - The vacuous "NEW not completed"-only shape is explicitly called out and avoided.
  - The hold mechanism is named (`andThen = DBIO.from(release.future)`, the precedent at `LateFinisherRunSpec.scala:149-153`). CR2 is resolved.
- **`terminalWritten` and `afterEngine` tests:**
  - **`terminalWritten`:** the hold via `terminalGate` works because the gate is captured at l.82. On the unfixed code, `.andThen` completes the NEW promise, so the test is red. `Await.ready` is specified for a write against an unknown run id.
  - **`afterEngine`:** `HookBackend` takes a delegate, so a stub backend that returns a test-held promise is constructible. The unfixed code calls the NEW hook, so the test is red.
- **Prior CR3 (mutations):** D4 and task 2.2 now revert each of the five captures on its own and record all five. I checked that each revert makes its own test red:
  - Reverting the `foldDone` capture alone means the fixed OLD counter reaches n=2 and then completes the NEW `foldDone`.
  - Reverting the counter capture alone means the NEW counter reaches 1, which reddens the counter test and leaves OLD `foldDone` incomplete.
  - Every capture can therefore fail independently. CR3 is resolved.
- **Prior non-blocking notes** are all adopted: `Await.ready`, the limit stated in the doc comment, and `binaryTarget` in `resetSeams()`.
- **Placeholders:** none. There is no TODO or TBD, and every task has an acceptance signal.
- **AC coverage:**
  - AC1: tasks 1.2, 1.3 and the premise evidence.
  - AC2: D2 and task 2.1.
  - AC3: D3 and task 1.2.
  - AC4: D4 and task 2.2.
  - AC5: D5 and task 3.1.
  - No production code changes (C2).
  - No sleeps in new code (C1). The existing `Thread.sleep` in `eventsOf`/`awaitSucceeded` is pre-existing and out of scope.
- **Scope widening:** extending the fix to `HookSnapshotRepo` and `HookBackend` is justified by the driver's re-derivation instruction and AC2's "every seam". It is recorded as self-approved in the Planner Notes.
- **Contracts:** this is a test-only change with `skip_specs: true` (`.openspec.yaml`). No API or schema delta is needed.

### Verdict: CONFIRM

### Non-blocking notes

- **D5/3.1 repeat runs (MISTAKES.md, "sbt 2: `sbt test` can be a cached no-op"):** a repeated `testOnly` with no source change can execute zero tests and still exit green. Each of the 5 runs must show the executed test count for all three specs in evidence.md, or the repetition proves nothing. The same applies to the red-first and mutation runs: show the failing test names, not just a non-zero exit code.
- **D3 terminalWritten test:** assert OLD completed and NEW not completed only after `Await.ready` on the seam's own Future. The `andThen` future completes after its callback, so no extra wait is needed. Do not add one.
- **D2:** `nodeWrites` changes from `val` to `@volatile var`. Every read site, including the `HookSnapshotRepo` call-start capture, must take the var once into a local value. Calling `nodeWrites.incrementAndGet()` inside the `.flatMap` would quietly reintroduce the bug. The counter mutation in D4 is what would catch this, so make sure the mutation reverts exactly that.
