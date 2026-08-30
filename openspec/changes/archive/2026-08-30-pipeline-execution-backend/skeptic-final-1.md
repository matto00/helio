## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold, independent pass. Every conclusion below is derived from the branch's own diff, source, and
gate runs I executed myself — not from files-modified.md or evaluation-1.md, which I read only as
claims to check.

### What I verified (with evidence)

**1. The committed diff is what is claimed.**
`git log --oneline -3` → single commit `be3fcc67` on top of `e30a0c72` (main). `git diff
--name-status main...HEAD` → exactly 6 backend files (2 added, 4 modified) + 8 change-doc files.
`files-modified.md` lists exactly those 6 backend files with accurate per-file descriptions.
**files-modified.md is accurate.**

**2. No wire / schema / migration / route / frontend change.**
`git diff main...HEAD --stat -- schemas/ frontend/ backend/src/main/resources/db openspec/specs`
→ empty. No route file in the diff. No UI changes, so the design-judgment section (DESIGN.md,
screenshots, light/dark parity) is **not applicable** and was correctly skipped rather than faked.

**3. `SparkJobSubmitter.submit`'s body is untouched.**
The only hunks in that file are: the import block, the class declaration gaining
`extends PipelineExecutionBackend`, and a wholly additive `execute` method inserted at line 106
*after* `submit` ends (line 104's `}(sparkEc)`). No hunk falls inside `submit`. The explicit
instruction ("must NOT touch submit's body") holds.

**4. The `previewStep` assertionSink substitution is genuinely behavior-preserving** — the one
place this refactor could have silently changed semantics. `previewStep` previously relied on
`executeWithStepCounts`'s defaulted sink; the trait's non-optional parameter removed that default.
I read the engine signature directly: `InProcessPipelineEngine.scala:116` →
`assertionSink: AssertionSink = new AssertionSink`. The default was a **fresh** sink, and the new
call site passes `new AssertionSink`. Identical, and not shared with the run path's sink. Confirmed,
not taken on trust.

**5. Argument-for-argument equivalence at both call sites.** `InProcessExecutionBackend.execute`
reproduces `executeRun`'s original chain verbatim (`loadRowsWithStats(...).flatMap { ...
executeWithStepCounts(sourceRows, steps, dataSourceRepo, assertionSink, truncationSink) }`), same
positional order as the pre-change code. `previewStep`'s `.recover` still wraps the whole
execute+map expression, so error attribution (HEL-311/HEL-859 prefixes) is unchanged.

**6. Gates re-run by me, output read.**
- `sbt -batch compile` → `[success]`.
- `sbt -batch test` → `Total number of tests run: 3844 / Suites: completed 244, aborted 0 /
  Tests: succeeded 3844, failed 0`. **All existing tests pass unchanged.**
- Both new tests confirmed to actually execute (not silently skipped), by name:
  `- should produce a PipelineExecutionOutcome matching the source data and documented approximations`
  and `- should produce the same rows/stepCounts/sourceRowCount/primaryStats as the direct engine calls (task 4.3)`.

**7. Mutation check — the new guard is failable, and the seam is really exercised.**
A green test proves nothing until it can go red. I mutated
`InProcessExecutionBackend.execute` to return `stepCounts = Map.empty` and re-ran:
`InProcessPipelineEngineSpec` → `1 FAILED` on the parity test. Reverted immediately;
`git status --porcelain` clean (only the untracked `evaluation-1.md`). The parity test is a real
guard, not a tautology.

### Acceptance criteria traced

| AC | Evidence |
|---|---|
| All existing pipeline/run tests pass unchanged; no behavioral or wire diff | 3844/3844 green (my run); zero diff under `schemas/`, `frontend/`, `db/migration`, `openspec/specs`; no route file touched |
| The trait cleanly admits a second impl | `SparkJobSubmitter extends PipelineExecutionBackend` with a real `execute`, evidenced by an actual invocation in `SparkJobSubmitterSpec` asserting row content **and** the documented approximations — an executed call, not an assertion that it "would work" |
| CONTRIBUTING refactor discipline (behavior-preserving; bugs are spinoffs, not folded in) | `submit` byte-unchanged; no opportunistic fixes anywhere in the diff; the one semantic hazard (defaulted assertionSink) was preserved exactly, per point 4 |

Systematic-debugging law is not engaged — this is a refactor, not a bug fix, so no probe-confirmed
root cause is owed.

### Verdict: CONFIRM

### Non-blocking notes
- The mutation in point 7 did **not** fail `PipelineRunServiceSpec` / `PipelineRunRoutesSpec`
  (94/94 still green with a wrong `stepCounts`). That is a **pre-existing** coverage gap — the
  run/preview route responses' `stepCounts` field is not asserted end-to-end — not something this
  change introduced, and the new parity test now covers the value. Worth a spinoff if
  HEL-331/HEL-332 start depending on `stepCounts` through the dispatch path.
- `PipelineRunService.scala` ~line 297: the `.recover {` is indented one level shallower than the
  `.map {` it chains from, a cosmetic artifact of the hunk. Cost-free to fix on a future touch.
- `SparkJobSubmitter.execute`'s approximations (`Map.empty` stepCounts, pre-step `sourceRowCount`,
  always-untruncated `primaryStats`) are correctly documented in both the design and the method
  scaladoc. Zero production callers today, so harmless — but HEL-331/HEL-332 must revisit them
  before relying on anything beyond `rows`.
