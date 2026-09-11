## Context

`dataset_schema` (V106, HEL-1074) is a nullable `jsonb` column on `data_sources`, currently
serialized as `Vector[SchemaField]` (`SchemaField(name, type)` — `PipelineAnalyzeService.scala:31`).
`DataFieldType` (`domain/model/model.scala`) already defines the canonical 7-value set and a
`canonicalize`-style normalization for non-canonical synonyms (`"double"` -> `float`, etc.) used
elsewhere; this design reuses it rather than adding a second type enum.

`dataset_rows.data` stores each row as a positional `JsArray`, aligned to `dataset_schema`'s column
order (design.md Decision 3 of HEL-1074). Two repository methods currently write both together in
one transaction: `insertDatasetSource` (create) and `replaceDatasetRows` (refresh/replace) in
`DataSourceRepository.scala`. Both are called from `DataSourceService` (create-dataset and
refresh-dataset flows). See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- Model `required`/`default` alongside `name`/`type` for a dataset's declared schema, backward
  compatible with the `Vector[SchemaField]` shape V106 already backfilled (`required: false`,
  `default: None` for every pre-existing row).
- One validator, callable from both existing writers today and from HEL-1077's row write API later,
  enforcing: reject on type mismatch (no coercion), reject on missing required field with no
  default, fill missing field from `default` when present.
- Normalize the wire boundary so an absent `required`/`default` key (spray-json drops `None`) never
  reads back as a false rejection.

**Non-Goals:**
- The row write API surface itself (HEL-1077).
- An endpoint to mutate an existing declaration once rows exist — no product decision exists for
  this in the v0.8 design spec; not built here.
- Coercion of any kind — a mismatch is always a hard reject.

## Decisions

1. **New `DatasetFieldDeclaration(name: String, fieldType: DataFieldType, required: Boolean,
   default: Option[JsValue])` replaces `Vector[SchemaField]` as `dataset_schema`'s Scala-side
   shape**, in `DataSource.scala` alongside the ADT. Alternative considered: extend `SchemaField`
   itself with optional `required`/`default` — rejected because `SchemaField` is shared by
   `inferred_schema`, `outputs.schema`, and pipeline analysis, none of which have a required/default
   concept; overloading it would force every other call site to reason about fields that never
   apply to it.
2. **JSON codec**: a dedicated `JsonProtocols` formatter for `DatasetFieldDeclaration` that treats
   `required` as defaulting to `false` and `default` as defaulting to `None` when absent on read —
   the same absent-vs-null normalization pattern already used elsewhere in this codebase for
   spray-json's `Option=None` omission. `fieldType` is read/written through the real
   `DataFieldType` helpers: `validateAndCanonicalize` (canonicalizes a known legacy synonym via
   `canonicalizeLegacy`, e.g. `"double"`->`"float"`, then validates against `fromString`, `Left` on
   an unrecognized type) on write, `asString` on read. A `dataset_schema` row whose stored `type`
   string somehow fails `fromString` on read (should be unreachable once write-time
   `validateAndCanonicalize` is in place, but guards a hand-edited/pre-existing-bad row) is treated
   as `StringType` with a logged warning — never a hard read-path crash.
3. **Validator as a plain function, not a service.** `DatasetRowValidator.validate(declaration:
   Vector[DatasetFieldDeclaration], row: Vector[JsValue]): Either[Vector[FieldError], Vector[JsValue]]`
   — pure, no I/O, easy to unit-test exhaustively and to call from both today's repository-adjacent
   writers and HEL-1077's future route handler without a service-locator dependency. Returns the
   (possibly default-filled) row on success so callers persist the filled row, not the original.

   **Per-type value acceptance** (resolves skeptic-design-1.md item 1), positional row value `v` at
   field `f`:
   - `f.fieldType = StringType`: `v` is a `JsString`.
   - `f.fieldType = IntegerType`: `v` is a `JsNumber(n)` where `n.scale <= 0 ||
     n.remainder(BigDecimal(1)) == BigDecimal(0)` (an integral value) — a `JsNumber(1.5)` is
     rejected, a `JsNumber(3)` or `JsNumber(3.0)` passes. Mirrors
     `SchemaInferenceEngine.inferJsonType`'s existing integral check, applied here as a validation
     gate rather than an inference decision.
   - `f.fieldType = FloatType`: `v` is any `JsNumber` (integral or not) — a whole-number value
     counts as a valid float (this is the "does `3` count as a float" question: yes).
   - `f.fieldType = BooleanType`: `v` is a `JsBoolean`.
   - `f.fieldType = TimestampType`: `v` is a `JsString(s)` where `s` parses under one of the same
     four formats `SchemaInferenceEngine.isTimestamp` already accepts (`ISO_DATE_TIME`,
     `ISO_LOCAL_DATE_TIME`, `ISO_LOCAL_DATE`, `MM/dd/yyyy`). That parsing logic is extracted to a
     shared `TimestampParsing.looksLikeTimestamp(s: String): Boolean` helper in `domain.engine` so
     `SchemaInferenceEngine` and `DatasetRowValidator` share one definition rather than duplicating
     four `DateTimeFormatter` patterns. A bare date string like `"2026-01-01"` passes (matches the
     shipped `DataSourceServiceSpec` fixture at line ~296).
   - `f.fieldType = StringBodyType`: `v` is a `JsString` (same wire shape as `StringType`; the
     distinction from `StringType` is presentation/size convention, not wire validation — matches
     `DataFieldType`'s existing scaladoc that content types "carry a plain JSON string").
   - `f.fieldType = BinaryRefType`: `v` is a `JsObject` (any shape). **Scoped narrowly**: no
     `dataset` writer callable today (`createStatic`/`applyStaticRefresh`, and by extension every
     caller of them) ever constructs a binary-ref cell — the form panel's file field that will
     populate one is HEL-1077/epic-2 scope, not yet built. Validating only "is it an object" avoids
     inventing a `BinaryRef`-shaped contract ahead of the feature that defines it; HEL-1077
     tightens this check when the file field lands.

   **"Missing" (resolves item 2):** a position is "missing" when either (a) the row is shorter than
   the declaration (no value at that index), or (b) the value at that index is `JsNull`. A missing
   *required* field with no `default` is rejected (AC's "missing required field" scenario). A
   missing field (required-with-default, or optional) is filled from `default` when present, else
   left absent (encoded as `JsNull` in the persisted positional row, so `dataset_rows.data` stays a
   fixed-width array aligned to the declaration). A row **longer** than the declaration (extra
   trailing cells) is rejected with a row-level error naming the declared field count and the
   actual cell count — never silently truncated. This matches the frontend today: `StaticSourceForm`
   already sends `null` for an empty numeric-cell input, so an unfilled optional field or a
   default-backed required field round-trips correctly under this rule with no frontend change.
4. **Validation happens in `DataSourceService`, before the repository call**, not inside
   `DataSourceRepository`. The repository's job stays "persist what it's given"; validation is
   business logic. `DataSourceService.createStatic` and `applyStaticRefresh` — the only two
   call-in points for every current writer (the `POST /api/data-sources` static/dataset route,
   `PatchSetApplyForward` (proposal-apply/MCP), `PipelineProposalService.resolveSource`, and
   `PipelineService`'s inline-source resolution all bottom out in `createStatic`; `applyStaticRefresh`
   is refresh's single choke point) — call the validator over every row before calling
   `insertDatasetSource`/`replaceDatasetRows`; the whole write is rejected (service returns a `Left`,
   no repository call made) if any row fails.
5. **Positional alignment preserved.** The validator receives a row as `Vector[JsValue]` positionally
   aligned to the declaration vector — matching `dataset_rows.data`'s existing storage shape — not
   an object keyed by field name. This matches HEL-1074's existing "positional, not object-keyed"
   decision and avoids a second row representation.
6. **`required`/`default` reach the declaration through the wire request** (resolves item 3):
   `StaticColumnPayload(name: String, type: String)` gains `required: Option[Boolean] = None` and
   `default: Option[JsValue] = None` (absent-defaults to `false`/`None`, per Decision 2's
   normalization). This is the only way the AC's "missing required field is rejected" scenario is
   exercisable through a real `POST`, not only through a direct unit test of the validator —
   `schemas/`, the OpenAPI spec under `openspec/`, and the frontend `StaticColumnPayload`/
   `StaticSourceForm` TypeScript types are updated in this same change (CLAUDE.md: schema + client +
   server together). The frontend form itself is NOT required to grow required/default UI in this
   ticket (that's form-panel UX, epic 2) — the wire fields exist and are validated so a caller that
   sets them (MCP, a future UI) is honored; the existing form simply never sends them, which
   defaults every field to not-required, matching today's behavior exactly. `default`'s JSON shape
   is validated against its own field's declared type using the same acceptance rules as Decision 3
   at declaration time — a `default` that wouldn't itself pass validation is rejected when the
   schema is declared, not deferred to first write.
7. **`createStatic`/`applyStaticRefresh` become strict for declared-type mismatches** (resolves
   item 4). This is a deliberate behavior change on top of HEL-893, which made `inferred_schema`
   derive from materialized runtime types rather than the declared type — HEL-893 did **not** touch
   whether a write is accepted, only what type gets *recorded* for already-accepted data.
   `DatasetRowValidator` gates acceptance (new); `inferred_schema`'s HEL-893 derivation is unchanged
   and still runs on the (now validated) rows.
   - Every existing test whose fixture rows would fail under Decision 3's rules is inventoried and
     fixed at execution time — `DataSourceServiceSpec.scala`'s HEL-893-pinning tests (~line 276-336)
     are re-verified row-by-row against Decision 3 above (the "double"/"long"/"date" fixture already
     passes: `1.5`/`3`/`"2026-01-01"` are float/integer/timestamp-valid); any fixture that turns out
     to encode a genuinely invalid value is corrected to a valid one with a comment explaining why,
     never loosened by weakening the validator to accommodate it.
   - **Error shape (resolves skeptic-design-2.md's one remaining item): `ServiceError.BadRequest`,
     not a new envelope.** `ServiceError` is a deliberately closed, HTTP-agnostic set
     (`ServiceError.scala`'s own scaladoc), and every 400 today maps to `ErrorResponse(message:
     String)` (`ResourceProtocol.scala`) — adding a structured `{rowIndex, field, message}[]`
     variant would require updating every existing `ServiceError` match site (including the
     agent-authored inline-source callers) to avoid a validation failure there silently falling
     through to a 500. Instead, `DatasetRowValidator`'s `Vector[FieldError]` is joined into ONE
     `ServiceError.BadRequest(message)` string with a fixed, pinned format:
     - Field-level: `"row <rowIndex>: field '<name>' — <reason>"` (e.g. `"row 0: field 'age' —
       expected integer, got string"`, `"row 2: field 'age' is required"`).
     - Row-level (too many cells): `"row <rowIndex>: expected <N> fields, got <M>"`.
     - Multiple failures across a write join with `"; "` into one message, in row-then-field order.
     No new `ServiceError` variant, no new response envelope — `DataSourceRoutes.scala`'s existing
     `ServiceResponse` mapping for `BadRequest` already produces the `400` + `ErrorResponse(message)`
     this needs. specs/dataset-schema-validation/spec.md pins this exact format so it isn't
     reinvented at execution time.
   - `StaticSourceForm.tsx`'s `handleSubmit` mapping (`integer`->`parseInt`, `float`->`parseFloat`,
     `boolean`->literal `"true"` string check, else raw string) is confirmed to always produce a
     value that passes Decision 3 for every type the form's column-type selector actually offers
     (today: string/integer/float/boolean, not the full canonical 7 — timestamp/string-body/
     binary-ref aren't declarable through this form yet, unaffected by this ticket), since `NaN` from a
     failed `parseInt`/`parseFloat` is not itself a valid `JsNumber` reject path — verified/fixed at
     execution time as part of task 3.1, not assumed here.
   - The proposal's "no existing spec requirement changes" claim is checked by re-reading
     `dataset-row-storage`/`static-data-connector`'s existing requirement text at execution time; if
     either capability's requirements textually describe accepting a type-mismatched row today, that
     requirement needs a delta, not a silent proposal-vs-reality gap.
8. **Refresh needs no declaration-mutation-with-existing-rows story for this ticket.** `applyStaticRefresh`
   replaces the whole declaration and the whole row set in one transaction (Decision 4); an incoming
   refresh's rows are validated against the *new* declaration being written, not the old one. There
   is no window where old rows are checked against a new declaration, so the "editing the
   declaration when rows exist" question the proposal deferred does not arise on this code path —
   it only arises for a future in-place "edit declaration, keep rows" endpoint, which does not exist
   yet and is out of scope (proposal.md Non-goals).

## Risks / Trade-offs

- **Positional alignment is easy to get wrong under a future partial-update API** (HEL-1077 patch
  semantics) → mitigated by keeping the validator pure and requiring the caller to always assemble
  a full positional row (defaults filled) before calling it; HEL-1077 designs its own patch-merge
  step in front of this validator, not inside it.
- **Migrating existing `dataset_schema` rows' shape** (old `{name,type}` JSON now read as
  `DatasetFieldDeclaration`) → no migration needed: the new codec reads `required`/`default` as
  absent-defaults, so existing rows deserialize unchanged with `required: false, default: None`.
- **`createStatic`/`applyStaticRefresh` becoming strict is a behavior change for any existing caller
  relying on lenient acceptance** → mitigated by Decision 7's test inventory; any real regression
  found there is reported to the orchestrator as a change-request item, not silently patched around.
- **`binary-ref`'s narrow "any JsObject" check** (Decision 3) is intentionally weak → tracked
  explicitly here so HEL-1077/the form-panel epic doesn't rediscover the gap; not a silent omission.

## Planner Notes

- Self-approved: no new capability beyond `dataset-schema-validation`; `dataset-row-storage` and
  `static-data-connector` specs are unmodified (no requirement-level behavior change to either) —
  re-verified at execution time per Decision 7's last bullet.
- Self-approved: validator lives at `domain` layer (pure), not `services`, per existing
  domain/services split in this codebase (e.g. `SchemaInferenceEngine` is domain, pure).
- Self-approved: extracting `isTimestamp` into a shared `TimestampParsing` helper (Decision 3) is a
  behavior-preserving refactor of `SchemaInferenceEngine`'s existing private method, not a new
  timestamp-parsing policy.
