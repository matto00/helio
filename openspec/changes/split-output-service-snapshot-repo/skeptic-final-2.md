## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `f6cf74bc18772100014ca0d322130cf29cc1deb1` against the live-resolved base
`24f6de4cf290c216c8ba94359f82d1d35ae88f2a` (`resolve-review-base.sh main origin`, exit 0). The spawn-cwd guard
returned READY. This is a backend-only change, so there is no UI review. The only file I wrote is this report. I ran
the builds in a scratchpad `git archive` copy of HEAD.

### What I verified (with evidence)

1. **f6cf74bc1 changes nothing else under backend/.**
   - `git diff 7cec4bfca f6cf74bc1 --stat -- backend` returns 1 file, +1/-1, at `OutputRootResolution.scala:11`.
   - The other files in the commit are change artifacts: files-modified.md, check_moves.py, move-evidence.md, and
     the now-committed evaluation-1.md and skeptic-final-1.md.
   - `git diff 24f6de4cf...HEAD --name-only -- backend/src/test` returns 0 files.

2. **CR1 is satisfied: the class doc now matches the code.** I read the full `OutputRootResolution.scala` at HEAD.
   - Line 11 now says `pipelineRootRepo == null` "skips the ambiguity check and rejects an explicit `rootId` with
     400".
   - Line 26 matches the first half: when the repo is null, `requireUnambiguousRootWhenNeither` returns
     `Right(())`, so the check is skipped.
   - Lines 51-52 match the second half: `resolveExplicitRootId` with `Some(rid)` and a null repo returns
     `Left(BadRequest("rootId is not supported by this deployment"))`.
   - The moved doc bodies at lines 14-24 and 37-47 are still verbatim, so C3 holds.

3. **The move checker passes when I re-run it.**
   - In check_moves.py the commit edits only the matching LAYOUT scaffolding string (line 85). No span or
     substitution changed.
   - I ran `python3 -I .../move-check/check_moves.py <worktree> <worktree>` at HEAD myself. It printed
     `RESULT: PASS` and exited 0, with the same per-file counts the executor pasted into move-evidence.md.

4. **CR2 is satisfied.**
   - files-modified.md item 8 records the three pre-existing wrong doc statements: "degrades identically",
     "degrade contract", and the constructor comment.
   - I confirmed the constructor comment at `OutputService.scala:44-47` is still present and unchanged. It is
     correctly left alone under C3.
   - Item 9 records the evaluator's M1 LIKE-escape test gap at `OutputRoutesSpec.scala:931-942`.

5. **Gates I re-ran myself at HEAD.**
   - `npm run check:scala-quality`: the selftest passes, then "Scala code-quality check: clean (214 soft
     warning(s))", rc=0.
   - `npm run check:node-root-encoding`: "clean (4 file(s) scanned)", rc=0.
   - Compile: in a `git archive f6cf74bc1` copy I ran `sbt clean Test/compile` with a scalacOptions cache-buster.
     It was a real compile, not a cache hit: "compiling 459 Scala sources ... classes", "compiling 466 Scala sources
     ... test-classes", `[success]`.
   - Targeted tests: `testOnly *OutputRoutesSpec *OutputFilteredMetricRoutesSpec *PublicDashboardRoutesSpec
     *NodeSnapshot*Spec *OutputService*Spec` gave 4 suites, 145 succeeded, 0 failed, "All tests passed."

6. **Why I did not re-run the full suite.**
   - Since 7cec4bfca the only backend change is one line inside a `/** */` comment. That cannot change bytecode
     semantics or test outcomes.
   - The evaluator's pasted full-suite totals (6180/6180, 443 suites, per-suite maps identical to base) therefore
     still apply. So do my round-1 results at 7cec4bfca: the javap API diff, 4 independent RED mutations, and a
     clean PR #847 merge-tree compile.
   - The fresh compile and targeted run above confirm nothing regressed.

7. **ACs, D1-D5b and C1-C5 at HEAD.** Since the round-1 trace, nothing outside the one doc line has changed under
   backend/.
   - AC1 (single-concern seams; smaller overage, 331/353 lines vs 503/458): holds.
   - AC2 (zero test edits, suite green): holds.
   - AC3 (mutations bite): holds.
   - AC4 (smaller overage flagged only as a soft warning): holds.
   - Driver constraints (javap-public API unchanged, PR #847 compatibility, check:node-root-encoding passing):
     hold, per items 1 and 5 above and round 1's items 2-4.

### Verdict: CONFIRM

### Non-blocking notes
- The double blank line at `NodeSnapshotRepository.scala:89-90` is still there. It is cosmetic and was optional in
  round 1.
- No gate defect: none of this verdict depends on mtime ordering.
