## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of commit `e75cc325`. Backend-only; no UI changes, so section 4 (design judgment) is
not applicable and the dev-server phase was not started. Every conclusion below is derived from the
code, the live dev database, or a command I ran myself.

### What I verified (with evidence)

**Gate re-run (own execution).** `sbt -batch test` in `backend/`: `Tests: succeeded 3821, failed 0`,
243 suites, 204s. Not taken from the evaluator's report.

**1. Weak-assertion audit of the new tests — passed.** I read every new/changed assertion in
`RefinementEditShapeSpec`, `PatchSetPreviewServiceSpec`, `PipelineStepRequiredConfigSpec` (420 new
lines), `PipelineStepRoutesSpec`, `PipelineProposalServiceValidateSpec`, `AssertStepSpec`,
`PipelineAnalyze*RoutesSpec`. I found **no** assertion of the "did not throw" / bare-`Left` form.
The flips assert `intercept[StepConfigTypeMismatch]` **plus** the message naming the key and the
observed JSON kind; the preview proofs assert a specific `ServiceError.UnprocessableEntity` and its
text, with an explicit `case Left(other) => fail(...)` arm whose failure message states that a
`BadRequest` there would mean the D2 wiring is absent — i.e. the test is deliberately bound to the
wiring rather than to "some rejection happened". Run-path proofs assert `thrown.stepId`,
`thrown.stepKind` and the reason substring; behavioural proofs assert contents
(`out.head("amount") shouldBe 20` for `keep:"LAST"`, `keySet should contain("")` for the
pre-fix compute degradation).

**2. 3-of-5, honestly — confirmed.** Exactly three characterization tests flipped
(`pivot` non-array `index`, `unpivot` bare-string `valueVars`, `window` non-array `partitionBy` +
bare-string `orderBy` element), each relabelled `PROOF:` in its test name. The `join` decode test
keeps `decoded.joinKey shouldBe ""` and the `PatchSetPreviewServiceSpec` preview test keeps its
`Right` expectation — both unchanged assertions, both retitled `GUARD:`. I read the comments in
full: they state the absence-vs-wrong-type distinction, cite D1/D2 and the 20 measured draft rows,
say where completeness is enforced instead (`PipelineStepRequiredConfigSpec`), give a concrete
mutation that would redden them, and — in the preview case — explicitly record that HEL-671's
prediction that this test would fail was wrong and why. A future reader cannot mistake this for a
reverted hardening. No contrivance: the displaced `varName shouldBe "variable"` assertion was
re-sited into an adjacent named guard rather than dropped, and the lost flip is replaced by a new
wrong-type preview proof sited next to the guard it replaces.

**3. Independent mutation testing (2 proofs, both different from the evaluator's targets).**

- *Mutation A* — reverted `StepCodecUtil.stringArray` to the pre-fix tolerant form
  (`items.collect { case JsString(s) => s }`, non-array → `Vector.empty`), recompiled, ran
  `RefinementEditShapeSpec`: **3 failed** — exactly the three `PROOF:` tests — while both `GUARD:`
  tests and all 17 other tests stayed green. Restored via `git checkout`.
- *Mutation B* — replaced the new `validateRawConfig` call in `PipelineProposalService.validateStep`
  with `Option.empty[String]` (MCP-apply wiring only), recompiled, ran
  `PipelineProposalServiceValidateSpec`: the `window partitionBy` 422 proof **failed**, the
  draft-acceptance guard stayed green. Restored via `git checkout`; `git status` clean afterwards.

Guards are labelled `GUARD:` in their test names throughout and are never counted as proof in
`tasks.md`/`files-modified.md`.

**4. The D8 trap — verified in code, not from the report.** `grep` for
`requiredConfigProblems` overrides across `domain/steps/`: overrides exist only on `pivot`,
`lookup`, `compute`, `splittext`, `filter`, `datebucket`, `extractheadings`, `stringops`, `dedupe`,
`join`, `window`, `chunkbytokencount`, `limit`. Field-by-field:
`limit.count` → override rejects **only** a non-`Int`-representable number (zero/negative/absent
untouched); `sort.sortBy` → no override; `cast.casts` / `rename.renames` / `select.fields` /
`unpivot.valueVars` → no override at all; `dedupe.keys` → override covers `keep` only;
`filter.conditions` → override covers `combinator` only. All eight are optional-with-default in the
shipped code. Confirmed behaviourally in 5 below: the live `select` row `{"fields":[]}` produces
zero run problems.

**5. Read-path safety — tested against the real code and the real database.** I dumped all 78 rows
of `pipeline_steps` from `postgresql://matt@localhost:5432/helio` (read-only `SELECT`) and ran every
row through the **shipped** `PipelineStep.companionFor(op).decodeConfig`, `validateRawConfig` and
`requiredConfigProblems` in a throwaway ScalaTest suite (since deleted; tree verified clean):

- decode failures: **0 of 78** — absence and emptiness still decode, so `rowToDomain:261` never
  throws for any live row and listing steps is safe.
- `validateRawConfig` rejections: **0 of 78** — every stored row is still re-savable.
- `requiredConfigProblems` hits: **7**, and all seven are exactly the intended D3 population —
  `lookup` ×2 with empty `sourceKey`/`lookupKey`, `datebucket`/`splittext`/`extractheadings`/
  `chunkbytokencount` with `field:""`, `pivot` with empty `column`/`values`. Notably the
  `stringops` row with `field:""` and `operation:"concat"` correctly produced **no** problem
  (conditional requiredness works), and `select {"fields":[]}`, `sort {"sortBy":[]}`,
  `filter {"conditions":[]}`, `cast {"casts":{}}`, `rename {"renames":{}}` all produced none.

This is a direct measurement of the five prod draft shapes named in my brief, against real rows.

**6. The disclosed `limit.count` gap — reasoning is correct, not a rationalization.** I traced it:
`InProcessPipelineEngine.requiredConfigProblems` obtains raw text via
`companion.encodeConfig(step.configValue)`, and `LimitStep.configValue` is a `LimitConfig(count: Int)`
already narrowed by `decode`, so the run path provably re-encodes `{"count":0}` and the predicate
cannot see the original number. The claim is structurally true. The scope claim also holds: the
runtime-completeness delta governs "missing or empty **required** configuration", which this value
is not; the non-representable-count scenario lives in `pipeline-step-config-validation`, an
analyze-surface capability, so the analyze-only requirement is a natural fit rather than a
requirement bent to the implementation. The gap is disclosed in three places — the `LimitStep`
scaladoc (naming all three rejected alternatives and why), the design D4/D8, and, most convincingly,
a **test that asserts the gap itself** (`"the RUN surface is knowingly NOT covered for this one
value"`, asserting `decode(...).count shouldBe 0`, `requiredConfigProblems(raw) should not be empty`,
and the run-path predicate `shouldBe empty`). A gap pinned by an assertion cannot silently close or
silently widen. Residual severity is low: the trigger is a supplied `count` outside Int range, the
outcome is "no limit applied", and analyze catches it. Accepted.

**7. Independent checks beyond the brief.** Read the full `git diff main...HEAD` of the main
sources. `PatchSetApplyResolvers` and `PipelineProposalService` both run `validateRawConfig` before
the decode so the specific message wins over the generic one, and both use 422 (understood-and-
refused) vs. the retained 400 (unparseable). `PipelineAnalyzeService` computes `shapeRejection`
outside the `catch { case _: Exception => Vector.empty }`, which is the one place the catch-all
would otherwise have swallowed a D1 raise into silence — that ordering is load-bearing and correct.
The `extractConfig` 24-arm match was replaced by an abstract `configValue`, which the compiler
enforces. The knowing narrowing of HEL-860's AC3 (wrong-type stored `cast` row now 500s on listing)
is not hidden: the test was rewritten to assert the 500 **and** to `intercept[StepConfigTypeMismatch]`
on the same raw config so it cannot pass for an unrelated 500, with the residual risk stated in the
comment, and a paired guard asserting the absent-`casts` row still returns 200.

Acceptance criteria trace: AC1 → `enumeration.md` + the registry test asserting exactly 23 kinds and
per-kind wrong-type rejection; AC2 → D1/D2 in code plus the D8 optional-field justifications I
verified above; AC3 → the 3 flips + preview/proposal 422 proofs, all shown red by my own mutations;
AC4 → the 78-row live decode run, 0 failures; AC5 → recorded in design D2/D5 and exercised by tests
at all three surfaces.

### Verdict: CONFIRM

### Non-blocking notes

1. `StepCodecUtil.intOpt` still returns `None` for a correctly-typed but non-`Int`-representable
   number (e.g. `window.offset`), which is the same silent-narrowing class as `limit.count` but
   without even an analyze-time report. Worth a spinoff alongside the disclosed `limit.count` gap.
2. `LimitStep`'s non-representable `count` could additionally be rejected on the **write** path by
   overriding `validateRawConfig`, which would stop new instances at the source without touching the
   read path. Not required by any shipped scenario; cheap follow-up.
3. A wrong-type stored row now yields a 500 on merely listing steps. Measurement says the population
   is empty, and this is settled design, but the failure mode is unfriendly; a future ticket could
   surface it as a per-step `validationError` on the list response instead.
