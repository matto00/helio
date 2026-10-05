# HEL-1147: Previewing an upsertsource step with an empty target.name throws instead of failing validation

## Description

Found in **production** logs on 2026-09-16 while verifying the v0.8.2 release. Not caused by that release — the errors predate the probe that found them.

**Observed:** `POST /api/pipelines/:id/steps/:stepId/preview` failed twice for pipeline `4b9629f1-71c7-4907-8eca-abbf1935b1e4`, step `01dfc0d9-5e9c-477a-8bfe-b59ea726b515`, with:

```
com.helio.domain.engine.StepExecutionException: Pipeline execution failed at step 01dfc0d9 (upsertsource)
  [path: root:e033343a > aed9e1f9 > 01dfc0d9]:
  'upsertsource' step requires a non-empty 'target.name' for a new source
Caused by: java.lang.IllegalArgumentException (InProcessPipelineEngine.scala:266)
```

**The step is not persisted.** `GET /api/pipelines/4b9629f1.../steps` returns exactly one step (`select`, `aed9e1f9`) and no `upsertsource`, so `01dfc0d9` was a draft or since-deleted step being previewed mid-configuration. `GET /api/pipeline-steps/:id` is not a route (405: PATCH/DELETE only), so the step's saved config could not be read directly.

**Why it is worth fixing:** previewing a half-configured new-source write-back is a normal thing for a user to do — the target name is exactly the field they have not typed yet. Today that surfaces as an `IllegalArgumentException` through the engine's generic `StepExecutionException` path, logged at ERROR with a full stack trace, rather than as a named validation result the editor can show inline. It also adds noise that masks real engine failures in prod logs.

**Suggested fix:** treat an empty/absent `target.name` for `kind: "newSource"` as a named validation failure at the preview boundary (the same class of check `UpsertSourceConfig`'s write-path validation already applies), and have the step card surface it inline. Decide deliberately whether preview should be refused outright or return an empty preview with the reason attached.

## Acceptance Criteria

- Previewing an `upsertsource` step whose `target.name` is empty or absent returns a named, non-500 result the editor renders inline.
- No stack trace is logged at ERROR for it.
- A failable test covers both the empty-string and absent-field cases (remember spray-json omits absent fields rather than nulling them).

## Driver scope instructions (2026-10-04)

- Verify the premise with a real repro (route, status code, stack); widen it: other upsert target fields, both newSource and existingSource target variants, analyze / dry-run / apply paths, MCP add_pipeline_step / analyze_pipeline_proposal; whether the same unvalidated-config class throws for other ops' required fields.
- Fix the class at the validation seam if it is shared, not just one field. If that seam is broad, escalate the scope before widening.
- Out of scope: HEL-1256 (PatchSetUndoService silent-null, v0.9); HEL-1233 layout areas; HEL-1178 chart theming. Migration slot V118 if needed.
