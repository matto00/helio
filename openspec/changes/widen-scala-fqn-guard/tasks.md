## Standing Constraints

- [C1] A `scala.*` occurrence inside a string literal is not a violation and is never edited to satisfy a sweep; ShareTokenGenerationSpec.scala:45/:56 are load-bearing security-test strings.

## 1. Backend — guard (red first)

- [x] 1.1 Add the D2 red/green selftest cases (incl. a green case for a `"scala.util.Random"` string literal) to `scripts/check-scala-quality.selftest.mjs`; run it against the UNCHANGED guard and save the failing transcript to `proof/selftest-red.txt`
- [x] 1.2 Widen `FQN_PREFIXES` to `scala.` (D1), update the guard header comment and CONTRIBUTING.md's list; save the passing selftest transcript to `proof/selftest-green.txt`
- [x] 1.3 Mutation-prove: temporarily restore the old prefix list, run the selftest (red), restore; save to `proof/selftest-mutation.txt`
- [x] 1.4 Run `scripts/concertino/test-gate-in-isolation.sh HEL-1446 scripts/check-scala-quality.mjs` (and the selftest file if classified) and keep the PASS evidence

## 2. Backend — fix inline scala.* uses

- [x] 2.1 Run the widened guard, save the full violation list to `proof/violations-before.txt`
- [x] 2.2 Collision audit per file (D3), saved to `proof/collision-audit.txt`
- [x] 2.3 Replace every flagged inline use with an import per D3 (main + test sources)
- [x] 2.4 Whole-namespace raw sweep (D4, strings blanked); fix splice-hidden code hits only; leave ShareTokenGenerationSpec:45/:56 strings untouched; save to `proof/raw-sweep.txt`
- [x] 2.5 `npm run check:scala-quality` exits 0; save to `proof/guard-green.txt`

## 3. Backend — stale references and cosmetics

- [x] 3.1 Re-point every stale `PipelineAnalyzeService.<moved member>` ref per D5 (backend scaladoc, steps README, docs/, frontend AssertConfig.tsx comment, PipelineAnalyzeRoutesSpec.scala:525 line-number citation); never edit V94
- [x] 3.2 Run the D5 zero-hit grep (excluding openspec/specs pre-archive) the `PipelineAnalyzeService\.scala:[0-9]+` probe, and the member-existence check; save to `proof/stale-refs-grep.txt`
- [x] 3.3 Cosmetic fixes per D6 in PipelineAnalyzeService.scala and PipelineAnalyzeProtocol.scala

## 4. Tests

- [x] 4.1 Backend compiles (`sbt compile` + `Test/compile`) from the worktree's own backend/ (check the project path lines)
- [x] 4.2 Full backend suite `nice -n 19 sbt testFull` passes (judge by the ScalaTest summary, not only the exit code); save the summary to `proof/sbt-testfull.txt`
- [x] 4.3 Frontend lint/prettier pass for the one comment edit; pre-commit hook green on commit
