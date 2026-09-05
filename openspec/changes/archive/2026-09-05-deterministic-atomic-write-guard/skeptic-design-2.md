## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Spawned cold. Re-derived from `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`skeptic-design-1.md`, and the actual test source — not from the orchestrator's summary.

### What I verified (with evidence)

**CR1 (D2's false P2 claim) — DISCHARGED.**
`design.md` Decision 2's D2 paragraph now reads *"D2 therefore proves 'publishing the target
requires write permission on the target's own directory, so this is not a bare in-place
`Files.write`'"* and explicitly states *"It does not prove P2: an implementation that staged in a
different directory on the same filesystem and renamed in would fail identically … An earlier
draft of this design claimed it did; that claim was false and is withdrawn."* That is exactly the
weaker property round 1 named. New **Decision 2b** takes option (b): P2 is stated as not
deterministically observable, enumerates why each candidate discriminator collapses
(permission fixtures, two-mount requirement, racy in-the-act observation), and says plainly it is
left unguarded. Consistent with Non-Goals ("Proving cross-filesystem `ATOMIC_MOVE` degradation …
cannot be exercised"). The Risks section carries the matching entry, and task 2.8 requires the
code comment to say the same. No overstated claim survives anywhere in the artifacts (grepped).
Round 1's checked-assumption note (`createDirectories` on an existing `0555` dir does not throw)
was also folded into Decision 2 as requested.

**CR2 (folding test 2 into D2 drops the catch-branch) — DISCHARGED.**
`tasks.md` 2.6 now reads "KEEP the existing … test unchanged in substance … Do not fold it into
D2 and do not weaken it", with the reason (only test that stages a temp file before the failure,
so the only one covering `Files.deleteIfExists(tmp)`). Decision 4 states the same and calls D2's
own no-residue assertion "vacuous by comparison", with D2 standing "alongside this test, never in
place of it". The prior Decision-4-vs-task-2.3 contradiction is gone. AC5 coverage is preserved by
2.6 + 2.7.

**CR3 (positive identification of D2's failure) — DISCHARGED.**
`tasks.md` 2.3 now requires `AccessDeniedException` **and** that the message/path names the staging
directory (with the round-1 rationale spelled out: "not the bare exception class, which a typo'd
fixture path would also produce") **and** that the target still holds its ORIGINAL bytes by byte
comparison, not `Files.exists`. Design's Risks section mirrors all three.

**Decision 4's new root-cause claim — corroborated against source, not taken on trust.**
I checked the line numbers in the CI stack against
`backend/src/test/scala/com/helio/infrastructure/storage/LocalFileSystemSpec.scala` at this
worktree's base (`9f1d37d2`):
- `:114` is `"stages a same-directory temp file during a large write…"`; `:120` is
  `Files.list(parentDir).iterator().asScala…` inside `tempSiblings()`, which the poller
  (`:124–:127`) calls in a `while (!stop.get())` loop with **no sleep**. `Files.list` returns a
  `Stream` backed by an open `DirectoryStream` and this code never closes it — one leaked
  descriptor per iteration. The claimed mechanism is physically real, not reconstructed.
- `:142` is `"cleans up the temp file …"`; `:149` is `Files.write(target.resolve("inner.txt"), …)`,
  which is indeed **fixture setup, before any assertion** — consistent with collateral fd
  exhaustion rather than a shared racy fixture.
Both cited line numbers land on exactly what Decision 4 says they land on, which is strong
independent corroboration of the log excerpt. Local `ulimit -n` = 524288, consistent with the
stated dev-box non-reproduction. Task 1.3 correctly still requires the executor to demonstrate the
leak directly (or "say so plainly" if it cannot) rather than shipping the mechanism as an
assertion — the right shape for a ticket whose subject is unverified mechanism claims.

**Plan soundness re-checked end to end.** ACs trace: AC1→2.1; AC2→3.1–3.4 (perform, not assert);
AC3→2.4; AC4→1.2/2.6; AC5→2.6+2.7; AC6→Decision 1 + Decision 2b; AC7→4.1/4.2 (which correctly adds
a low-`ulimit -n` run, the CI-representative condition, not just CPU contention). Constraints
guarded by 4.3. No placeholders, no TBDs, no deferred decisions. Task 2.1's "remove `Try`/
`AtomicBoolean` imports if now unused" is correctly conditional — `Try` is still used at `:151` by
the retained test, `AtomicBoolean` becomes unused.

### Verdict: CONFIRM

All three round-1 change requests are genuinely discharged (not paraphrased away), and the new
Decision 4 root-cause claim survives independent checking against the source.

### Non-blocking notes

- **`proposal.md` is now stale relative to Decision 4 and should be updated before the PR body is
  written.** Its "Why" still asserts the refuted attribution as fact — *"Under CI's contended CPU
  the poller may simply never be scheduled inside that window — a green/red outcome decided by the
  scheduler"* — when the CI log says the failures were `Too many open files` from the poller's
  leaked `DirectoryStream`s, with a suite-wide `NoClassDefFoundError` abort. The poller is still
  inherently racy, so the *hazard* claim stands; the *cause of these failures* claim does not.
  Not blocking (design.md and tasks.md are what the executor implements, and both are correct),
  but in a ticket whose entire subject is confidently-stated-but-unverified mechanism, leaving the
  superseded story in the shipped proposal is the wrong artifact to be sloppy in. The same
  paragraph's "Independently diagnose the second failing test … and fix it on its own terms" also
  reads oddly now that the answer is "it needed no fix" — worth one sentence of correction.
- Decision 4 notes the suite ABORT is "worse than the two reported failures". Worth one line in
  the PR body: if the fd leak is the cause, this fix also removes an intermittent whole-suite
  abort, not just two flaky tests.
- Task 4.2's low-`ulimit -n` run is the load-bearing one for the real mechanism. Recommend
  recording the chosen limit explicitly, and ideally confirming the *old* poller fails under it
  (the red that grounds the new green).
