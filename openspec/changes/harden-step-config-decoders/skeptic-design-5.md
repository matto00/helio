## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

**Round 4 CR-1 — RESOLVED.** `specs/pipeline-assert-op/spec.md` exists as a MODIFIED delta. Its requirement
heading is byte-identical to the shipped one (`openspec/specs/pipeline-assert-op/spec.md:19`), and both
original scenario names are retained verbatim — "Missing rules key decodes to an empty rule vector"
(base :25 / delta) and "A malformed rule entry does not throw" (base :29 / delta), each with its original
WHEN/THEN. Three scenarios added (non-array `rules`, wrong-typed `rules` element, open `params` contents).
The narrowing is scoped to absence + open `params` CONTENTS with a stated rationale. Task 2.6b covers
`AssertStepSpec:48-53` and `:70-73` as PROOF. No dropped scenario; openspec's MODIFIED rule is satisfied.

**Round 4 CR-2 — RESOLVED.** design.md's "Tests this change also moves, beyond HEL-671's five" now names six
tests (`PipelineStepRoutesSpec:1019-1035`, `PipelineAnalyzeProposalRoutesSpec:429-434`, `AssertStepSpec:48-53`,
`:70-73`, `:55-58`, `ChunkByTokenCountStepSpec:145-149` + `PipelineStepConfigCodecSpec:262-265`), each labelled
proof or guard, and closes with "This list, not the '3 of 5' table, is the account of total test impact".
Task 2.4 names `AssertStepSpec:55-58` as the test its `asObject` decision moves.

**Round 4 CR-3 — RESOLVED in substance, and consistent across artifacts.** D4 now states the layer: decode
case-normalizes and stays TOLERANT of unknown-but-correctly-typed enum values; rejection lives at analyze and
run, with the `rowToDomain` 500 / unmeasured-population rationale. tasks.md 5.1 carries the same as a
"do not re-decide" note; 5.1b relabels the two coercion tests; 7.4 proves rejection at the analyze/run layer.
I checked the deltas for any implied decode-time enum rejection: `pipeline-step-config-read-strictness`
speaks only of wrong JSON TYPE; `pipeline-step-config-rejection` rejects wrong-type only on write (so
`combinator:"XOR"`, a correctly-typed string, is not write-rejected); `pipeline-step-config-validation`
places enum rejection at analyze. No artifact implies decode-time rejection. Mechanically this is workable:
`PipelineAnalyzeService.validateStepConfig(kind, config)` (`PipelineAnalyzeService.scala:102`) already
receives the RAW config string, so an analyze validator need not depend on the decoded value.

**Round 4's two non-blocking notes were folded in** — the lookup/union run-time precedent is cited as an
HTML comment atop the `pipeline-step-config-runtime-completeness` delta, and task 5.2 calls out
`LimitStep.scala:19-25` returning `0` for both the wrong-TYPE and the non-representable case.

**Independent sweep (item 3) — two further shipped specs are reversed with no delta.** I grepped
`openspec/specs/**` for tolerant/fallback/defaulting guarantees and read each hit against D1/D4. Beyond the
now-covered `pipeline-assert-op`, two capabilities contain binding requirement text — and, in one case, a
named Scenario — that this change reverses, and neither appears under `specs/` in the change directory.
This is round 4's CR-1 defect class, two capabilities over. See CR-1.

### Verdict: REFUTE

### Change Requests

1. **Two shipped capability specs are contradicted by D4 with no MODIFIED delta — the same defect round 4's
   CR-1 raised for `pipeline-assert-op`.** The change dir carries deltas for `pipeline-assert-op`,
   `pipeline-step-config-{validation,rejection,read-strictness,runtime-completeness}` only.

   a. `openspec/specs/pipeline-dedupe-op/spec.md:10-11` states: "`keep` SHALL default to `"first"` when
      omitted **or any value other than the literal `"last"`**." D4 reverses this twice: `"LAST"` must now be
      treated as `last` (task 7.4 asserts it "keeps the last row"), and an unknown value must be reported at
      analyze rather than defaulted. Under the shipped requirement, `"LAST"` is "a value other than the
      literal `last`" and SHALL become `first` — a direct behavioral contradiction on the run path, on the
      finding D4 itself calls an inversion of which row wins. Required: add a `pipeline-dedupe-op` MODIFIED
      delta narrowing that sentence to case-insensitive matching of `first`/`last` plus rejection of unknown
      values at analyze/run, retaining the existing requirement heading and all existing scenario names
      verbatim (including "Missing keep defaults to first" at :40, which stays true and becomes the absence
      guard).

   b. `openspec/specs/pipeline-chunk-by-token-count-op/spec.md:12-13` states `encoding` "defaults to
      `"o200k_base"` **and falls back to `"o200k_base"` for any other value**", and :48-51 is a named
      Scenario, "Unrecognized encoding value falls back to o200k_base", whose THEN is "the step decodes with
      `encoding` treated as `"o200k_base"` rather than failing". Task 5.1 adds analyze-time rejection of
      unknown `chunkbytokencount.encoding` and 5.1b changes that scenario's backing test
      (`ChunkByTokenCountStepSpec:145-149`) from a fallback assertion to a round-trip guard. Required: add a
      `pipeline-chunk-by-token-count-op` MODIFIED delta stating the new handling (decode tolerant/normalizing,
      unknown value reported at analyze/run), retaining the requirement heading and every existing scenario
      name — and say explicitly what that scenario's THEN becomes, since it is the one place the old
      guarantee is asserted as behavior.

   Both must exist before execution: without them the repo's spec set ends this change self-contradictory on
   its two named enum cases, and the executor has no authority for the behavior tasks 5.1/5.1b instruct.

2. **What `decode` returns for an unknown-but-correctly-typed enum is not stated, and it is load-bearing for
   task 5.1b's assertions.** D4 says decode "case-normalizes and stays tolerant", and that the moved tests'
   value "must now be the case-normalized input **where one exists**". For `dedupe.keep:"bogus"` and
   `encoding:"not-a-real-encoding"` no member exists, and today's code actively coerces —
   `DedupeStep.scala:33` (`if (... == "last") "last" else "first"`) and
   `ChunkByTokenCountStep.scala:38` (`if (KnownEncodings.contains(encodingRaw)) encodingRaw else "o200k_base"`).
   Two readings survive: decode preserves `"bogus"` (so 5.1b's tests change their asserted value), or decode
   keeps coercing (so 5.1b's tests are unchanged and the coercion D4 objects to still happens at run).
   Task 5.1b says only "GUARDS asserting case-normalized input round-trips", which does not decide it.
   Required: state in D4 and in 5.1b which it is, and give 5.1b the concrete expected value for each of the
   two tests. If the answer is "decode keeps coercing", CR-1a's delta must also say so, and the run-path note
   below stops being merely a note.

### Non-blocking notes

- **Run-surface enum/numeric rejection is instructed but unspecced.** D4 and task 5.1 both place rejection at
  "analyze and run", but no spec delta requires it at run — `pipeline-step-config-runtime-completeness` covers
  missing/empty REQUIRED fields only, and task 4.1's single per-step declaration is scoped to requiredness.
  Analyze is a separate user-invoked surface (`PipelineService.analyze:136`); `PipelineRunService` does not
  gate on it, so an analyze-only implementation leaves `combinator:"XOR"` silently ANDing on every scheduled
  run. Task 7.4 does not name the surface it asserts against. Suggest 7.4 assert both surfaces explicitly.
- `PipelineAnalyzeService.validateStepConfig:110-119` wraps its whole dispatch in
  `catch { case _: Exception => Vector.empty }`. Under D1 a wrong-type stored config now raises inside a
  validator, is swallowed here, and falls through to the downstream "<op> config error" path — which is what
  the validation delta's "stored-pipeline analyze surface cannot report such a key" scenario already
  describes, so this is consistent, but the executor should confirm it rather than rediscover it.
- `openspec/specs/pipeline-limit-op/spec.md:9` ("when `count` is missing, zero, or negative, the engine SHALL
  return all rows") is compatible with D4/5.2 as written, since a non-representable value is none of those
  three. Worth a sentence in the validation delta so a reader does not read a conflict into it.
