## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md` in the change dir, and ground truth
  `backend/src/main/scala/com/helio/infrastructure/storage/LocalFileSystem.scala` +
  `backend/src/test/scala/com/helio/infrastructure/storage/LocalFileSystemSpec.scala`.
- Confirmed the production shape the design describes: `write` does
  `createDirectories(target.getParent)` → `Files.createTempFile(target.getParent, ...)` →
  `Files.write(tmp, bytes)` → `Files.move(tmp, target, ATOMIC_MOVE, REPLACE_EXISTING)` with
  `Files.deleteIfExists(tmp)` in a `NonFatal` catch.
- Confirmed the racy fixture is real and exactly as described: spec lines 114–140 allocate
  `new Array[Byte](64*1024*1024)`, spin a poller `Thread` and assert `observedTempFile.get() shouldBe true`.
- **Ran the Decision 2 discriminators for real, on the JVM** (`jshell`, uid 1000, ext4 /tmp):
  - D1: `Files.write` to a `0444` file → `java.nio.file.AccessDeniedException: .../ro.bin`;
    `Files.move(tmp, target, ATOMIC_MOVE, REPLACE_EXISTING)` over the same `0444` file → **OK**,
    content replaced. **D1 discriminates as claimed.**
  - D2: in a `0555` dir — `Files.createDirectories(dir)` on the already-existing dir → OK (does not
    throw, so it does not pre-empt the discriminator); `Files.write` to the `0644` target → **OK**;
    `Files.createTempFile(dir, ...)` → `java.nio.file.AccessDeniedException`.
    **D2 discriminates bare-write vs. staged-write as claimed.**
  - Cross-checked the same four outcomes in Python first; results agreed.
- Checked vacuity guards (Decision 3): the two named preconditions (0444 write denied; 0555 dir
  refuses creation) are the correct checks and do cover the root / permission-ignoring-FS cases.

So the core of the plan is sound and the load-bearing empirical claim in Decision 2 holds. Two
specific defects remain, both in what the design *claims* D2 proves and in coverage it silently drops.

### Verdict: REFUTE

### Change Requests

1. **`design.md` Decision 2, D2 — the P2 claim is false as written; correct it or drop it.**
   D2 says: *"So `write` failing here is positive evidence that staging happens in the target's own
   directory."* It is not. A hypothetical implementation that staged the temp file in a *different*
   directory on the same filesystem and then renamed into the `0555` target dir would fail with the
   same `AccessDeniedException` — `rename(2)` needs write permission on the **destination** directory
   too. What D2 actually proves is the weaker (and still useful) property *"publishing the target
   requires write permission on the target's directory, so the write is not a bare in-place
   `Files.write`"*. Rewrite D2's justification to that, and either (a) name a genuine discriminator for
   P2 (same-directory staging), or (b) state plainly — as AC6 explicitly invites — that P2 is not
   deterministically observable in a single-filesystem fixture and is therefore no longer guarded.
   Do not leave the overstated claim in the design; it is exactly the "confidently-false
   documentation" shape this ticket exists to stop. Note the Non-Goals section already concedes
   cross-filesystem degradation is unprovable — this correction must be consistent with that.

2. **Decision 4 / task 2.3 — folding test 2 into D2 drops the failed-*move* cleanup path entirely.**
   `cleans up the temp file ... when the atomic move fails` (spec lines 142–157) makes the target an
   existing non-empty directory so the temp file **is created** and then `Files.move` fails, which is
   the only test that exercises `LocalFileSystem.write`'s catch branch (`Files.deleteIfExists(tmp)`).
   In D2's fixture `createTempFile` fails first, so no temp file ever exists: D2's "no `.tmp` residue"
   assertion is **vacuously true** and a mutation deleting `Files.deleteIfExists(tmp)` would go
   undetected. That is a coverage regression, and it also fails AC5, which requires that *"a failed
   move leaves no `.tmp` and does not disturb an existing target"* still be asserted. Compounding it,
   the artifacts contradict each other: Decision 4 and AC4 say the second test is diagnosed and
   "fix it on its own terms", while task 2.3 replaces it with D2 and no task preserves it.
   Required: **keep the existing move-failure test** (it contains no poller, no large buffer and no
   timing window — its only timing element is the shared 5 s `Await`, so it is already deterministic),
   and add a task saying so explicitly. D2 stands alongside it, not in place of it.

3. **`tasks.md` 2.3 — add a positive-identification assertion to D2's failure.**
   design.md's Risks section already concedes "a different, unrelated failure could satisfy it" and
   proposes asserting the exception type. `AccessDeniedException` alone is thin (a typo'd path in the
   fixture yields the same class). Strengthen task 2.3 to also assert that the exception's message/path
   names the staging directory, and — since AC5's "does not disturb an existing target" is the point —
   that the target still holds its original bytes (byte comparison, not merely `Files.exists`).

### Non-blocking notes

- Task 1.1 pins CI run `33948170131`; if that log has aged out of retention, record that fact rather
  than reconstructing a plausible failure message — tasks 1.2 already licenses "say so plainly".
- The spec mixes in `BeforeAndAfterAll` but overrides no `afterAll`, so the shared `tempDir` is never
  deleted. Task 2.5's `finally` chmod-restore is still correct and worth keeping, but the stated
  motivation ("so cleanup cannot be blocked") is inaccurate — there is no cleanup to block today.
- `Files.createDirectories` on the already-existing `0555` dir was verified not to throw, so it does
  not short-circuit D2 before `createTempFile`. Worth recording in the design as a checked assumption,
  since D2's whole shape depends on it.
