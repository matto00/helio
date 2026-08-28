# Mutation evidence — CR-1's negative assertion is not vacuous

Captured by the orchestrator, 2026-08-28, on commit `a97431e4`.

## Why this was needed

CR-1's fix is guarded by test 4.3, whose load-bearing half is a **negative** assertion: the `rename`
rejection message must NOT describe a type mapping. Negative assertions can pass vacuously. The executor's
red-on-revert exercised a *source revert* (removing the validator entirely), which is not the same mutation
as "the validator exists but emits cast's wording" — precisely the bug CR-1 was about.

## The mutation

`backend/src/main/scala/com/helio/domain/steps/RenameStep.scala` — reintroduce the pre-fix wording only:

```scala
shapeDescription = "field name to type name",
example          = "{\"renames\": {\"amount\": \"double\"}}"
```

Everything else (the validator, the 422 path, all other tests) left intact.

## Result — the test dies

```
sbt 'testOnly com.helio.api.routes.pipelines.PipelineStepRoutesSpec'

- should POST /pipelines/:id/steps returns 422 for a list-shaped renames config and creates no step (4.3) *** FAILED ***
  "Invalid 'rename' config: 'renames' must be an object mapping field name to type name,
   e.g. {"renames": {"amount": "double"}} — got an array."
   did not include substring "from-field-name to to-field-name" (PipelineStepRoutesSpec.scala:968)

Tests: succeeded 54, failed 1
```

Exactly one test fails, and it is 4.3, failing on the reintroduced cast wording. The other 54 stay green —
so the assertion is bound specifically to the defect CR-1 identified, not to incidental message text.

`RenameStep.scala` restored immediately afterwards; `git status` clean, tree identical to `a97431e4`.
