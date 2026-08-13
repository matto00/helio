## Skeptic Report — final gate (round 2, skeptic-final-2.md)

### Context

Final-gate review of a coordinator-approved fold-in ("post-delivery follow-up A") onto the
already-delivered `claude-api-integration-layer` change (PR #326, open, unmerged). Cycle 1's own
final gate already CONFIRMed (`skeptic-final-1.md`) and is not re-litigated here. This cycle's
scope is exactly commit `46dd0f42` ("HEL-390 Fold-in: recover mid-stream SSE connection drops
(design.md D9)"), reviewed cold against ground truth — nothing here is taken from the evaluator's
or executor's narrative without independent re-verification.

### What I verified (with evidence)

**1. Diff scope, confirmed exactly as claimed.**
`git diff d287cc99..46dd0f42 --stat -- backend/ infra/ CLAUDE.md schemas/ frontend/` → only
`backend/src/main/scala/com/helio/ai/ClaudeSseAssembler.scala` (+19/-1) and
`backend/src/test/scala/com/helio/ai/ClaudeStreamAssemblySpec.scala` (+26) changed. `git diff
d287cc99..46dd0f42 -- backend/src/main/scala/com/helio/ai/HttpClaudeTransport.scala` is empty —
`HttpClaudeTransport.stream`'s call site is byte-for-byte untouched, matching design.md D9's
explicit placement requirement. `files-modified.md`'s cycle-2 entries match the diff exactly.

**2. AC 8 traced end-to-end through real code, not just the two changed files.**
Read `ClaudeClient.scala:48-54`: `ClaudeClient.stream` delegates directly to
`transport.stream(...)` with no extra wrapping. Read `HttpClaudeTransport.scala:71-90`: the
success branch (line 77) calls `Future.successful(ClaudeSseAssembler.assemble(response.entity.
dataBytes))` — the outer `.recover` (line 84) is on that `Future`, not on the `Source` it
resolves to. So the chain `ClaudeClient.stream → HttpClaudeTransport.stream →
ClaudeSseAssembler.assemble` is intact and the new `.recover` inside `assemble` (`ClaudeSseAssembler.
scala:37-40`) is the only place a post-Future-resolution `Source` failure can be caught — exactly
what AC 8 and the new spec.md requirement ("Mid-stream connection failures surface as a typed
error event") demand. Confirmed against the running code, not asserted from design.md alone.

**3. Gates re-run fresh, myself, in full.**
```
$ cd backend && sbt "testOnly com.helio.ai.*"
[info] Total number of tests run: 28
[info] Tests: succeeded 28, failed 0, canceled 0, ignored 0, pending 0

$ sbt test   # full suite
[info] Total number of tests run: 2540
[info] Suites: completed 155, aborted 0
[info] Tests: succeeded 2540, failed 0, canceled 0, ignored 0, pending 0
[success] Total time: 105 s

$ node scripts/check-scala-quality.mjs
Scala code-quality check: clean (86 soft warning(s))   # identical count to evaluation-2.md

$ node scripts/check-schema-drift.mjs
schemas in sync with JsonProtocols (39 checked across 32 protocol files)
panel-type enums in sync with backend canonical sets (7 surfaces checked)

$ node scripts/check-openspec-hygiene.mjs
OpenSpec hygiene issues:
  - change "claude-api-integration-layer" is complete (23/23) but not archived — ...
```
All numbers match the evaluator's pasted output exactly (2540/2540, 86 warnings, same hygiene
message). The hygiene "not archived" finding is the expected, precedented, Phase-3-owned state
(same as cycle 1) — not a swept-under-rug failure. `grep -n "org\.apache\.pekko\.\|scala\.
concurrent\.\|com\.helio\." ` on both changed files, filtered to non-import/non-comment lines, is
empty — no inline FQNs.

**4. Regression-test validity, independently proven — not just trusted from the commit message.**
Per the systematic-debugging law ("add a regression test that fails before the fix and passes
after — show both"), I temporarily stripped `.recover` from `ClaudeSseAssembler.assemble` (`git
checkout --` afterward to restore, confirmed clean via `git diff --stat` showing no residual
change) and re-ran the new test in isolation:
```
# .recover removed:
[info] - should surface a mid-stream connection drop as a trailing error event... *** FAILED ***
[info]   java.lang.RuntimeException: simulated mid-stream connection drop
[info] Tests: succeeded 6, failed 1

# .recover restored (git checkout --):
[info] - should surface a mid-stream connection drop as a trailing error event... (passed)
[info] Tests: succeeded 7, failed 0
```
The new test genuinely exercises the fixed path — it fails with the real underlying exception
before the fix and passes after. This is not a green test that exercises nothing (the exact trap
`skeptic-design-foldin-a-1.md`'s round-1 REFUTE correctly flagged against the original,
call-site-only proposal).

**5. The "race"/"reliably" wording — reproduced independently, not just trusted from
evaluation-2.md.** I wrote my own standalone scratch spec (`SkepticProbeSpec.scala`, added and
deleted within this session — confirmed via `git status --short` showing no residual file — no
repository file was left modified), run against this project's actual classpath:
- Case A: `Source.single(validFrame) ++ Source.failed(e)` through the real production pipeline
  (`Framing.delimiter` + `.recover`, i.e. the fixture the executor initially tried and rejected),
  20 runs: **every single run** produced `Vector(Error(TransportFailure(...)))` — the valid frame
  lost, **20/20**, not intermittently.
- Case B: the shipped `.map`-based fixture through `ClaudeSseAssembler.assemble` directly, 20
  runs: **every single run** produced the correct `Vector(TextDelta("before-drop"),
  Error(TransportFailure(...)))` — **20/20**.

This independently reproduces evaluation-2.md's finding exactly: the behavior is **fully
deterministic in both directions**, not a "demand/backpressure race" and not merely "not reliable"
in the sense of intermittent/flaky. The commit message, the new test's inline comment
(`ClaudeStreamAssemblySpec.scala:130-134`), and `files-modified.md`'s cycle-2 bullet all use this
same "race"/"does not reliably deliver" language.

**Is the wording nitpick blocking?** No — confirmed by my own reproduction, not just the
evaluator's claim. Reasoning:
- It is a precision issue in **debugging narrative** describing why an intermediate, rejected
  test-authoring attempt failed — not a description of the shipped fix's behavior or correctness.
  The shipped fix's actual root cause (D9: `HttpClaudeTransport.stream`'s outer `Future.recover`
  cannot see a `Source`-level failure after the `Future` has already resolved) is stated
  accurately in `design.md` and independently confirmed against the real code by both design-gate
  skeptic rounds and by me (point 2 above) — that diagnosis is correct and not in question.
  Systematic-debugging's "root cause" requirement is satisfied for the actual bug being fixed; the
  imprecise language is confined to a secondary, correctly-functioning side observation about test
  fixture behavior.
- It does not misrepresent risk in the caller-facing direction: "not reliable" is not false even
  under a deterministic 0%-success reading (0% is indeed "unreliable"); the inaccuracy is only in
  the causal mechanism claimed ("race"/"backpressure timing" vs. the real, deterministic cause —
  `Framing.delimiter` not flushing a buffered-but-undelivered frame on upstream failure the way it
  does on graceful completion). Evaluation-2.md's suggested replacement wording is accurate and
  low-effort to apply later.
- No AC, no spec.md requirement, and no shipped behavior depends on this being a "race" versus
  deterministic — the fix and its test are correct either way, as directly demonstrated by both
  probes.
- I considered whether a future engineer reading "race"/"doesn't reliably deliver" might dismiss a
  genuine future regression as "known flakiness." This is a real but minor downstream risk —
  exactly what non-blocking polish notes exist for, not grounds to send a correct, well-tested fix
  back for a comment rewording.

**6. Carried-over non-blocking note re-verified.** `ClaudeModels.scala:27-29`'s doc comment cites
"design.md D4/D9" for the `TokenUsage`/never-inferred-from-estimate claim. Read the current D9
(`design.md:109-121`): it is about mid-stream SSE recovery, unrelated to token-usage-provenance.
The citation is accidentally not-wrong-looking now that a real D9 exists, but its content doesn't
match — confirmed still present, still just a doc-comment nit, not functional.

**7. No scope creep / no other regressions.** `git diff main...HEAD --stat` (full change, cycles 1
+ 2 combined) touches only `backend/src/main/scala/com/helio/ai/**`, two test files, `infra/*`,
`CLAUDE.md`, and `openspec/**` artifacts — no `frontend/**`, no `ApiRoutes.scala`, no
`schemas/**` implementation changes. This ticket has no UI surface (backend-only integration
library, no route consumer per its own Non-Goals) — Phase 3 UI review is correctly N/A, same as
cycle 1.

### Verdict: CONFIRM

The fold-in AC is met and traced to real, running code (not just design.md prose); all gates
reproduce cleanly with fresh evidence; the regression test is proven to actually exercise the
fixed path (fails-before/passes-after, verified by me); and the flagged "race"/"reliably" wording
is a documentation-precision nit in secondary debugging narrative, independently reproduced as
non-blocking — it does not misstate the fix's correctness, does not touch any AC, and does not
weaken the regression test's validity.

### Non-blocking notes

- `ClaudeStreamAssemblySpec.scala:130-134`, the commit message, and `files-modified.md`'s cycle-2
  bullet all describe the rejected `Concat`-based fixture's frame loss as "a demand/backpressure
  race" / "does not reliably deliver." Independently reproduced as fully deterministic (20/20 in
  both directions). Worth tightening to something like: "`Framing.delimiter` does not flush an
  already-parsed-but-undelivered frame on upstream failure the way it does on graceful completion
  under `allowTruncation = true` — a deterministic difference in failure-vs-completion handling,
  not a race" — next time this file is touched.
- `ClaudeModels.scala:27-29` cites "design.md D4/D9" for a claim that is actually only about D4;
  D9 is unrelated (mid-stream SSE recovery). Should just cite D4. Carried over from
  `evaluation-1.md`/`evaluation-2.md`, still applicable, still cosmetic.
