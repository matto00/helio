## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)
- Re-read ticket.md, proposal.md, design.md, tasks.md, specs/dataset-schema-validation/spec.md in full.
- Round-3 CR1 (tasks.md 4.1): now reads "The `400` error body is the existing `ErrorResponse{message}` shape (design.md Decision 7) — no new schema/envelope for it." Resolved.
- Round-3 CR2 (proposal.md Impact): now says a rejected write returns the existing `ErrorResponse(message)` 400 via `ServiceError.BadRequest` with the pinned format, "no new error envelope." Resolved.
- Leftover sweep: `grep -i "structured|envelope|rowIndex|all 7|seven"` across all four artifacts. The only "structured" hit is design.md Decision 7 describing the rejected alternative. No leftover text says a new 400 shape is planned.
- Decision 7's form-types bullet now says string/integer/float/boolean. I checked this against `frontend/src/features/sources/ui/forms/StaticSourceForm.tsx:9` (`COLUMN_TYPES = ["string","integer","float","boolean"]`). It matches.
- The spec's row-length requirement now says the length check runs first for a row, before any per-field check. That agrees with design Decision 3 (a too-long row is rejected, never truncated) and with the "row-then-field" join order.
- `ServiceError.BadRequest(message: String)` exists, so Decision 7 relies on a real type.
- AC coverage: wrong-typed value is rejected (spec scenarios + tasks 2.2/2.5/3.2); missing required field is rejected (spec + 2.5 + 3.2); failable probe (task 3.5, with mutations on both the unit and integration arms). All three ACs are covered.
- No regressions: proposal, design, tasks and spec agree on the validator's signature, where it lives (domain layer, called in the service), the wire fields, the no-migration position, and the RLS task (4.2).

### Verdict: CONFIRM

### Non-blocking notes
- **Default-rejection message is outside the pinned formats (fix during execution).** The spec requirement "Validation failures produce a single pinned error message" says every rejected write's message is built from three formats, and all three start with `row <rowIndex>`. The declaration-time default rejection (spec's last requirement, task 2.3) has no row index, so none of the three formats fits it. When implementing task 2.3/3.2, the executor should add a fourth pinned format to that spec requirement, e.g. `"field '<name>' — default <reason>"`, and assert it in a test. An evaluator would otherwise see the SHALL being broken. Doing this in the spec delta during execution is enough and needs no new design round.
- The type-mismatch `<reason>` text is still pinned only by example ("expected integer, got string"). Pick one template (`expected <type>, got <json-kind>`) and assert it exactly.
