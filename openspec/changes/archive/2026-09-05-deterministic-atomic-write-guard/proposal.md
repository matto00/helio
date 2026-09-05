## Why

`LocalFileSystemSpec`'s two atomic-write guards fail intermittently in CI. The first starts a
busy-spinning poller thread and races it against a 64 MiB write, asserting the poller happened to
catch a `.tmp` sibling.

The CI log for run `33948170131` attempt 1 shows what actually went wrong, and it is not the
scheduling race the ticket hypothesised: both tests failed with
`java.nio.file.FileSystemException: ... Too many open files`, and the suite then ABORTED with
`NoClassDefFoundError`. The poller calls `Files.list(parentDir).iterator()` in a tight loop with
no sleep; `Files.list` returns a `Stream` backed by an open `DirectoryStream` that this code never
closes, leaking descriptors until the process limit is hit. Measured: 20,000 unclosed calls leak
40,002 descriptors, never reclaimed; the same loop with the stream closed leaks none. The second
test was collateral damage — it died in its own fixture setup, before any assertion, and has no
timing window of its own.

So the poller is both inherently racy *and* the concrete cause of these failures, by a mechanism
nobody had identified. Deleting it removes both, and removes an intermittent whole-suite abort.

These guards protect HEL-881's atomicity fix (`write` stages into a same-directory temp file, then
`Files.move(..., ATOMIC_MOVE)`), which exists because a torn `Files.write` corrupts image uploads,
data-source writes, and the assistant's write-then-record transcript ordering. A flaky guard on an
atomicity fix is worse than no guard: it trains reviewers to re-run reds, so the one genuine red
gets re-run too.

The assertions are right. The observation method is wrong.

## What Changes

- Replace the timing race with **permission-based discriminators**: deterministic
  fixtures in which a temp-file-plus-rename implementation and a bare `Files.write`
  have *opposite, immediate* outcomes, with no mid-state to catch and no window to miss.
- Each discriminator first asserts its own precondition is live, so it can never pass
  vacuously; if the precondition does not hold (e.g. running as root, or a filesystem
  that ignores POSIX permissions) the test fails loudly naming the unmet precondition
  rather than silently reporting atomicity as satisfied.
- Delete the 64 MiB buffer, the poller thread and the `AtomicBoolean`.
- The second failing test is diagnosed rather than assumed: it needed no fix and is KEPT
  unchanged. It is also the only test covering `write`'s `deleteIfExists` cleanup branch.
- Keep the existing by-construction post-condition assertions (no `.tmp` residue after
  success; a failed move leaves no `.tmp` and does not disturb the existing target).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — this changes test observation method only. `LocalFileSystem`'s production
behaviour and its spec-level requirements are unchanged, so this change sets
`skip_specs: true`.

## Impact

- `backend/src/test/scala/com/helio/infrastructure/storage/LocalFileSystemSpec.scala` (only).
- No production code change; no migration; no API change; no frontend change.
