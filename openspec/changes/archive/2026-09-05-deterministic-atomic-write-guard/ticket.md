# HEL-984: LocalFileSystemSpec's atomic-write probe is a race: polls for a .tmp sibling during a 64 MiB write

## Description

Two tests in `backend/src/test/scala/com/helio/infrastructure/storage/LocalFileSystemSpec.scala` fail intermittently in CI:

* `stages a same-directory temp file during a large write, and leaves none behind afterward`
* `cleans up the temp file and leaves the original untouched when the atomic move fails`

Confirmed flaky, not broken: the same commit failed both, then passed 3804/3804 on a re-run with no code change (PR #550, run `33948170131`). `main` was green at the identical base. The PR that hit it changed only `eslint.config.cjs`, `.prettierignore` and `concertino.config.json` — it cannot affect Scala.

### Mechanism

The first test allocates a 64 MiB buffer and starts a background poller thread that repeatedly lists the parent directory looking for a `.tmp` sibling, setting an `AtomicBoolean` if it ever sees one. That is a wall-clock race with two ways to lose: the write completes faster than expected, or — more likely under CI's contended CPU — the poller thread is simply never scheduled during the window. Neither is a defect in the code under test.

### Why this matters

It guards HEL-881's atomicity fix (`LocalFileSystem.write` stages into a same-directory temp file then `Files.move(..., ATOMIC_MOVE)`), which exists because a torn `Files.write` could corrupt image uploads, data-source writes, and the assistant's write-then-record transcript ordering. A flaky guard on an atomicity fix is worse than no guard: it trains everyone to re-run reds, and the one time it goes red for a real reason it gets re-run too.

The assertion's *intent* is right and was mutation-proven when written. The *observation method* is what is broken.

## Acceptance Criteria

1. The wall-clock race is removed from `LocalFileSystemSpec`: no test's correctness depends on a background poller thread being scheduled during a write, on a buffer being "large enough", or on any sleep/timing window. Shrinking the buffer or adding sleeps is explicitly rejected — that moves the race rather than removing it.
2. The replacement guard still **positively fails** if `LocalFileSystem.write` reverts to a bare `Files.write(target, bytes)`. This is mutation-proven in-run: the reversion is actually applied, the new test observed going red for the predicted reason (recorded verbatim), the reversion restored, and green re-confirmed. Evidence of all four steps is recorded in the evaluation/PR body.
3. Any guard that could pass vacuously (because a precondition it depends on is not live in the running environment) fails loudly with a message naming the unmet precondition, rather than silently reporting the atomicity property as satisfied.
4. The second failing test (`cleans up the temp file and leaves the original untouched when the atomic move fails`) is independently investigated: determine whether it shares the first test's racy fixture or fails for its own reason, state the finding with evidence, and fix it on its own terms. The ticket's assumption that the two are related is untested and must not be assumed.
5. The post-conditions that already hold by construction are still asserted (no `.tmp` residue after a successful write; a failed move leaves no `.tmp` and does not disturb an existing target).
6. The chosen direction among the ticket's three suggestions (injected observation seam / assert-only-post-conditions / loudly-failing timing probe) is stated with its reasoning in the PR body. If the honest conclusion is that mid-write staging cannot be observed deterministically and the right answer is to assert less, that is stated plainly rather than engineered around.
7. `cd backend && sbt test` passes; the storage suite is run repeatedly (>= 20 iterations) under CPU contention to demonstrate the flake is gone, with the measurement recorded.

## Constraints

- No Flyway migration (parallel runs share one dev Postgres).
- No browser/Playwright use.
- Do not touch `NodeDependencyClosure`/preview-engine or the frontend river editor.
