## Context

See proposal.md - Why. Live tree at 575a58b1f. `AcceptRecordingListener` (testsupport) is used by
SqlConnectorRebindingSpec (x2), SqlConnectorConfigShapeSpec and SqlEgressSocketFactoriesSpec; each caller does
`val (accepted, sentinelPort) = listener.assertNothingAcceptedBeforeSentinel(); accepted shouldBe List(sentinelPort)`.
The helper opens a sentinel socket, runs a bounded wait (5 s) until the sentinel's port is accepted, discards the wait's
Boolean, and returns `(acceptedPorts, sentinelPort)`. The scaladoc above it says "true iff ...", which is also wrong.

## Goals / Non-Goals

**Goals:** names and docs that match behaviour; a complete inventory. **Non-Goals:** any behaviour change.

## Decisions

### D1. Rename the helper; do not make it assert

Rename to `acceptedThroughSentinel()` (same signature, same body). Fix both scaladoc references ("Negative observation"
bullet and the method doc) to say it returns the accepted ports up to and including the sentinel, and that the caller
asserts the list is exactly `[sentinelPort]`.

Alternative: move the assertion inside (throw on mismatch). Rejected: every caller already makes the exact assertion,
ScalaTest's `shouldBe` gives a better failure message at the call site than a thrown helper error, and it would change
what the callers' tests visibly assert. The discarded Boolean is not a hole: if the sentinel is never accepted within
the bound, the returned list lacks `sentinelPort` and the caller's `shouldBe List(sentinelPort)` fails.

Proof the caller assertion is what catches a stray (so the helper genuinely need not assert): a temporary mutation in
one caller (open an extra loopback connection to `listener.port` before the barrier) must turn that test red; revert,
then green. Transcripts saved as evidence. This is a guard-is-failable check, labelled as such, not a fix.

### D2. Rename the real-clock test

New description: `"fire a debounced auto-run through the real system clock, creating exactly one run"` (fits the
enclosing `should` block's grammar; check the enclosing block reads correctly). Body unchanged; the `HELIO_MEASURE`
comment stays. Historical evidence logs under the archived change keep the old name; they are records, not edited.

### D3. Inventory rows

Append to the archived HEL-1341 design.md inventory:
- `services/pipelines/PipelineShapeServiceSpec:29, :35, :45` - `whenReady` on ScalaTest default patience (150 ms) -
  `PipelineShapeService.expand` returns `Future.successful`, so the future is complete before `whenReady` polls -
  effect `-` - Leave.
- `spark/SparkJobSubmitterSpec:345` - `eventually` 30 s timeout / 50 ms interval in `awaitRunPersisted` - un-awaited
  terminal writes for the background Spark job - `F only past 30 s` - Leave (state wait, rows 12-15 class).
Correct the line-38 sentence: the only `eventually` on the 150 ms default is row 8a; the only `whenReady` on it is the
new PipelineShapeServiceSpec row, which never waits. Mark the additions as HEL-1357 so the archive's history stays
honest. The executor verifies both line numbers and the `whenReady` count (grep) on the live tree before writing.

## Risks / Trade-offs

- [Editing an archived change] -> additions are clearly labelled HEL-1357; OpenSpec hygiene check must still pass.
- [Renaming a test changes its reported identity] -> no CI filter or doc references the old name (grepped).

## Planner Notes

Self-approved: rename over assert (D1); test-name wording (D2).

### Design-gate notes adopted (skeptic-design-1, CONFIRM)

- Line-38 rewrite names its trees: at 469f4ea93 the only default-patience `eventually` was row 8a; at 575a58b1f
  (HEL-1357) no `eventually` remains on the default and the only default-patience `whenReady`/ScalaFutures use is
  PipelineShapeServiceSpec, which never waits.
- The SparkJobSubmitterSpec row also mentions its 30 s bounded `Await.result` calls (:165, :337), same class.
- Task 3.2 runs post-rename in SqlEgressSocketFactoriesSpec (no Postgres); the stray socket is connected before the
  helper call; red and green transcripts saved under the change dir.
