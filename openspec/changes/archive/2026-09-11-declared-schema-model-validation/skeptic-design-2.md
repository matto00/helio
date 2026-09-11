## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
Round-1 items checked against the codebase at HEAD 369add79:

1. **Per-type acceptance table: addressed.** Design Decision 3 and the spec requirement list all 7 types.
   The integer rule matches `SchemaInferenceEngine.inferJsonType:204` exactly
   (`n.scale <= 0 || n.remainder(BigDecimal(1)) == BigDecimal(0)`). The four timestamp formats match
   `isTimestamp:214-218` (ISO_DATE_TIME, ISO_LOCAL_DATE_TIME, ISO_LOCAL_DATE, MM/dd/yyyy). Spec scenarios
   now cover integer-vs-1.5, 3-for-float, and a bare date for timestamp. binary-ref is "any JsObject",
   deliberately weak and recorded under Risks.
2. **"Missing" semantics: addressed.** A cell counts as missing if its index is absent or it holds
   JsNull. Required with no default is rejected. A default fills the cell. An optional cell with no
   default persists as JsNull. Extra trailing cells are rejected at row level. Each case has a spec scenario.
3. **required/default on the wire: addressed.** Decision 6 extends `StaticColumnPayload` (today
   `DataSourceProtocol.scala:238`, which has only `name`/`type`) with `Option` fields, and tasks 3.1 and 4.1
   are now unconditional. A default is checked against its own type at declaration time (task 2.3 plus a spec scenario).
4. **Existing-caller impact: mostly addressed.** The callers are listed and the choke point is
   `createStatic`/`applyStaticRefresh`. I checked the HEL-893 fixture (`DataSourceServiceSpec.scala:286-296`):
   rows `1.5 / 3 / "2026-01-01"` against double/long/date (canonicalized to float/integer/timestamp). All
   three pass Decision 3, as the design says. The frontend form (`StaticSourceForm.tsx:9`) offers only
   string/integer/float/boolean. Its encoding at `:102-104` sends null for empty or NaN numeric cells,
   which Decision 3 treats as missing (optional, so accepted). The spec-delta verification is a task (4.4).
   **The error contract is still contradictory. See CR 1.**
5. **Failable probe: addressed.** Task 3.5 names both mutations: the type-check arm always passes, and
   the validator call is removed from each writer in turn. It asserts 400 plus zero `dataset_rows`.
6. **Helper names: addressed.** Decision 2 now cites `validateAndCanonicalize`, `canonicalizeLegacy`,
   `fromString` and `asString`, which match `model.scala:705,722,740`. It also states what happens on read
   when a stored type is unrecognized: StringType plus a warning.

### Verdict: REFUTE

One narrow contradiction remains in the error contract. It sets the wire shape that task 4.1 must write
into `schemas/` and OpenAPI, so it has to be settled before execution.

### Change Requests
1. **Resolve the 400 error-body contradiction (design.md Decision 7, bullet 2; proposal.md Impact; tasks
   3.2 and 4.1).** Decision 7 asks for a `400` whose body lists `{rowIndex, field, message}` per error. It
   also asks for "no new error-envelope shape invented" and says to follow the existing convention. Those
   two can't both hold. Every service error today is a single string: `ServiceError.BadRequest(message:
   String)` (`services/ServiceError.scala:19`), and the only 400 body is `ErrorResponse(message)`
   (`api/protocols/ResourceProtocol.scala:9`). A structured list of per-row, per-field errors therefore
   needs a new `ServiceError` variant (or a structured payload on one) and a new response case class. The
   proposal's Impact section already says "new 400 field-level error response shape", which contradicts
   the design. Pick one explicitly:
   - (a) A new `ServiceError` variant carrying `Vector[FieldError]`, rendered as a named response type
     (e.g. `{message, errors: [{rowIndex, field, message}]}` so `message` stays for existing clients).
     Specify the exact JSON shape. Also list every place that pattern-matches `ServiceError` and must map
     the new variant, including the agent/inline-source callers (`PipelineProposalService`,
     `PipelineService`, `PatchSetApplyForward`) so a validation failure there isn't mapped to 500.
   - (b) Keep `BadRequest(message)` and define the exact message format (row index plus field name).
     Drop the structured-body language from design, proposal and tasks 3.2/4.1.

   Either way, add one spec scenario that pins the chosen body shape. Also remove "executor confirms the
   exact existing pattern at implementation time". That wording defers the decision, which is what
   round-1 CR 4(b) asked to be settled.

### Non-blocking notes
- Task 1.2 still says "canonicalize/asString/fromString". Align it with Decision 2's real names.
- Decision 2 reads an unrecognized stored type as StringType and logs a warning instead of failing loud.
  That's defensible, but it is a silent fallback on the "authoritative" declaration. Consider fail-loud,
  or at least put the warning under a test.
- The frontend already truncates or drops some input before the backend sees it: `parseInt("1.5")`
  becomes `1`, a non-numeric entry becomes null, and an empty boolean cell becomes `false`. This is not
  the validator's job, but it undercuts the "never coerced" promise from the UI side. It's a candidate
  spinoff.
- Decision 7's third bullet talks about "all 7 declared types the form can select". The form offers only
  4 (`StaticSourceForm.tsx:9`). Correct the wording when revising.
