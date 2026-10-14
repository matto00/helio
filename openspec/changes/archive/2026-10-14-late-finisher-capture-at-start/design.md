## Context

See proposal.md (Why). Ground truth on base 27a30bb97, `LateFinisherSpecBase.scala`:

- `GatedRunRepo.updateRunTerminal` captures `terminalGate` at call start (`val gate = terminalGate`) but completes
  `terminalWritten` inside `.andThen`, i.e. it dereferences the `@volatile var` when the write returns.
- `HookSnapshotRepo.overwriteRowsWith` reads `nodeWrites` (a shared `AtomicInteger` reset with `set(0)`), `foldDone`
  and `afterNodeWrite` inside `.flatMap`, after the snapshot transaction commits.
- `HookBackend.execute` reads `afterEngine` inside `.flatMap`, after the engine completes.
- `HookOutputRepo` and `HookBinaryRepo` already read their hooks at call start (not affected; confirm in evidence).
- `afterEach` replaces each var with a fresh value; ScalaTest runs a spec's tests sequentially on one instance.
- `PipelineRunSucceededWrites` starts `updateRun` eagerly and concurrently with the node fold, but since HEL-1564
  `PipelineRunDeletedRecovery.recover` (l.35-38) settles the siblings (incl. `updateMeta`, which depends on
  `updateRun`) before answering, and `publishTerminalAfter` waits for the whole chain; a Scala `andThen` future
  completes only after its callback ran. So a PASSING test leaves no seam call in flight. The live path is a test that
  FAILS or TIMES OUT (`submitWith`'s 60 s `Await`, `awaitDb`): its chain keeps running into the next test. The fix is
  failure isolation for that path plus removal of a latent hazard.

## Goals / Non-Goals

Goals: a seam call can only read or complete the state of the test that started it; proven red-first.
Non-goals: see proposal.md. No change to any existing test's assertions.

## Decisions

D1. Probe first (systematic-debugging law). Before any fix, write the regression spec (D3) and run it on the unmodified
base; record the red output. Additionally confirm, with cited code, the expected outcome stated in Context: no
PASSING existing test leaves a seam call in flight; only a failing/timed-out one does. If the code shows otherwise,
record that instead (never restate the Context claim without checking it).

D2. Fix by capture-at-call-start. In each affected seam, bind the per-test state to a local `val` at the top of the
call and use only the local afterwards: `terminalWritten` in `GatedRunRepo`; `foldDone`, `afterNodeWrite` and the
node-write counter in `HookSnapshotRepo`; `afterEngine` in `HookBackend`. `nodeWrites` becomes a per-test value
(a `@volatile var` holding a fresh `AtomicInteger`, replaced in `afterEach`) so it can be captured too; `set(0)` on a
shared counter cannot be isolated. Alternative rejected: awaiting all in-flight seam calls in `afterEach` (needs
tracking every Future, and a hung call would hang the suite instead of being isolated).

D3. Regression spec: new `LateFinisherSeamIsolationSpec extends LateFinisherSpecBase`, one test per affected seam.
Each test drives the seam DIRECTLY (not via `submit`) under forced ordering: hold the call on a promise, simulate the
test boundary by invoking the same reset `afterEach` performs (factor it into `protected def resetSeams()`, called by
`afterEach`, so the test cannot drift from the real reset; `binaryTarget` is reset there too), release the held
promise, await the seam call's own Future (`Await.ready` where the underlying write may fail, e.g. a terminal write
against an unknown run id), then assert the OLD state was completed/driven and the NEW state was not. No sleeps; every
wait is on a Future the test itself completes. Real DB calls are allowed (fixture via `seed()`). Holds:
- `terminalWritten`: hold via `terminalGate`.
- `afterEngine`: hold via a delegate `PipelineExecutionBackend` whose `execute` returns a test-held promise.
- `HookSnapshotRepo`: hold a write in-transaction via `andThen = DBIO.from(release.future)` (existing pattern,
  `LateFinisherRunSpec.scala:149-153`). One test per field, each red on its own on the unfixed code:
  - counter: a held write released after the reset must not advance the NEW test's counter (assert new count = 0).
  - `afterNodeWrite`: the held write must invoke the OLD test's hook, not the NEW one (record which was called).
  - `foldDone`: the OLD test's FIRST write lands (n=1) BEFORE the reset; its SECOND write is held across the reset;
    after release the OLD `foldDone` must be completed and the NEW one not. (With only one late write, n=1 on the
    unfixed code and neither promise completes, so a "new not completed" assertion alone would be vacuous.)
Each test must show red output on the unfixed base for its own field. The spec's doc comment states the limit:
capture-at-start does not cover a call that a still-running chain STARTS after `afterEach` (the fold's next node
write, or `HookOutputRepo` consuming the next test's hooks).

D4. Mutation: after the fix, revert EACH of the five captures on its own (`terminalWritten`, `foldDone`,
`afterNodeWrite`, the node-write counter, `afterEngine`), show its matching test going red, restore. Record all five
in evidence.md.

D5. Existing specs: run `LateFinisherRunSpec`, `LateFinisherDeleteAfterWonSpec` and the new spec together after the fix,
green. Repeat at least 5 times foreground under `nice -n 19` (single forked group; state that this measures stability,
not proof; the proof is D3+D4).

## Risks / Trade-offs

- [Seam tests test test-infrastructure] -> Acceptable and intended: the defect IS in the test infrastructure; the
  spec's doc comment says so and names HEL-1565.
- [Reset factored into a method could diverge from afterEach] -> afterEach calls `resetSeams()` and nothing else for
  those fields, so there is one definition.
- [Probe shows a production defect] -> stop and escalate (proposal Non-goals).

## Planner Notes

- Self-approved: widening scope from the ticket's one-line `terminalWritten` fix to every seam with the same shape,
  because the driver asked for the hazard to be re-derived against the new structure, and HookSnapshotRepo/HookBackend
  carry the identical defect in the same file.
- Self-approved: `skip_specs: true` (test-only).
