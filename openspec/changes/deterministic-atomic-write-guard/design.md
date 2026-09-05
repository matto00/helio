## Context

`LocalFileSystem.write` stages into `Files.createTempFile(target.getParent, ...)` and
then `Files.move(tmp, target, ATOMIC_MOVE, REPLACE_EXISTING)`. Two properties are
load-bearing and both must stay guarded:

- **P1 — rename, not in-place write.** The target must be published by a rename, so a
  concurrent reader sees either the old file or the new one, never a torn prefix.
- **P2 — same-directory staging.** `ATOMIC_MOVE` only holds within one filesystem, so
  staging under `/tmp` would silently degrade to a copy while the code claimed atomicity.

The existing tests try to prove P1/P2 by *catching the intermediate state* — inherently
a race, because the intermediate state is exactly what an atomic operation is designed
to make unobservable. Making the window bigger (a larger buffer) or the poller luckier
(sleeps) only shifts the odds; it does not remove the dependence on the scheduler.

## Goals / Non-Goals

**Goals:**
- Guards whose outcome is a function of the implementation alone, not of timing.
- Guards that still go red if `write` reverts to `Files.write(target, bytes)`, proven by
  actually performing that reversion in-run.
- Guards that cannot pass vacuously.

**Non-Goals:**
- Changing `LocalFileSystem`'s production behaviour.
- Adding a test-only observation seam to production code (see Decision 1).
- Proving cross-filesystem `ATOMIC_MOVE` degradation, which cannot be exercised inside a
  single-filesystem test fixture.

## Decisions

### Decision 1 — Choose permission-based discriminators over the three suggested options

The ticket offered three directions. Weighed against the evidence:

- *Injected observation seam.* Deterministic, but it puts a test-only hook in a
  production write path whose entire value is that it is short and obviously correct,
  and it proves the seam fired rather than that the filesystem operation was a rename.
  Rejected as a cost not worth paying, since a seam-free deterministic option exists.
- *Assert only post-conditions.* Honest, but strictly weaker: the post-conditions of a
  correct temp-and-move and of a bare `Files.write` are identical on the happy path, so
  this fails acceptance criterion 2 — it could not detect the reversion it replaces.
  This would have been the right answer only if no deterministic discriminator existed.
- *Loudly-failing timing probe.* Still a race; it merely relabels the failure. Retained
  only as the vacuity-reporting *principle* (Decision 3), not as a timing probe.

A fourth option was found and is adopted: construct fixtures where the two candidate
implementations differ in **which operation is permitted**, so the discrimination is
made by the kernel's permission check, synchronously, with no window at all.

### Decision 2 — The two discriminators

**D1 (proves P1 — publish-by-rename).** Target is an existing file with mode `0444`
inside a writable directory.
- Bare `Files.write(target, bytes)` → `AccessDeniedException` (opening a read-only file
  for writing is denied).
- Temp-file-plus-rename → **succeeds**: `rename(2)` checks write permission on the
  *directory*, not on the file being replaced.

So `write` succeeding, and the target afterwards holding the new bytes, rules out a bare
in-place `Files.write` — the plausible reversion AC2 guards against — because that bare
write is denied by the 0444 bit while a rename is not. This does not rule out every
conceivable implementation (e.g. `Files.delete` followed by a fresh `Files.write` would
also pass D1, and would be neither atomic nor a rename); D1 is a positive discriminator
against the specific reversion in question, not a proof that publication happened
*only* via a rename. Verified empirically on this machine before the design was fixed: a
direct write raised `PermissionError [Errno 13]`, while renaming over the same read-only
file succeeded and replaced its content.

**D2 (proves publication requires the target directory — NOT same-directory staging).**
Target is an existing, writable file (`0644`) inside a directory made non-writable (`0555`).
- Bare `Files.write(target, bytes)` → succeeds (the file is writable; the directory is
  not consulted).
- Temp-file-plus-rename → **fails** with `AccessDeniedException`, because creating the
  staging file requires write permission on that directory.

D2 therefore proves *"publishing the target requires write permission on the target's own
directory, so this is not a bare in-place `Files.write`"* — a second, independent way for the
reversion to go red. It does **not** prove P2: an implementation that staged in a *different*
directory on the same filesystem and renamed in would fail identically, because `rename(2)`
also requires write permission on the destination directory. An earlier draft of this design
claimed it did; that claim was false and is withdrawn.

Checked assumption (verified on the JVM, uid 1000, ext4): `Files.createDirectories` on the
already-existing `0555` directory does **not** throw, so it does not short-circuit D2 before
`createTempFile` is reached. D2's whole shape depends on this.

### Decision 2b — P2 is not deterministically observable, and is left unguarded

Taking up acceptance criterion 6's explicit invitation to say so plainly rather than engineer
around it: **same-directory staging cannot be proven deterministically inside a
single-filesystem test fixture.** Every candidate discriminator collapses:

- Permission-based fixtures cannot separate "staged here then renamed" from "staged elsewhere
  then renamed here", because both need write permission on the destination directory.
- Cross-filesystem degradation — the actual hazard P2 guards — needs two mounts, which a unit
  test cannot create.
- Catching the staged file in the act is exactly the racy observation this ticket removes.

P2 remains true by construction and is verifiable by reading one line
(`Files.createTempFile(target.getParent, ...)` takes the parent directory as its argument), and
the code comment above `write` explains why it is load-bearing. It is not, and after this change
is not claimed to be, covered by an automated guard. Asserting less honestly is preferred to a
guard that would have to be racy to assert more.

### Decision 3 — Preconditions are asserted, never assumed

Both discriminators depend on POSIX permission enforcement, which does not hold for
`uid 0` or on filesystems that ignore permission bits. Each test therefore first proves
its own precondition against a scratch fixture in the same temp tree — for D1, that a
direct write to a `0444` file really is denied; for D2, that a `0555` directory really
does refuse file creation. If a precondition does not hold, the test fails with a
message naming it ("precondition not met: POSIX permissions are not enforced here
(running as root?) — this guard cannot discriminate"), never a silent pass and never a
misleading "atomicity broken". This is the ticket's "fail loudly rather than silently"
requirement, applied to vacuity instead of to a timing window.

`chmod` state is restored in a `finally` so a failure cannot leave an undeletable temp
tree behind for `BeforeAndAfterAll` cleanup.

### Decision 4 — The second test's failure is diagnosed from the CI log, and the test is kept

The ticket assumed both failures shared the poller's timing race. The CI log for run
`33948170131` attempt 1 refutes that, and refutes the ticket's stated mechanism for the *first*
failure too. Both failed with `java.nio.file.FileSystemException: ... Too many open files`:

- Test 1 failed inside its own poller at `LocalFileSystemSpec.scala:120`, in
  `Files.list(parentDir)` — `Files.list` returns a `Stream` backed by an open `DirectoryStream`
  which this code never closes, and the poller spins it in a tight loop with no sleep. It leaks a
  file descriptor per iteration until the process limit is hit.
- Test 2 failed at `LocalFileSystemSpec.scala:149` — in its own **fixture setup**
  (`Files.write(target.resolve("inner.txt"), ...)`), before reaching any assertion, because the
  descriptors were already exhausted by test 1.
- The damage did not stop there: the whole suite then **ABORTED** with
  `NoClassDefFoundError: com/helio/infrastructure/storage/LocalFileSystem$` — the classloader
  could not open the jar either. This is worse than the two reported failures.

So the real defect is a **file-descriptor leak in the poller**, not a missed observation window,
and the two tests are related by shared-process resource exhaustion, not by a shared fixture.
The scheduling-race hypothesis in the ticket is plausible but was not what happened. This also
explains why it never reproduces on the dev box (fd limit 524288 here) and only bites under CI's
lower limit — the same "every gate runs on the dev box" blind spot the ticket cites.

Consequences for this plan:

- Deleting the poller removes the actual root cause, so the chosen fix is right for the real
  mechanism as well as the assumed one.
- **The existing move-failure test is kept as-is**, not folded into D2. It contains no poller, no
  large buffer and no timing window; it was pure collateral damage. It is also the *only* test
  that exercises `write`'s catch branch (`Files.deleteIfExists(tmp)`), because it is the only
  fixture in which a temp file is actually created before the failure. D2's own "no `.tmp`
  residue" assertion is vacuous by comparison (nothing is ever staged), so D2 stands **alongside**
  this test, never in place of it.

### Decision 5 — Mutation proof is performed, not asserted

Acceptance criterion 2 is discharged by actually editing `LocalFileSystem.write` to a
bare `Files.write(target, bytes)`, running the suite, recording the verbatim failure
output for both D1 and D2, restoring the file (`git diff` must be empty for it
afterwards), and re-running green. All four steps are recorded.

## Risks / Trade-offs

- **Permission semantics are platform-dependent.** Mitigated by Decision 3: on a
  platform where they do not hold, the guard reports that fact instead of a false
  verdict. CI and the dev box are both Linux, non-root.
- **D2 asserts a failure**, a weaker shape than asserting a success — an unrelated failure
  could satisfy it. Mitigated by asserting the exception type *and* that its message names the
  staging directory, *and* that the target still holds its original bytes (byte comparison, not
  `Files.exists`).
- **Same-directory staging (P2) is no longer guarded at all.** Stated plainly per Decision 2b
  rather than hidden. The mitigation is the code comment on `write` and the fact that the
  property is one line of code, not that a test covers it.
- **D2's "no `.tmp` residue" is vacuous in its own fixture.** Accepted, because the retained
  move-failure test asserts the same post-condition non-vacuously.
- **Neither discriminator observes the staged file itself.** Deliberate: its observability is
  precisely what made the old test racy — and, per the CI evidence, what leaked the descriptors
  that took the whole suite down.
