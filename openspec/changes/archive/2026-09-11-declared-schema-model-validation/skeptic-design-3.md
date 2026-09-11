## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)
- **Design is resolved.** design.md Decision 7 now picks option (b). Every failure maps to
  `ServiceError.BadRequest(message)` in a pinned format:
  - field-level: `row <i>: field '<name>' — <reason>`
  - missing-required: `... is required`
  - row-length: `row <i>: expected <N> fields, got <M>`
  - several errors: joined with `"; "`, ordered by row, then field.
  It explicitly rules out a new variant or envelope. The "executor confirms at implementation
  time" deferral is gone. This matches the codebase: `ServiceError.scala:19` has
  `BadRequest(message: String)` and `ResourceProtocol.scala:9` has `ErrorResponse(message: String)`.
- **Spec is resolved.** spec.md has a new requirement, "Validation failures produce a single pinned
  error message...", which carries the same three formats and a scenario pinning the exact string
  `"row 0: field 'age' is required"`.
- **Task 3.2 is resolved.** It now says `ServiceError.BadRequest` with the pinned format, and no new
  variant or envelope.
- **Task 1.2 is resolved.** Its helper names now match Decision 2 (`validateAndCanonicalize`,
  `asString`, `fromString`). The warning fallback is recorded in Decision 2 and task 1.2.
- **No regression in round-1/2 items.** I checked the per-type table, the "missing" semantics,
  the `StaticColumnPayload` wire fields, the failable probe (3.5), the RLS task (4.2) and the spec
  delta check (4.4). All are unchanged.
- **Residual contradiction, found by grep of the change dir:**
  - `proposal.md:48`: "`DataSourceRoutes.scala` — new `400` field-level error response shape for
    a rejected write."
  - `tasks.md:26` (task 4.1): "Update `schemas/` JSON Schemas + `openspec/` OpenAPI for ... and
    the new `400` error body shape".

  Both still say a new 400 body shape is being introduced. That directly contradicts Decision 7
  and the new spec requirement ("no new error response shape"). Round 2's CR 1 asked for this
  language to be dropped from design, proposal and tasks 3.2/4.1. Only design and 3.2 were fixed.

### Verdict: REFUTE

The fix is only wording, but task 4.1 tells the executor to write the error contract into
`schemas/` and OpenAPI. As worded, an implementer following it would invent the envelope that
Decision 7 forbids. That is exactly the ambiguity this gate exists to stop.

### Change Requests
1. **tasks.md task 4.1 (line 26):** replace "and the new `400` error body shape" with wording that
   matches Decision 7. For example: "the `400` response stays the existing `ErrorResponse{message}`.
   Document the pinned message format from design.md Decision 7 in the OpenAPI description if the
   route documents a 400. Add no new schema."
2. **proposal.md Impact (line 48):** replace "new `400` field-level error response shape" with:
   "rejected writes return the existing `400` `ErrorResponse(message)` via
   `ServiceError.BadRequest`, using the pinned message format (no new response shape)."

### Non-blocking notes
- design.md Decision 7, fourth bullet, still says "all 7 declared types the form can select". The
  form offers 4 (`StaticSourceForm.tsx:9`). Round 2 flagged this too; fix it while editing.
- The spec pins the exact string only for the missing-required case. The `<reason>` text for a
  type mismatch is shown only by example in design ("expected integer, got string"). Consider
  pinning it too, e.g. `expected <type>, got <json-kind>`, so tests assert one agreed string.
- Ordering of a row-length error against field errors within the same row is not specified.
  It is harmless, because a too-long row can short-circuit, but the executor should state which.
