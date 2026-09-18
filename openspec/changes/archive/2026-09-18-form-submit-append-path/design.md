## Context

See proposal.md — Why. File:lines verified at Setup (`.concertino/runs/HEL-1087/evidence/premise-validation.md`,
no-drift) and re-verified by `skeptic-design-1/2/3.md`. `FormPanelView.tsx:4,82` renders a submit-prevented `<form>`,
no button, and already computes `computeFormIssues` per field (`:52-53`); `useFormPanelValues.ts` holds `{values,
touched, errors, setValue, touch, reset}`; `formFieldValidation.ts:11-15` treats blank/whitespace as empty;
`FormFieldControl.tsx:195-209` wires `aria-invalid`/`aria-describedby` from `error`, but its `file` (`:48-64`) and
`issue` (`:66-72`) branches render a `disabled readOnly` control with NO `error` prop. Row-append path:
`DataSourceService.appendRows:764` → `DataSourceRepository.appendRowsAction:576` (under `lockSource`, fresh
declaration, `DatasetRowValidator.validate`, insert, inferred-schema refresh), error shape a `"; "`-joined pinned
string; `validateRow:122-123` treats a cell as missing ONLY when `JsNull` and accepts any `JsString` for string types.
`DatasetSchemaMigration.scala:45-92` resolves fields by NAME and can reorder them. `FormSchemaConsistency.checkOptions`
rejects unusable `options` at write time — mounted panels see them only via type drift. `ErrorResponse(message)`
is what `extractErrorMessage.ts` reads; `DashboardAuthoringRoutes.scala:56-63` is the route-local-completion precedent
over `ServiceResponse.statusCodeFor`. `PanelRepository.findById(id, callerOpt):130` is sharing-aware; `findByIdOwned`
establishes write ownership. `check-schema-drift.mjs` errors on a schema `title` lacking a 1:1 `api/protocols/**` case
class; its only escape is its `SKIP` set.

## Goals / Non-Goals

**Goals:** one row per submit to the bound source, with the form's rules and the declared schema enforced server-side;
structured field errors; input never lost on rejection; every outcome announced and associated; proven red-first.
**Non-Goals:** see proposal.md — Non-goals. Design-level: no change to `POST/PUT .../rows`; no Redux state; no new
shared `Button` primitive; no edit to `scripts/check-schema-drift.mjs` (a `.husky/pre-commit` script — CON-132
gate-chain obligations, and the HEL-1083 owner ruling not to carve it out).

## Decisions

**D1 — A panel-scoped route composes the row-append path.** `POST /api/panels/:id/submit` in `PanelRoutes` (with
`duplicate`, `PanelIdSegment / "submit"`) → `PanelService.submitForm` → `DataSourceService.appendFormRow` →
`DataSourceRepository.appendBuiltRow`. The row-write path's lock, declared-schema validation, row-count bound,
inferred-schema refresh and audit are reused, not re-implemented. Rejected: the client calling `POST .../rows`
directly — the server would never see the form's tighten-only `required`/`select` options (the "convenience, not
enforcement" gap), the only error shape is a joined string to parse, and the client would choose the write target.

**D2 — Wire shape.** Request `{"values": {"<sourceField>": <typed JSON>}}`; the reader is hand-rolled and strict
(`FormPanelConfig.format.read` pattern): only `values`, an object — any other key (e.g. `dataSourceId`) is `400`.
Success `201 Created` with `RowWriteResponse` (`rows` holds exactly the appended row's `id/seq/updatedAt`), the same
DTO the row-append API returns. Validation failure `400` with `{"message": <joined summary>, "fieldErrors":
[{"field", "reason"}]}`, `reason` being one of D3's pinned reasons or the validator's `expected <type>, got <kind>`.
Empty `values` is valid (D3(v) yields `required` errors or an all-default row appends); others keep `ErrorResponse`.

**D3 — Build and validate the row under the source lock, from a pure builder.** New pure
`domain/panels/FormSubmission.buildRow(config, declaration, values): Either[Vector[FieldError], Vector[JsValue]]`,
rules per field in order, first match wins, collected across fields: (i) an unconfigured key → `not part of this form`;
(ii) a value for a `file` control → `file fields are not yet supported`; (iii) a configured field the declaration
lacks → `not declared by the bound dataset` when a value IS supplied for it or it is configured `required: true`
(this reason wins over `required`; the field is skipped by the rules below); an unsupplied undeclared OPTIONAL field
is ignored — nothing was entered, so nothing is dropped; (iv) for a configured field an empty/whitespace-only
`JsString` is NOT SUPPLIED (the client's `isEmptyValue` rule — the API never accepts what the browser blocks, never
stores a blank); (v) a configured field that is required (config `required: true` OR declared — the client's rule)
with no supplied value → `required`, with NO declared-default fill (the client blocks it, so the server must too); a
configured OPTIONAL field left unsupplied is `JsNull` and takes the declared default; (vi) a `select`: when `options`
is not a non-empty JSON array ANY supplied value → `options are not configured` (never skipped), else a value not
JSON-equal to an option → `not one of the configured options`; (vii) build the positional row in declared order
(`JsNull` for unsupplied and unconfigured fields, so unconfigured fields take the declared default or requirement);
(viii) validate with `DatasetRowValidator` against the EFFECTIVE declaration — configured required fields copied to
`required = true, default = None`. `DatasetRowValidator` gains a public structured single-row entry point
(`validateRowStructured`) that the private `validateRow` renders through — behaviour-preserving, pinned by the
existing message tests. `DataSourceRepository.appendBuiltRow(id, build: Vector[DatasetFieldDeclaration] =>
Either[Vector[FieldError], Vector[JsValue]], maxRows, updatedAt, user)` runs `build` on the declaration read under
`lockSource`, then inserts through `insertAppendedRowsAction`, extracted verbatim from `appendRowsAction` so
`applyWriteBacks` (HEL-1100) is byte-identical. A `Left` writes nothing. Rejected: mapping in the service before
`appendRows` — the reorder race.

**D4 — Authorization and audit.** `panelRepo.findById(id, Some(user))` (sharing-aware) → `404 Panel not found` when
invisible; a non-`form` panel → `400`; `panel.ownerId != user.id` → `403 "Only this form's owner can submit to its
data source"` (decidable from the panel alone; a grantee's insert could not succeed under their RLS context anyway,
and the panel owner is the source owner by HEL-1084's config-time ownership check); `dataSourceRepo.findByIdOwned`
None (source deleted, or unbound `DataSourceId("")`) → `404 Data source not found`, the row-write API's own message
(`DataSourceService.appendRows:769`). Audit `data_source.rows.append` with `{"panelId"}` metadata.

**D5 — Structured error body via route-local completion.** `PanelService.submitForm` returns
`Future[Either[FormSubmitError, RowWriteResult]]` (`FormSubmitError(err: ServiceError, fieldErrors)`);
`PanelRoutes.completeSubmit` renders `FieldValidationErrorResponse(message, fieldErrors)` when `fieldErrors` is
non-empty, else `ErrorResponse(err.message)`, both via `statusCodeFor` (`DashboardAuthoringRoutes.scala:56-63`);
`message` is kept so `extractErrorMessage` and every existing client still work. JSON Schemas (2020-12,
`additionalProperties: false`, unregistered like HEL-1077's): `schemas/panels/form-submit-request.schema.json` titled
exactly `FormSubmitRequest`, and `schemas/shared/field-validation-error-response.schema.json` titled exactly
`FieldValidationErrorResponse` with `{field, reason}` as a `$defs` entry — never a third file (1:1 per title).

**D6 — Submit-time client validation against the declared schema.** New pure `state/formSubmission.ts`:
`validateForSubmit(config, schema, values)` runs `validateFieldValue` for every EDITABLE configured field; for any
non-empty string-valued control whose declared type is not `string`/`string-body`, a typed-parse check via
`parseTypedValue`/`isValidTypedValue` (integer "must be a whole number", float "must be a number", timestamp "must be
a valid date"); for an EDITABLE `select`, a non-empty value matching no configured option → "<label> must be one of
the configured options" — never dropped (C3; reachable after an options edit while mounted). Non-editable fields —
a `file` control, or ANY field for which `computeFormIssues` returns an issue (orphaned, unfit, unusable options,
duplicate, bad step/initialValue, type drift, …) — are never validated per field nor sent: one optional AND holding no
value is skipped (the server ignores it, D3); one that is required (`isFieldRequired`; for an undeclared field
`field.required === true` alone) or that HOLDS a non-empty value (a stale entry or a prefill the renderer can no
longer show as sendable) blocks the submit up front with a form-level, announced summary naming the field and why
("<label> is required but file upload is not yet available" / "<label> holds a value that cannot be sent: <issue>"),
no request sent, focus per D8 — C3 without an association the `issue` branch cannot render. Such a
panel is not submittable until the config or dataset is fixed (a declared-required `binary-ref` column: not until
HEL-1086; recorded). HEL-1085 D5's blur-time rule is unchanged.
`buildSubmitValues(config, schema, values)` emits typed JSON: `select` resolves the typed option by its `String` key
(first match wins), `checkbox` sends the boolean, empty/whitespace strings are omitted, `file`/issue fields are never
sent. `mapServerFieldErrors(config, fieldErrors)` maps a `reason` to the same label-aware wording (`required` →
"<label> is required", type mismatches → the D6 messages, otherwise "<label>: <reason>"). The `<form>` gets
`noValidate` so native constraint bubbles never pre-empt the associated, announced errors. Recorded asymmetry: the
client's timestamp check (`Date.parse`) is looser than the server's `looksLikeTimestamp` — the safe direction.

**D7 — State stays in the per-instance hook.** `useFormPanelValues` gains `markAllTouched()`, `setExternalErrors(map)`
and gives an external (server) error precedence over the client rule for that field until `setValue` clears it;
`seedValueFor` leaves a `file` control empty regardless of `initialValue` (no typed entry point for `binary-ref`).
`FormRenderer` passes `panel.id`; `FormPanelView` owns `submitState` (`idle|pending|succeeded|failed`) and the text.

**D8 — Announce, associate, focus; never clear on rejection.** Two ALWAYS-mounted regions below the fields: `<p
role="alert">` (failures) and `<p role="status">` (success) — a region that exists before the async outcome is what
makes a later text change announced; both are emptied at the start of every attempt. On any rejection (client-side,
`400` field errors, transport) input is untouched; `reset()` runs only on success and only when `resetOnSuccess !==
false` (repeated entry is the primary use). Field errors use the existing `aria-invalid`/`aria-describedby` wiring.
Focus on rejection — client-side and server-side alike: the first `[aria-invalid="true"]` control in the form (DOM
query) when one exists; otherwise (every error names an unrendered or non-editable field, or the failure is
transport/non-field) focus stays on the submit button and the alert summary names each such field. Success keeps
focus on the button and announces via the status region. Rejected: mounting a `role="alert"` node on error (presence
≠ announcement — the HEL-1084 finding); a toast (DESIGN.md §7).

**D9 — Button and pending state.** `<button type="submit" class="form-panel-view__submit">` labelled
`config.submit.label ?? "Submit"`, Primary recipe metrics per DESIGN.md §5 (`--app-accent`, `--app-accent-ink`,
`--app-accent-strong`, `--control-sm`, `--app-radius-sm`, tokens only), disabled with label "Submitting…" while pending.
Enter in a single-line control submits; `Textarea`/`Select`/`Toggle` keep their own Enter; both themes compared (C6).

**D10 — Evidence, red first (C7/C8).** `mutation-evidence.md` records command + red + green for: (a) preserved
input — Jest: `400` field-error and network-error mocks leave every control's value intact; mutation `reset()` in the
rejection branch → red; (b) no write on rejection — ScalaTest: form-required omitted AND whitespace-only → `400`,
repository row count unchanged; mutation: skip D3(v) → red; (c) a body carrying `dataSourceId` → `400`; (d)
client-bypass payloads (whitespace-only form-required, `select` outside `options`, string for an integer) → `400` +
`fieldErrors` + count unchanged. Playwright `e2e/hel1087-form-submit-path.spec.ts` (tasks.md 3.8 lists every leg):
alert region present and empty before submit; after a UI server rejection its computed role is `alert` with the
summary as text, the first invalid control `toBeFocused()`, values preserved; `page.route` abort → announced,
preserved; success → +1 row on the bound source, +0 on a second; API-bypass leg → `400` + count unchanged.

**D11 — Untouched, deliberately.** `PanelPacker`, `PanelContent`/`PanelDetailModal` dispatch, `PanelRowMapper`/
`configColumnsOf` (no sizing, kind or model change), helio-mcp, `check-schema-drift.mjs` (Non-Goals).

## Risks / Trade-offs

- [Declared schema reordered between read and write] → the row is built from the declaration read under the lock.

## Migration Plan
No migration, no schema column, additive endpoint. Deploy with the PR; rollback is a revert.
## Planner Notes

Self-approved: the panel-scoped endpoint as the reading of "wire submit to the row-append API" — the route composes
the row-append service rather than the browser calling it (D1); `resetOnSuccess` absent → reset (D8); `403` for a
visible non-owner and `404` for a deleted/unbound source (D4); blank-means-not-supplied and
required-without-default-fill for configured fields, and the unsupplied-optional-orphan rule (D3); submit-time
typed-parse and option-membership checks and the non-editable-field rule (D6); schemas added unregistered (D5).
