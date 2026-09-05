## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit under review: `fc71cc2b` (base `9f1d37d2`). Spawned cold; every finding below is
from a command I ran myself in the worktree. Per instruction I did not start dev servers
and did not drive a browser (HEL-968 owns the shared Playwright session); the diff
contains no UI-affecting file, so Phase 3 is genuinely N/A rather than deferred.

### What I verified (with evidence)

**Scope of the change (question 5).** `git diff --name-only origin/main...HEAD` is exactly
one Scala file — `backend/src/test/scala/com/helio/infrastructure/storage/LocalFileSystemSpec.scala`
— plus this change's own OpenSpec markdown. `git diff --name-only origin/main...HEAD --
openspec/specs schemas backend/src/main frontend` returns **0 files**. No migration, no
API change, no frontend change, no spec delta (`skip_specs: true`, correct for a
test-observation-method change that alters no production behaviour). Nothing in the diff
is unwarranted by the ticket.

**Mutation proof, re-performed by my own hand (question 1).** I did not rely on the
executor's or evaluator's recorded output. I edited `LocalFileSystem.write`'s body down to
`Files.createDirectories(target.getParent); Files.write(target, bytes)` and ran the suite:

```
- should publishes via rename: a write to a read-only target file succeeds *** FAILED ***
  java.nio.file.AccessDeniedException: /tmp/helio-fs-test16698980843005780320/d1-readonly-target/target.bin
    at java.base/java.nio.file.Files.write(Files.java:3505)
    at com.helio.infrastructure.storage.LocalFileSystem.$anonfun$write$2(LocalFileSystem.scala:31)

- should requires write permission on the target directory: staging fails even though the
  target file itself is writable *** FAILED ***
  false was not equal to true (LocalFileSystemSpec.scala:221)

Tests: succeeded 15, failed 2
```

Both discriminators go red, and each red is the *predicted mechanism*, not a coincidental
failure: D1's stack frame lands on the mutated line 31 with the `0444` bit denying the open;
D2's red is `result.isFailure shouldBe true` failing, i.e. the write succeeding where a
staged write must fail. I then restored the file and confirmed:

- `git diff origin/main -- backend/src/main/scala/com/helio/infrastructure/storage/LocalFileSystem.scala` → **empty** (byte-identical to `origin/main`).
- `git status --porcelain` → only the untracked `evaluation-2.md`; no modified tracked file.
- `testOnly LocalFileSystemSpec` → **17/17 green**.

**Vacuity guards actually fire (question 2, AC3).** I neutered both preconditions'
`setWritable(false)` calls (simulating a platform that does not enforce POSIX permissions)
and re-ran. Both tests failed loudly, *before* reaching any atomicity assertion, naming the
unmet precondition:

```
precondDenied was false precondition not met: POSIX permissions are not enforced here
(running as root?) — this guard cannot discriminate (LocalFileSystemSpec.scala:163)
... (LocalFileSystemSpec.scala:200)
```

Neither degrades to a silent pass, and neither misreports the environment problem as
"atomicity broken". Spec file restored afterwards; tree clean.

**Are any assertions vacuous or tautological (question 2)?** Checked each one:
- D1's success assertion is a genuine discriminator (proven red above), and it compares the
  *resulting bytes*, so a no-op `write` would not satisfy it.
- D2 does not settle for "something threw": it asserts the exception type, that the message
  names the staging directory (guarding against a typo'd fixture path throwing the same
  class), **and** that the target still holds its original bytes by byte comparison. Under
  the reversion it goes red, so it is not satisfiable for an unrelated reason.
- The `leaves no .tmp residue` test and the retained move-failure test both **pass under the
  mutation** — I observed this directly in the run above. They are post-condition guards,
  not discriminators, and the design says so explicitly (Decision 4 calls D2's own residue
  assertion "vacuous by comparison"). They are not *claimed* to detect the reversion, so
  this is honest labelling, not a vacuous assertion presented as a guard.
- The precondition self-checks fail in the safe direction: they fire only when a denial is
  *not* observed, so they cannot themselves pass vacuously.

**Root-cause claim independently reproduced (question 4).** I did not take
`fd-leak-evidence.md` on trust. Standalone JVM probe of the deleted poller's exact idiom
(`Files.list(d).iterator()`, unclosed):

```
ulimit -n = 524288
baseline fds=8
after 20000 UNCLOSED Files.list: fds=40008
```

~2 descriptors leaked per call, never reclaimed — matching the recorded evidence
(40,010 vs my 40,008; run-to-run noise in baseline handles, not a discrepancy). This
mechanically confirms that the poller, spun in a tight loop with no sleep for the duration
of a 64 MiB write, exhausts descriptors, which is exactly what the CI log shows (`Too many
open files` at `Files.list` in `tempSiblings$1`, line 120), why test 2 died in its own
`Files.write` fixture setup at line 149 before any assertion, and why the suite then
ABORTED with `NoClassDefFoundError`. The local `ulimit -n` of 524288 explains the dev-box
blind spot. **The fd-exhaustion finding is true, and it correctly supersedes the ticket's
own hypothesised scheduling race** — which the artifacts state plainly rather than quietly
retrofitting. Deleting the poller removes the real mechanism as well as the assumed one, so
the fix is right for the actual defect. AC4 (investigate test 2 independently, do not assume
they are related) is genuinely discharged, and its conclusion — collateral damage, no fix
needed, keep the test — is supported by the log rather than asserted.

**Timing independence (AC1) and flake-freedom (AC7).** Read the full new test bodies: no
thread, no sleep, no buffer-size dependence, no `AtomicBoolean`; the only clock is the
pre-existing suite-wide `Await.result(f, 5.seconds)` hang detector, and the change *reduces*
exposure to it by deleting the 64 MiB write. I ran `testOnly LocalFileSystemSpec` **10
times under 4-way CPU contention** (`yes > /dev/null` x4): 10/10 runs 17/17, 0 failures.

**Decision 2b's concession (question 3).** I judged this on its merits rather than accepting
the framing. The concession is real and not cost-free: the deleted poller test *did* assert
P2 (it looked for a `.tmp` sibling specifically in the target's own parent directory), so
same-directory staging loses its only automated coverage here. But the design's argument
holds up under attack — I could not construct a counterexample either. `rename(2)` requires
write permission on the destination directory whether staging happened in that directory or
in a sibling on the same filesystem, so no permission fixture separates the two;
cross-filesystem degradation (the actual hazard P2 guards) needs two mounts, which a unit
test cannot create; and the only remaining observation is catching the staged file in the
act, which is precisely the racy method AC1 forbids. Critically, AC6 *explicitly invites*
this answer ("If the honest conclusion is that mid-write staging cannot be observed
deterministically and the right answer is to assert less, that is stated plainly rather than
engineered around"). It is stated plainly, in design.md Decision 2b, in the Risks section,
and in the code comment above the tests. **Asserting less is the right call here**, and
nothing has been given up cheaply: an earlier draft's false claim that D2 proved P2 was
found and explicitly *withdrawn* in the shipped design, which is the opposite of the failure
mode I was looking for. The residual property is one readable line
(`Files.createTempFile(target.getParent, ...)`), and net coverage still *increases* — the
guard that remains is deterministic and mutation-proven, where the one removed was a race
that could pass by luck.

**Not just re-running the evaluator.** The claims in `evaluation-1.md`/`evaluation-2.md`
that I re-derived from scratch (mutation reds, vacuity reds, prod-file cleanliness, fd
leak, contention repeats) all reproduced. I found no claim in either report that ground
truth contradicts.

### Verdict: CONFIRM

The guard is a real guard, not one that merely looks like one. It is mutation-proven by two
independent mechanisms, both of which I drove red myself and restored; it cannot pass
vacuously, which I also proved by driving the precondition failures; and the one property it
no longer covers is named openly with a correct argument for why no honest deterministic
guard for it exists. The root-cause work is better than the ticket's own hypothesis and is
mechanically verified rather than asserted. Scope is exactly the ticket. This ships.

### Non-blocking notes

1. `LocalFileSystemSpec.scala:180-183` (and design.md Decision 2's matching wording) says a
   write succeeding against a `0444` target "is only possible via a rename". Strictly, a
   `Files.delete(target)` followed by `Files.write(target, bytes)` would also succeed — that
   is non-atomic and not a rename. D1 precisely proves "not a bare in-place `Files.write`",
   which is what AC2 asks for and what the plausible reversion is, so this changes nothing
   about the verdict. But in a change whose whole virtue is exactness about what is and is
   not proven (and which already withdrew one overstatement in D2), tightening this one
   sentence would be in keeping.
2. Carried forward from the evaluator and still worth doing eventually: a `withClue` on D2's
   `result.isFailure shouldBe true` would turn its bare `false was not equal to true` red —
   which I saw verbatim above — into a self-explaining CI failure.
3. `evaluation-2.md` is present but untracked (`git status --porcelain` shows `??`), whereas
   `evaluation-1.md` was committed as an artifact. Housekeeping for the delivery step, not a
   defect in the diff.
4. Outside this ticket, as the evaluator noted: `setup-worktree.sh` does not link
   `helio-mcp/node_modules`, which is what made a pre-commit gate unrunnable in this worktree
   and produced cycle 1's bypass. A spinoff would remove that trap for every future run.
