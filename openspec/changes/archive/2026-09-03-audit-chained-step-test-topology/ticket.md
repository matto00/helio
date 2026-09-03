# HEL-949: PipelineRunRoutesSpec's stepRepo.insert() helper never sets parentStepId — chained-step tests silently test parallel roots

## Description

`PipelineStepRepository.insert(...)`, used throughout
`backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala`,
**never sets** `parentStepId` — it has no such parameter and is structurally
incapable of chaining. Every call creates an independent root-level branch.

So two `insert()` calls do not produce a chained two-step trunk. They produce
**two parallel single-step pipelines** that happen to read the same source.
Any test in this file written on the assumption that `insert()` chains steps is
exercising a different pipeline topology than its author intended — and will
still pass, because a parallel-root pipeline runs fine.

This was found during HEL-922 (PR #531), which had to switch to
`stepRepo.insertInternal(..., parentStepId = Some(prevStep.id))` to build an
actual trunk, and left an in-file comment (line ~487) warning about the rest.

This is a blind-gate *generator*, not a single blind gate: it is a shared
helper that manufactures the same wrong assumption in every test that uses it.
Tests meant to cover multi-step behaviour — execution order, step chaining,
per-step counts, failure propagation partway down a trunk — may be silently
testing the parallel-root case instead.

**Premise-validation refinement (see
`.concertino/runs/HEL-949/evidence/premise-validation.md`):** `insert` is a
*production* method on `PipelineStepRepository`, not a helper defined in the
spec — but it has **zero production call sites** (test-only in practice; its
own comment says so). Its only consumers are `PipelineRunRoutesSpec` and
`PipelineStepRepositorySpec`. So renaming it or requiring an explicit parent
does not ripple into production callers.

## Acceptance Criteria

1. **Audit every `stepRepo.insert(...)` call site** in `PipelineRunRoutesSpec`
   (13 known: lines 424, 455, 468, 469, 544, 545, 559, 600, 623, 716, 876, 952)
   and in `PipelineStepRepositorySpec`. For each, determine from the test's own
   name, comments and assertions whether its ORIGINAL intent was a **chained
   trunk** or **parallel roots**. Record the per-call-site determination and its
   justification.
2. **For each call site**, either switch it to
   `insertInternal(..., parentStepId = Some(...))` to build the intended trunk,
   or explicitly confirm-and-document that the parallel-root topology was
   intentional. Do not assume every site meant chained.
3. **Make the trap hard to re-enter.** Either give the method a required/explicit
   parent argument, or rename it to state what it does (e.g. `insertRootStep`),
   so the next author cannot read `insert` as "add the next step". The in-file
   HEL-922 warning comment should become unnecessary or be updated to match the
   new API.
4. **Report whether any audited test was actually asserting something that only
   holds for one topology** — a test whose assertion changes value between the
   two shapes is a real coverage hole, not just a naming problem. Report this
   explicitly, including the "none found" case.
5. Full backend suite green; no unrelated behavior changes.

## Evidence bar

For **any** test whose topology changes, mutation-check it: show the assertion
goes RED under a deliberate break once it is testing the intended shape, and
record the mutation applied plus the observed failure output. A test that passes
under both topologies was not testing what it claimed either way — say so.

Any test that turns RED merely from fixing the topology must be **diagnosed
individually**. Blanket-updating expected values to whatever the code now
produces converts a real signal into a rubber stamp and is forbidden. State,
per red test, whether the new value is correct-and-why, or whether the red
indicates a genuine product defect (in which case: spinoff ticket, do not
silently absorb it).

## Carried-forward review lessons (HEL-879 / HEL-886)

1. A fixture or test-datum changed to accommodate new behavior always deserves
   "why did this need to change?" This ticket is ENTIRELY about test-data
   correctness, so that question is the whole job.
2. Check the implementation against the LITERAL WORDING of the spec and ACs, not
   just the threat model or happy path. "Stricter than asked" and "looser than
   asked" both read as reasonable and both pass review.
3. When directing a fix, constrain the MECHANISM, not just the outcome — a change
   satisfying the spec's literal wording can silently regress properties the old
   mechanism provided for free, with the unit suite green throughout.
4. Absence of the gate you looked for is not absence of coverage. Check what a
   gate actually scans before citing it OR before claiming a surface is unguarded.
5. Scope every edit to this change directory; never bulk `sed` across
   `openspec/changes/**` or `.concertino/**`.

## References

- HEL-922 / PR #531 (discovered this)
- HEL-330 (PipelineExecutionBackend abstraction, parent of HEL-922)
