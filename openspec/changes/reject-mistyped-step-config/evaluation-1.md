# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `05b97fdd` (branch `bug/reject-mistyped-step-config/HEL-860`).
Backend-only change; Phase 3 (UI) is N/A by instruction and by trigger (no `frontend/**`,
no `ApiRoutes.scala`, no `schemas/**` change).

All findings below were derived by my own measurement in this worktree, not from the
executor's report.

## Phase 1: Spec Review — PASS (with one delivery-phase obligation)

AC-by-AC trace to the test that actually exercises the behaviour:

| AC | Signed by | Verdict |
|---|---|---|
| AC1 list-shaped `casts` → 422, no step | `PipelineStepRoutesSpec` "…422 for a list-shaped casts config and creates no step (4.1)" — route-level `Post ~> routes`, asserts 422 + message + re-lists steps and asserts empty | PASS |
| AC2 `rename` analogous rejection | same spec, "(4.3)" — 422, message names `renames`, re-list empty | PASS |
| AC3 correct config unchanged / no migration regression | "(4.4)" (201, stored mapping retained, `{}` still accepted) + "(AC3, 4.6)" (raw `sqlu`-seeded legacy list-shaped row still decodes to `Map.empty` through `GET /pipelines/:id/steps`). Independently verified: `git diff main...HEAD` removes **zero** lines from `CastStep.scala`/`RenameStep.scala`, so both `decode` bodies are byte-for-byte unchanged | PASS |
| AC4 (corrected) sweep by enumeration + classification + known-remaining + follow-up | design Decision 6 classifies all 23 decoders; I re-verified the enumeration myself: `domain/steps/` holds 24 `.scala` files, `grep -l "def decode(raw"` returns exactly 23. Follow-up filed as **HEL-871** (tasks.md 5.1a, uncommitted) | PASS with obligation — see below |
| AC5 rejection tests assert the message names the expected shape | 4.1 and 4.3 assert both the key and `"object mapping field name to type name"`; 4.2 asserts only the key | PASS (see CR-1, and suggestion 1) |
| AC6 HEL-859's 5 validators + multi-failure join at the real analyze surface | `PipelineAnalyzeRoutesSpec` — five new `GET /pipelines/:id/analyze` tests (`aggregate`, `groupby`, `pivot`, `union`, `join`), each asserting the offending value **and** the "Unsupported …" supported-list text; plus the two-failure `window` test. I confirmed that test genuinely exercises `validateStepConfig`'s join at `PipelineAnalyzeService.scala:126`: `validateWindow` (lines 144-159) returns *two* elements (`requires 'field'`, `requires a positive 'offset'`) for `function="lag", field=None, offset=-1`, and the test asserts both plus `";"` | PASS |
| AC7 raw-config contract on the proposal surface | `PipelineAnalyzeProposalRoutesSpec` "(AC7)" — pre-asserts `CastConfig.decode(...).casts shouldBe empty` (binds the premise) then asserts the proposal-analyze response's `validationError` is defined and non-empty. Bound to `POST /pipelines/analyze-proposal` as design Decision 5 requires; **not** to `validateStepConfig` | PASS |

Task 2.1a specifically (the round-3 vacuity trap) — **not vacuous, verified line by line**:
the negative seeds with a raw `sqlu INSERT INTO pipeline_steps ... '{"casts":[{"field":"amount","to":"double"}]}'`,
then reads the row back with `sql"SELECT config FROM pipeline_steps WHERE id = $stepId"` and asserts
`storedConfig shouldBe mistypedConfig` **before** asserting `step.validationError shouldBe None`.
That is exactly the mandated pre-assertion; the typed-repository shortcut (which would have stored
`{"casts":{}}`) is not used, and an inline comment records why.

Scope: no changes outside the five declared main files and three test specs. No spec-delta drift —
both deltas match the shipped behaviour, including the deliberate "the stored-pipeline surface cannot
report such a key" scenario, which the 2.1a test actually asserts. Tasks are all marked done and match
what is implemented.

**Delivery-phase obligation (not a code defect):** AC4/task 5.1 requires the sweep's *exact command and
raw unabridged output* to be recorded **in the PR**. design.md Decision 6 holds the classification table,
but no artifact in the change dir holds the raw output. The PR body must carry it, together with the
HEL-871 link. Also: `openspec/changes/reject-mistyped-step-config/tasks.md` currently has an
**uncommitted** edit (5.1a → HEL-871); it must be committed before squash/PR or the follow-up id is lost.

## Phase 2: Code Review — FAIL

### Gates (my own fresh runs, in `WORKTREE_PATH`; `CLEAN_WORKTREE` not set)

- `cd backend && sbt -batch test` → `Tests: succeeded 3686, failed 0, canceled 0, ignored 0, pending 0`,
  `All tests passed.`, exit 0. Independently matches the executor's claim.
- `npm run check:scala-quality` → `Scala code-quality check: clean (140 soft warning(s))`; none of the
  warnings are in files this change touches.
- No `frontend/**` files changed, so the frontend gates are not triggered.

### Red-on-revert — independently reproduced against the FINAL COMMITTED tests

`git checkout main --` on exactly the five main sources (`PipelineStep.scala`, `CastStep.scala`,
`RenameStep.scala`, `StepCodecUtil.scala`, `PipelineService.scala`), tests left at `HEAD`, then
`sbt testOnly PipelineStepRoutesSpec PipelineAnalyzeRoutesSpec PipelineAnalyzeProposalRoutesSpec`:

```
- should POST /pipelines/:id/steps returns 422 for a list-shaped casts config and creates no step (4.1) *** FAILED ***
- should POST /pipelines/:id/steps returns 422 for a casts object with non-string values and creates no step (4.2) *** FAILED ***
- should POST /pipelines/:id/steps returns 422 for a list-shaped renames config and creates no step (4.3) *** FAILED ***
- should PATCH /pipeline-steps/:id returns 422 for a mistyped config and leaves the stored config unchanged (4.5) *** FAILED ***
Tests: succeeded 86, failed 4
```

Exactly the four rejection tests go red; every other test in those three specs — including all of
task 1's analyze coverage, task 2.1's AC7 test and task 2.1a's negative — stays green. The evidence is
not stale: it was captured against the committed test files, which I did not modify. Working tree
restored to `HEAD` afterwards (`git checkout HEAD -- backend/src/main`).

### Standing requirement 3 — the 422 reaches the HTTP surface

Satisfied, verified at the route, not at the function: all four rejection tests drive
`Post/Patch(...) ~> routes ~> check`, assert `status shouldBe StatusCodes.UnprocessableEntity`, and read
the body as `responseAs[ErrorResponse].message`. I traced the path independently:
`ServiceError.UnprocessableEntity` → `ServiceResponse` → `StatusCodes.UnprocessableEntity` with the
uniform `ErrorResponse(message)` body. Nothing here asserts merely that a function returned a `Left`.

### Standing requirement 2 — prose audited against the final code

Every "unchanged / preserved / already handled" claim I could check held, with one wording defect:

- "read path byte-for-byte unchanged" — **true** (zero deleted lines in the two step files).
- "the `PipelineStepKind.All` unknown-type check stays first, 400 unchanged" — **true**; note the
  `rawConfigError` val is *computed* above the guard, but the `if/else if/else` order preserves the 400
  branch, and `companionFor` on an unknown kind returns `Left(...)` → `.toOption` → `None`, so no throw.
- "a non-object top-level config cannot throw out of `validateRawConfig` and become a 500" — **true**:
  `StepCodecUtil.asObject` returns `JsObject.empty` for a non-object top level, and both call sites pass
  the `compactPrint` of an already-parsed `JsValue`, so `JsonParser` cannot throw there either.
- "no existing status code changes" — **true**; the decode-`Failure` 400 branch is untouched.
- Decision 5's two-surface claim — **true**, and now asserted in both directions by tests.
- Decision 6's "23 decoders" — **true** by my own enumeration.
- The rename rejection message's claim about the expected shape — **false**; see CR-1.

### Code quality

DRY (one shared `requireStringMap`, both kinds call it), modular (opt-in `Companion` seam rather than
per-step knowledge in `PipelineService`), typed throughout, no dead code, no `TODO`/`FIXME`, no
over-engineering, no drive-by behaviour change. Comments follow the HEL-849/HEL-850 standard.

### Blocking finding

**CR-1 — the `rename` 422 message states a mapping semantics that is factually wrong, and would lead an
agent caller to construct a silently-wrong rename step.**
`backend/src/main/scala/com/helio/domain/steps/StepCodecUtil.scala:47-56` hardcodes one description and one
example for both kinds:

```
'renames' must be an object mapping field name to type name, e.g. {"renames": {"amount": "double"}} — got an array.
```

`RenameConfig.renames` is a **from → to field-name** map (`RenameStep.scala:29-31`: "applies a `from → to`
map to every row"). An agent that follows this message literally sends
`{"renames":{"amount":"double"}}`, which this change **accepts** — and the step then renames the column
`amount` to `double`. That is a well-formed config producing a wrong pipeline with no error: the exact
green-run/wrong-result failure shape the ticket opens with, now reachable *through the guidance text this
ticket shipped*. The shape half of the message is correct; the semantic half is not.

`backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepRoutesSpec.scala:962` currently pins the
wrong wording (`msg should include("object mapping field name to type name")` in the rename test), so it
must move with the fix.

## Phase 3: UI Review — N/A

Backend-only change; no UI trigger matched. No dev server was started, per the task instruction.

## Overall: FAIL

Everything that this ticket was hard to get right — the 2.1a non-vacuous seeding, the AC7 surface binding,
the read-path byte-identity, the route-level 422, the multi-failure join, the enumeration-derived sweep —
is correct and independently verified. The single blocker is a wrong sentence in the user-facing rejection
message for `rename`.

## Change Requests

1. In `backend/src/main/scala/com/helio/domain/steps/StepCodecUtil.scala:44-58`, make the description and
   example kind-appropriate instead of hardcoding the `cast` semantics for both callers. Suggested shape:
   give `requireStringMap` two extra parameters (e.g. `shapeDescription: String`, `example: String`) and
   pass, from `CastStep.scala:88`, `"an object mapping field name to type name"` /
   `{"casts": {"amount": "double"}}`, and from `RenameStep.scala:73`,
   `"an object mapping existing field name to new field name"` /
   `{"renames": {"amount": "total_amount"}}`. Keep the `— got an array/a string/…` suffix as is.
   Then update `PipelineStepRoutesSpec.scala:962` to assert the rename-specific wording (e.g.
   `include("existing field name to new field name")`) rather than the cast wording, and keep
   `PipelineStepRoutesSpec.scala:923` asserting the cast wording. Re-run `sbt test` and re-capture
   red-on-revert against the amended tests (standing requirement 1 — the current evidence becomes stale
   the moment those test lines change).

## Non-blocking Suggestions

1. `PipelineStepRoutesSpec.scala:936-940` (test 4.2, non-string map values) asserts only
   `msg should include("casts")`. AC5 asks the message to name the expected shape; add the same
   expected-shape assertion the other two rejection tests make, so the "object with a non-string value"
   branch of `requireStringMap` is pinned too — today only its key-naming half is.
2. `PipelineService.scala:639-645` (`updateStep`): the `if (rawConfigError.isDefined) … else` is followed by
   an un-indented `PipelineStepConfigCodec.decode(...)` block, which reads as if it were outside the `else`.
   Re-indent the `else` body (or use a `match`) to match `addStep`'s clearer structure.
3. `PipelineService.scala:461-465` (`addStep`): `rawConfigError` is computed before the
   `PipelineStepKind.All` guard, so an unknown step type does a pointless registry lookup. Moving the val
   into the `else if` (or making it a `def`) would match design Decision 2's stated ordering more literally.
4. Delivery: commit the pending `tasks.md` 5.1a edit, and put task 5.1's exact sweep command and raw
   unabridged output plus the HEL-871 link in the PR body — AC4 (as corrected) is only signable there.
