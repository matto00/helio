## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

All measurements below are my own, run in this worktree. I did not rely on
mutation-evidence.md or evaluation-2.md for any verdict-bearing claim.

**1. Scope of the change (AC: test-only, no migration).**
`git diff main...HEAD --stat` over commits 8d69919f + 4d5c2c84 touches exactly one
code file — `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala`
(+140) — plus `openspec/changes/**` artifacts. No `backend/src/main/**` file, no
`db/migration/**` file. Working tree clean except the evaluator's untracked
`evaluation-2.md` evidence artifact.

**2. Baseline green.**
`sbt 'testOnly ...PipelineRunServiceSpec -- -z "HEL-957"'` → 3 tests, 3 succeeded.

**3. Mutation M1 (widen, line 507: `closureOf(sortedSteps.toVector, target)` → `sortedSteps.toVector`),
applied by me, node-keyed lookup at 527 left intact.**
Both step-preview guards RED, for the claimed reason (an extra off-closure key appears):
```
- ...(HEL-957 AC1/AC2) *** FAILED ***
  Set(4 ids) was not equal to Set(3 ids)   (PipelineRunServiceSpec.scala:1124)
- ...(HEL-957 AC3, M4 fixture axis) *** FAILED ***
  Set(3 ids) was not equal to Set(2 ids)   (PipelineRunServiceSpec.scala:1151)
```

**4. Three genuinely distinct axes at line 507 on the CURRENT fixtures (the cycle-1 defect).**
I re-derived this observationally rather than trusting the relabelling claim. On
test 1's three-node trunk the three mutations produce three DIFFERENT observed key
sets, all differing from the expected 3-key set:
- M1 (widen): 4 keys — a strict superset.
- M2 (wrong node, `closureOf(..., sortedSteps.head)`): 1 key `{stepA}`.
- M3 (`closureOf(...).dropRight(1)`): 2 keys `{stepA, stepB}`.
M2 ≠ M3 as observed values, so the cycle-2 fix (lengthening the trunk) is real, not
a relabelling. On the two-node fixture that cycle 1 shipped, M2 and M3 would both
have yielded `{stepA}` — exactly the collapse the evaluator caught; it no longer occurs.

**5. Site-2 spy guard (line 662, `evaluateNodeRowsForBackfill`) genuinely discriminates.**
Mutation `closureOf(allSteps.toVector, target)` → `allSteps.toVector`, applied by me:
```
- ...backfill's spy execution backend ... (HEL-957 AC5) *** FAILED ***
  Set(3 ids) was not equal to Set(2 ids)   (PipelineRunServiceSpec.scala:2056)
```
The assertion is not on something the mutation cannot change: it reads
`spy.capturedSteps`, i.e. the `steps` vector actually handed to
`PipelineExecutionBackend.execute`, which is precisely the mutated expression. The
test nulls `capturedSteps` after `submit` and asserts `defined`, so a capture leaking
from `submit` cannot satisfy it; and unmutated it observes 2 elements where `submit`'s
full list is 3, proving the observed capture originates in the backfill path.
Cross-check on orthogonality: the site-2 mutation left both step-preview guards GREEN,
and all three line-507 mutations left the backfill guard GREEN — each guard is bound to
its own call site, no accidental coupling.

**6. Fixture degeneracy sweep.** Beyond the disabled-node case already ruled out
(`enabled = true` on both off-closure nodes, verified in the diff), I looked for other
ways expected could coincide with broken output. The assertion is a `Set` of step UUIDs,
not a row count, so value collisions are impossible; the off-closure node is a real
enabled `limit` step that does get a `stepCounts` entry when executed (demonstrated —
M1's failure is precisely that extra key). The three line-507 mutations empirically
produce three distinct non-expected sets, which is direct evidence of non-degeneracy
rather than an argument for it. The expected set is a proper subset of the full node
set in both fixtures (3-of-4 and 2-of-3), so "closure == full step list" — the coincidence
that neutered the pre-existing HEL-922 tests — does not hold here.

**7. Final tree state (AC6).** All mutations reverted; `git status --porcelain` shows no
tracked modifications and both `closureOf` call sites restored verbatim (lines 507 and 662
re-inspected). Full backend suite re-run by me from the clean tree:
```
[info] Total number of tests run: 3848
[info] Suites: completed 254, aborted 0
[info] Tests: succeeded 3848, failed 0, canceled 0, ignored 0, pending 0
```

**8. Acceptance-criteria trace.**
- AC1 — met: both preview guards assert `stepRowCounts.keySet` (threaded from
  `outcome.stepCounts` at PipelineRunService.scala:536, bypassing the masking node-keyed
  lookup at 527), on pipelines with an enabled off-closure node.
- AC2 — met: M1 red, produced by me, output above, lookup at 527 intact.
- AC3 — met: M2 and M3 are structurally different from M1 and from each other, all three
  independently observed red, plus the M4 multi-root fixture axis.
- AC4 — met: see §6.
- AC5 — met by guarding, not by scoping out: spy-backend test red under the site-2 mutation.
- AC6 — met: full suite green from the clean tree, my own run.

### Verdict: CONFIRM

### Non-blocking notes
- `evaluation-2.md` is untracked in the worktree; if the change dir is meant to carry the
  evaluator's evidence into the archive, it needs to be committed before delivery.
