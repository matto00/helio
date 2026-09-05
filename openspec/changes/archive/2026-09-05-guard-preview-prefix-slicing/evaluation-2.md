## Evaluation Report — Cycle 2 (evaluation-2.md)

Re-review of commit `4d5c2c84` against evaluation-1.md's two change requests. Cycle-1 findings not
re-litigated here except where cycle 2 touched them.

### Phase 1: Spec Review — PASS

**CR1 — CLOSED, and closed by the preferred path (fixing the gap, not documenting it).**
The executor lengthened the line-507 linear fixture from `[stepA, target]` to
`stepA -> stepB -> target` (`PipelineRunServiceSpec.scala:1108-1116`), keeping the enabled
off-closure tail on `stepA`. The three mutations now produce three genuinely different observed
key sets, verified by me against the fresh transcripts (all captured 16:06–16:07, i.e. after the
16:14 commit's code was in place — line numbers in the transcripts, 1124 and 1151, resolve
exactly to the current file's two `stepRowCounts.keySet` assertions, which is the check that
stale transcripts fail):

| Mutation | Observed key set | Expected | Shape |
| - | - | - | - |
| M1 (`sortedSteps.toVector`) | 4 ids | 3 ids | superset — gains the off-closure tail |
| M2 (`closureOf(..., sortedSteps.head)`) | 1 id (`{stepA}`) | 3 ids | subset — loses `stepB` and `target` |
| M3-repl (`closureOf(..., target).dropRight(1)`) | 2 ids (`{stepA, stepB}`) | 3 ids | subset — loses only `target` |

M2 and M3-replacement are now distinguishable by observation, not merely by intent — the exact
defect CR1 named. `mutation-evidence.md`'s accounting section states this accurately, including an
explicit acknowledgement that the cycle-1 two-node fixture could not separate them and that AC3
was already met by M1 vs M2 alone. The claim now matches the transcripts.

**Stale-transcript check (the thing CR1 could have been "fixed" dishonestly):** the cycle-1
transcripts were *replaced*, not appended to — `git show 4d5c2c84` shows `m1/m2/m3_*_evidence.txt`
each shrinking as old content was overwritten, and every retained line carries a fresh timestamp
and current line numbers. The M3-original wrong-reason transcript was also re-run against the new
fixture (16:07:55) and still reds on `UnprocessableEntity`, correctly still excluded from the axis
count.

**CR2 — CLOSED.** `tasks.md` 2.1 now names `PipelineRunServiceSpec` and records why the guards
were relocated from the originally-planned `PipelineRunRoutesSpec` (the site-2 spy needs
service-level construction, so both line-507 guards live alongside it).

All other ACs remain satisfied; nothing in cycle 2 weakened them. AC4 non-degeneracy is still
demonstrated rather than asserted — M1's red on the new fixture shows a strictly larger observed
key set, which is only possible with a genuinely off-closure, genuinely enabled node.

### Phase 2: Code Review — PASS

Gates re-run by me, fresh, in the worktree at `4d5c2c84` (not trusting the executor's report):

```
cd backend && sbt test
[info] Run completed in 4 minutes, 56 seconds.
[info] Total number of tests run: 3848
[info] Suites: completed 254, aborted 0
[info] Tests: succeeded 3848, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
[success] Total time: 298 s, completed Sep 5, 2026, 4:21:30 PM   (exit 0)
```

Frontend gates: N/A — no `frontend/**` path in `git diff --name-only main...HEAD`.

Constraints re-verified at the final tree:

- **Test-only** — `git diff --stat main...HEAD -- backend/` is exactly one file,
  `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala`.
- **No production-source change** — confirmed by the same diff; additionally I read both call
  sites in the final tree: `PipelineRunService.scala:507`
  (`NodeDependencyClosure.closureOf(sortedSteps.toVector, target)`) and `:662`
  (`NodeDependencyClosure.closureOf(allSteps.toVector, target)`) are both **unmutated**. Every
  mutation was genuinely reverted.
- **No migration** — no `db/migration/**` path in the diff.
- **`git status --porcelain`** — empty.
- No Playwright, no e2e specs, no dev servers, no `cleanup.sh` invoked during this review.

Code quality: the dropped `enabled shouldBe true` tautologies leave the fixture's enabled-ness
expressed where it belongs — in the literal `enabled = true` argument plus the comment — and the
now-redundant "referenced only to satisfy the compiler" note went with them. Comments accurately
describe the three-node trunk and why it is three nodes. No dead code, no FQNs, no new imports
needed.

### Phase 3: UI Review — N/A

No trigger matched (no `frontend/**`, `ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**`).

### Overall: PASS

Both change requests are closed, CR1 by the stronger path. The guard now discriminates four
distinct wrongness modes across two call sites (three code axes at :507 with three different
observed key sets, plus the :662 widening caught by the spy backend), on fixtures whose
non-degeneracy is demonstrated by observation. Full backend suite green under my own fresh run.

### Non-blocking Suggestions

- `mutation-evidence.md`, Site 2 section, says the site-2 fixture "was NOT changed in cycle 2 …
  so the cycle-1 transcript still accurately describes the shipped code". The fixture *graph* is
  indeed unchanged, but the test *body* did change — the trailing `tail.enabled shouldBe true`
  was removed and `val tail = await(...)` became `await(...)` — and the transcript's cited
  `PipelineRunServiceSpec.scala:2047` no longer resolves to that assertion, which now sits at
  `:2056`. The reuse is disclosed rather than passed off as fresh, and the deleted line is
  provably inert with respect to the red (it followed the failing assertion and could only ever
  pass), so this changes nothing substantive. Still, the tidiest fix is either a one-line
  re-run of the site-2 mutation to get a line-accurate transcript, or narrowing the sentence to
  "the fixture graph is unchanged; the body lost only a tautological trailing assertion, and the
  cited line number is cycle-1 vintage".
- `tasks.md` 2.1a still reads "Assert this property of the fixture explicitly", which the cycle-2
  removal of the `enabled shouldBe true` assertions no longer does literally (it is now carried by
  the `enabled = true` argument and the comment). That removal was evaluation-1.md's own
  suggestion and is an improvement; 2.1a's wording could be trued up to match.
