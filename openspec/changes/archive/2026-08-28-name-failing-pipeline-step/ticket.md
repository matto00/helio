# HEL-859: Pipeline run errors must name the failing step and its reason

## Description

From the Sleeper field report (`/home/matt/Development/fantasy/docs/helio-issues.md`, issue #5). This is the highest-leverage item in epic HEL-857 that is not itself a data-correctness bug: it is what made every *other* bug expensive to find.

The diagnostic information already exists and is being thrown away. `StringOpsStep` **does** validate its `operation` against the supported set (companion `apply`, `backend/src/main/scala/com/helio/domain/steps/StringOpsStep.scala` ~line 96), throwing `IllegalArgumentException` with a message naming the offending value *and* listing every supported operation. But it throws at **execution** time, and the run handler flattens the whole failure to:

```
HelioApiError (status 422): 422 unknown: Pipeline execution failed
```

No step id, no step type, no reason. On a 9-step pipeline this required bisecting by deleting steps one at a time. The reporter's own call was simply wrong — they passed `regexExtract`; the supported name is `extractRegex`. The existing validation would have told them exactly that. The message never reached them.

Note the constraint discovered during premise validation: the flattening at `PipelineRunService.scala:218` and `:374` was introduced deliberately by HEL-311 to stop raw exception tails leaking to clients. This ticket must reintroduce *curated* detail, not revert HEL-311.

## Scope

* Include the failing step's **id, type, and the underlying exception message** in the run error payload, for every step kind — not a `stringops` special case.
* Run step-config validation at **analyze** time as well as at runtime, so `analyze_pipeline` catches an unsupported `operation` before a run is ever attempted (`analyze_pipeline` currently reports `validationError: none` for a step that cannot possibly run).
* Audit the other step kinds for the same shape: validation logic that exists but only fires during execution.
* Do not leak internals — the message should be the curated `IllegalArgumentException` text, not a stack trace.

## Acceptance criteria

- [x] A run that fails inside a step returns an error naming the step id, the step type, and the reason; a test asserts all three are present.
- [x] `analyze_pipeline` reports a non-`none` `validationError` for a step with an unsupported `stringops` operation, before any run.
- [x] The specific repro — `stringops` with `operation: "regexExtract"` — surfaces a message naming `extractRegex` among the supported operations, at analyze time.
- [x] No stack traces or internal class names appear in the client-facing error.
- [x] Existing successful runs are unaffected; error-shape change is reflected in the schemas/openspec contract.
- [x] The curated error reaches the **MCP surface** as text a caller can read — verified end-to-end, not merely as a populated backend field.

## Sibling coordination

HEL-860 (reject mistyped step config instead of silently storing a no-op; affects `CastStep` and `RenameStep`) is the next leaf. That one is about failures *never reported at all*; this one is about failures *reported uselessly*. Do not implement 860's rejection logic here, but shape the analyze-time validation surface so 860 extends it rather than fights it, and state explicitly in `design.md` any decision that constrains 860.
