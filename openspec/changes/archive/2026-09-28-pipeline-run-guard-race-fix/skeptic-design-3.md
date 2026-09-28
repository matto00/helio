## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md` in full (current state, not a diff),
  plus both prior skeptic reports (`skeptic-design-1.md`, `skeptic-design-2.md`) to know exactly
  what round 2 required.

- **Round 2's required revision — extending the mutation-kill requirement to the cited
  pre-existing test under the H1 "verify + cite" branch — verified as correctly and completely
  addressed, against the actual current file contents, not the executor's summary:**
  - `design.md` Decision 4 (lines 110-122), current text, quoted directly: "The guard-atomicity
    test being relied upon as proof — whether that is a newly-added interleaving test (H2, or H1
    if Decision 3's gap-check found one needed) OR the pre-existing
    `PipelineRunRepositorySpec.scala:639-660` test cited under Decision 3's H1 'verify + cite'
    path — must be demonstrated failable by mutation ... not only shown to currently pass ...
    This applies EVEN when task 2.2 concludes the cited pre-existing test is sufficient and no
    new test is written." This is exactly round 2's Change Request 1, first bullet, implemented
    close to verbatim (heading itself now reads "Mutation requirement (applies whether or not a
    NEW test is added)").
  - `tasks.md` task 2.4 (lines 40-47), current text: "Demonstrate that WHICHEVER test is being
    relied upon as the guard-atomicity proof — a newly-added interleaving test (2.3, or 2.2 if a
    gap was found), OR the pre-existing `PipelineRunRepositorySpec.scala:639-660` test cited
    under 2.2's 'verify + cite' path — is failable by mutation ... Required even when 2.2
    concludes no new test is written." This matches round 2's Change Request 1, second bullet
    (the "broaden task 2.4's wording" option), and is internally consistent with Decision 4's
    wording (H2→2.3, H1-gap→2.2, pre-existing→2.2's verify+cite path map 1:1 between the two
    documents).
  - Both edits keep the concrete mutation examples ("widen `maxConcurrent` by one, or drop the
    lock acquisition") and the "revert before commit" requirement, unchanged from before — the
    revision only widened scope, it did not weaken or remove the existing mutation-mechanics
    guidance.
  - `design.md`'s Planner Notes (lines 151-155) now records this as a dated round-2 revision,
    correctly describing what was wrong (silently dropped for the H1 path) and what was fixed —
    consistent with the round-1 Planner Notes entry already there for the prior revision. No
    revision history was overwritten or lost.

- **Checked for a new gap introduced by this specific revision** (the task's explicit ask): grepped
  `design.md`/`tasks.md`/`proposal.md` for every remaining "new test" / "added" / "verify + cite"
  / "mutation" occurrence and read each in context:
  - `proposal.md:44-45` ("a new test is added there only if the probe surfaces a gap") describes
    scope of the Impact section, not the mutation-kill requirement — no conflict, and it was not
    touched by round 2's fix (correctly out of scope for that revision).
  - `tasks.md` task 3.3 ("instrumentation added in 1.1 is removed") refers to the temporary probe
    logging from Decision 1, unrelated to the guard-atomicity test — no conflict.
  - No other task or decision references "the new test" in a way that would exclude the
    pre-existing cited test from a requirement Decision 4/task 2.4 already covers. I found no
    third location that silently assumed a test was freshly added.
  - The "Both confirmed" branch (Decision 3: "fix both, independently provable") is not explicitly
    enumerated in Decision 4/task 2.4's list of three cases, but "whichever test(s) are being
    relied upon" is phrased broadly enough (not "exactly one test") to cover it without a
    literal-reading gap of the kind round 2 caught — this is a genuine case, not the same defect
    class, and not blocking.

- **Re-verified the underlying ground-truth citations myself** (not re-trusting round 2's or the
  executor's prior verification), since a design that cites code must still cite it accurately in
  its current (round 3) state:
  - `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepositorySpec.scala:639-660` —
    read directly via `sed -n '620,665p'`. Confirmed: the HEL-505 comment block, the "concurrent
    submissions for the same owner never exceed the concurrency cap" test name, 12 concurrent
    `Future.sequence` calls to `insertRunIfUnderConcurrencyCap` with `maxConcurrent = 3`, and the
    exact assertions (`Inserted` count == `maxConcurrent`, `CapExceeded` count == `attempts -
    maxConcurrent`) all match design.md's description precisely.
  - `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepository.scala:96-159` —
    read directly. Confirmed the lock → owner-check → live-count → conditional-insert composition
    is one `DBIO` chain passed to a single `ctx.withUserContext` call, matching design.md's
    Context section and Decision-4 mutation targets (`pg_advisory_xact_lock` acquisition via
    `concurrencyLockAction`, the `count < maxConcurrent` comparison) — both named mutation
    mechanisms (drop the lock; widen the effective cap) map onto real, currently-existing code at
    the cited locations, so the mutation instructions are executable, not hand-wavy.

- Confirmed no new placeholders/TBDs, no new internal contradiction between
  proposal/design/tasks, no scope drift, and `skip_specs: true` remains justified — none of this
  changed since round 2 and I re-confirmed it directly rather than assuming round 2's clearance
  still holds.

### Verdict: CONFIRM

Round 2's single required revision was implemented correctly and completely, in both documents,
with consistent cross-references, and without weakening any previously-adequate requirement. I
found no new gap introduced by this specific edit, and no other place in the plan that still
silently assumes a guard-atomicity test was newly added. The plan traces every requirement in
`ticket.md`'s "Required" section (probe-before-fix, branch-appropriate fix, red-first/mutation-kill
proof, no loosened assertions/retries) to a concrete task, and its factual citations about the
existing test and the guard's code structure check out against the files as they stand today.

### Non-blocking notes

- The "Both confirmed" branch of Decision 3 is not literally enumerated in Decision 4/task 2.4's
  three named cases (H2-new-test, H1-gap-new-test, H1-pre-existing-cited-test). The prose is broad
  enough ("whichever test is being relied upon") to plausibly cover a scenario where both a new
  H2 test and the H1-cited test are simultaneously relied upon, but an explicit fourth bullet
  naming this combination would remove any doubt for the executor. Not blocking — round 2's
  literal-reading trap (test worded exclusively around "added") does not recur here, since the
  wording is disjunctive/inclusive ("OR"), not exclusive.
