# Evaluation Report — Cycle 2 (evaluation-2.md)

Commit reviewed: `a97431e4` (branch `bug/reject-mistyped-step-config/HEL-860`), diffed against cycle 1's
`05b97fdd` and against `main`. Backend-only; Phase 3 remains N/A (no `frontend/**`, no `ApiRoutes.scala`,
no `schemas/**`). Everything asserted below is from my own runs in this worktree.

## Phase 1: Spec Review — PASS

### CR-1 discharged, verified for BOTH kinds

`StepCodecUtil.requireStringMap` (`StepCodecUtil.scala:57`) now takes `shapeDescription` and `example`;
both interpolations use them, and no wording is hardcoded in the helper any more. Shipped messages:

- `cast` (`CastStep.scala:90-94`): `Invalid 'cast' config: 'casts' must be an object mapping field name to
  type name, e.g. {"casts": {"amount": "double"}} — got …` — **byte-identical to cycle 1's cast message**
  (confirmed by reading the `05b97fdd..a97431e4` diff: the cast wording string is unchanged, only relocated
  to the call site). `"double"` is a real supported target type (`CastStep.scala:72`), so the example is
  itself valid input.
- `rename` (`RenameStep.scala:77-81`): `… 'renames' must be an object mapping from-field-name to
  to-field-name, e.g. {"renames": {"amount": "total_amount"}} — got …`, matching
  `RenameConfig.renames`'s actual from → to field-name semantics (`RenameStep.scala:29-31`).

**Could either message now guide a caller into a config this validator accepts but that produces a wrong
result?** No, for either kind. Both examples are literally correct configs for their own step: casting
`amount` to `double` casts, and renaming `amount` to `total_amount` renames. The cycle-1 hazard — a caller
following `rename` guidance and sending `{"renames":{"amount":"double"}}`, accepted and silently renaming
the column to `"double"` — is gone, because no `rename` message mentions a type name at all. Test 4.3 pins
both halves: `msg should include("from-field-name to to-field-name")` **and**
`msg should not include "type name"`.

Wording nit only (not a defect): `"from-field-name to to-field-name"` is accurate but reads awkwardly. See
suggestion 4.

### Drift risk from per-call-site parameterisation — closed

`requireStringMap`'s two new parameters have **no default values**
(`def requireStringMap(obj: JsObject, key: String, kind: String, shapeDescription: String, example: String)`),
so a future third caller cannot inherit a misleading default — it will not compile without supplying its
own wording. That is the strongest available form of the guarantee asked for and is exactly right.

The two existing call sites are the only ones in the tree
(`grep -rn "requireStringMap" backend/src --include=*.scala` → the definition plus `CastStep.scala:90` and
`RenameStep.scala:77`), and both pass the arguments **by name** (`shapeDescription = …`, `example = …`), so
the two `String` parameters cannot be transposed silently at either site. Divergence between the sites is
now the intended behaviour rather than a hazard — what must not diverge is the *format*, and that stays in
the single shared helper. The helper's scaladoc records why the wording is per-kind, citing the concrete
failure mode, so a future maintainer cannot "DRY it back up" without reading the reason.

### AC re-check against the final tree

AC1/AC2/AC5 re-verified this cycle at the route level (4.1/4.2/4.3/4.5 in `PipelineStepRoutesSpec`, all
asserting `StatusCodes.UnprocessableEntity` + `responseAs[ErrorResponse].message` + no step created /
stored config unchanged). AC3, AC4, AC6, AC7 were signed by measurement in cycle 1 and this cycle's diff
touches nothing they depend on — spot-checked and still true: the diff removes zero lines from either
`*Config.decode` (only the `validateRawConfig` overrides changed), and no analyze-path, proposal-path or
`PipelineService` file changed at all. Task list unchanged and still matches the implementation.

### Spec-delta and design/proposal audit (standing requirement 2)

- `specs/pipeline-step-config-rejection/spec.md` — "This requirement applies to the `cast` step's `casts`
  key and the `rename` step's `renames` key, each of which SHALL be an object mapping string field names to
  string values." **Still accurate and not misleading for `rename`.** It describes the *type-level* shape
  (`Map[String, String]`), which is genuinely common to both keys, and it deliberately does not assert what
  the values mean; the rejection rule the spec states is the shape rule, which is what the code enforces.
  Its scenarios assert only "describes the expected object-of-string-to-string shape", which both messages
  still do. No change needed.
- `specs/pipeline-step-config-validation/spec.md` — untouched by this cycle and unaffected.
- proposal.md — makes no claim about message wording; still accurate.
- design.md Decision 3 — the "Message shape" block still quotes the cast message verbatim (correct), but the
  preceding clause "Concretely, for `cast`/`casts` (and identically `rename`/`renames`)" now reads as though
  the *wording* is shared, when after CR-1 only the *rule* is. The rule genuinely is identical, so this is
  stale phrasing rather than a false claim; see suggestion 5 for the one-line fix.
- Every other "unchanged / preserved / already handled" sentence I audited in cycle 1 still holds; nothing
  in this cycle's diff disturbs any of them.

## Phase 2: Code Review — PASS

### Gates (my own fresh runs, in `WORKTREE_PATH`; `CLEAN_WORKTREE` not set)

- `cd backend && sbt -batch test` → `Tests: succeeded 3686, failed 0, canceled 0, ignored 0, pending 0`,
  `All tests passed.`, exit 0.
- `npm run check:scala-quality` → `clean (140 soft warning(s))`; none in the touched files.
- No `frontend/**` change, so the frontend gates are not triggered.

### Red-on-revert — recaptured independently against the FINAL COMMITTED tests

Cycle 1's transcript is stale (the tests changed again), so I re-ran it rather than reusing it.
`git checkout main --` on exactly the five main sources, tests left at `a97431e4`, then
`sbt testOnly PipelineStepRoutesSpec PipelineAnalyzeRoutesSpec PipelineAnalyzeProposalRoutesSpec`:

```
- should POST /pipelines/:id/steps returns 422 for a list-shaped casts config and creates no step (4.1) *** FAILED ***
- should POST /pipelines/:id/steps returns 422 for a casts object with non-string values and creates no step (4.2) *** FAILED ***
- should POST /pipelines/:id/steps returns 422 for a list-shaped renames config and creates no step (4.3) *** FAILED ***
- should PATCH /pipeline-steps/:id returns 422 for a mistyped config and leaves the stored config unchanged (4.5) *** FAILED ***
Tests: succeeded 86, failed 4, EXIT=1
```

Exactly the four rejection tests red, all 86 others green, against the strengthened 4.3. Working tree
restored (`git checkout HEAD -- backend/src/main`; `git status` shows only the untracked
`mutation-evidence-cr1.md`).

### Sanity-check of the orchestrator's mutation evidence — reasoning is sound

I did not repeat the run, as instructed, but I checked the argument and the artifact against this tree, and
both hold:

- The premise is correct and is a real gap, not a formality: 4.3's load-bearing half
  (`should not include "type name"`) is a negative assertion, and a **source revert** deletes the validator
  so the message never exists — the negative then passes for the wrong reason. Source-revert red therefore
  cannot bind that assertion; only a wording mutation can. This is precisely the "evidence-shaped
  non-evidence / dead mutation arm" failure mode.
- The chosen mutation is the right one: it reintroduces *only* the pre-fix `shapeDescription`/`example` in
  `RenameStep.scala`, leaving the validator, the 422 path and every other test intact — so it isolates the
  exact defect CR-1 named.
- The recorded result discriminates: 1 failure, and it is 4.3 failing on
  `did not include substring "from-field-name to to-field-name"`, with 54 others green. If the assertion
  were vacuous, 4.3 would have stayed green under that mutation. The quoted failure message also matches
  the pre-fix string this cycle's diff removes, so the artifact is internally consistent with the tree.
- The mutated file is back at `a97431e4` — I verified `git status` is clean for `backend/`.

One residue only: `openspec/changes/reject-mistyped-step-config/mutation-evidence-cr1.md` is **untracked**.
See suggestion 6.

### Code quality

The parameterisation is the minimal change that fixes the defect: no new abstraction, no behaviour change
beyond the message text, format still shared, per-kind meaning pushed to the only places that know it. The
scaladoc and the test comment both record the *why* with the concrete failure mode rather than restating the
*what*, matching the HEL-849/HEL-850 comment standard. Types, error handling, security, dead code: nothing
new to flag. No drive-by changes.

## Phase 3: UI Review — N/A

Backend-only change; no UI trigger matched. No dev server started, per instruction.

## Overall: PASS

CR-1 is genuinely discharged for both kinds, the fix is pinned by an assertion that has been shown (by the
orchestrator's targeted mutation, whose reasoning I checked) to be non-vacuous, and the gates plus a freshly
recaptured red-on-revert are green against the final committed tests. The remaining items are all
non-blocking or delivery-phase.

## Non-blocking Suggestions

1. (carried over) `PipelineStepRoutesSpec.scala` test 4.2 (non-string map values) asserts only
   `msg should include("casts")`. Add the expected-shape assertion the other two rejection tests make, so
   the "object with a non-string value" branch of `requireStringMap` has its wording pinned too.
2. (carried over) `PipelineService.scala` `updateStep`: the `if (rawConfigError.isDefined) … else` is
   followed by an un-indented `PipelineStepConfigCodec.decode(...)` block, reading as if outside the `else`.
3. (carried over) `PipelineService.scala` `addStep`: `rawConfigError` is computed above the
   `PipelineStepKind.All` guard, so an unknown step type does a pointless registry lookup.
4. `RenameStep.scala:80` — `"from-field-name to to-field-name"` is accurate but awkward to read in a
   user-facing 422. `"existing field name to new field name"` reads better and keeps the property test 4.3
   depends on (no "type name"); it would require updating the 4.3 assertion string, and per standing
   requirement 1 the red-on-revert and the mutation evidence would both need recapture — so this is worth
   doing only if the wording is being touched anyway.
5. design.md Decision 3: amend "Concretely, for `cast`/`casts` (and identically `rename`/`renames`)" to say
   the *rule* is identical while the wording is per-kind, and note the shipped `rename` message. One line;
   keeps the design honest against the final code.
6. Delivery: `git add` the untracked `openspec/changes/reject-mistyped-step-config/mutation-evidence-cr1.md`
   before the squash, or it is lost — it is the only record that 4.3's negative assertion is bound.
7. Delivery (carried over): the PR body must carry task 5.1's exact sweep command and raw unabridged output
   plus the HEL-871 link — AC4 as corrected is only signable there.
