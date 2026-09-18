# Files modified — HEL-1087

Base SHA for this diff: `b1b954e364b1725787e28c0d86540c910c1fc460` (resolved live via
`scripts/concertino/resolve-review-base.sh`).

## Cycle 2 (evaluation-1.md CR1/CR2 + non-blocking note)

- `frontend/src/features/panels/ui/form/FormPanelView.tsx` — CR1: the leading
  `setAlertText("")`/`setStatusText("")` clear now runs inside `flushSync` so it commits to the
  DOM as its own render before any new text is set (fixes the repeated-identical-client-blocked-
  failure silent-announcement defect); success path also calls `values.setExternalErrors({})`
  (non-blocking note).
- `frontend/src/features/panels/ui/form/FormPanelView.test.tsx` — added the CR1 regression test
  (two consecutive identical client-blocked submits, `MutationObserver`-verified DOM text change
  on the second).
- `backend/src/main/scala/com/helio/domain/panels/FormSubmission.scala` — unchanged in substance;
  re-verified against the new CR2 distinguishing test.
- `backend/src/test/scala/com/helio/domain/panels/FormSubmissionSpec.scala` — CR2: added the
  layer-1-only distinguishing case (declared-required field WITH a declared default, unsupplied).
- `backend/src/test/scala/com/helio/api/routes/panels/FormSubmitRoutesSpec.scala` — CR2: added the
  same case at the route level, with a row-count assertion.
- `openspec/changes/form-submit-append-path/mutation-evidence.md` — rewritten backend section
  (mutation 1 alone now goes RED with the new distinguishing tests in place; corrected the
  "load-bearing at either layer" conclusion); added the CR1 frontend mutation-evidence entry.

## Backend

- `backend/src/main/scala/com/helio/domain/engine/DatasetRowValidator.scala` — added public
  `validateRowStructured` (structured `FieldError`/row-length failure); `validateRow` renders
  through it (behaviour-preserving).
- `backend/src/main/scala/com/helio/domain/panels/FormSubmission.scala` (new) — pure `buildRow`:
  design.md D3 (i)-(viii) server-side form-submit rules.
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala`
  — extracted `insertAppendedRowsAction` from `appendRowsAction` (byte-identical); added
  `appendBuiltRow`/`appendBuiltRowAction` and the `FormRowBuildFailure` sealed trait.
- `backend/src/main/scala/com/helio/services/FormSubmitError.scala` (new) — the
  `ServiceError` + `fieldErrors` failure shape shared by `DataSourceService.appendFormRow` and
  `PanelService.submitForm`.
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — added
  `appendFormRow`; `audit` gained an optional `metadata` param (default unchanged for every
  existing call site).
- `backend/src/main/scala/com/helio/services/panels/PanelService.scala` — added `submitForm`;
  constructor gained an optional `dataSourceService` param (nullable-optional, additive).
- `backend/src/main/scala/com/helio/api/protocols/panels/PanelProtocol.scala` — added
  `FormSubmitRequest` (strict hand-rolled reader), `FieldValidationError`,
  `FieldValidationErrorResponse` + formats.
- `backend/src/main/scala/com/helio/api/routes/panels/PanelRoutes.scala` — added
  `POST /api/panels/:id/submit` with route-local `completeSubmit`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — `dataSourceService` construction moved
  ahead of `panelService` so the latter can be wired with it (no behaviour change).
- `backend/src/test/scala/com/helio/domain/panels/FormSubmissionSpec.scala` (new) — unit coverage
  for every D3 rule.
- `backend/src/test/scala/com/helio/api/routes/panels/FormSubmitRoutesSpec.scala` (new) — route
  coverage: success/defaults/orphans/empty-values, client-bypass rejections, ACL/visibility.

## Frontend

- `frontend/src/features/panels/types/panel.ts` — added `FormSubmitRequest`,
  `FieldValidationError` wire types.
- `frontend/src/features/panels/services/panelService.ts` — added `submitFormPanel`,
  `parseFieldErrors`.
- `frontend/src/features/panels/state/formSubmission.ts` (new) — `validateForSubmit`,
  `buildSubmitValues`, `mapServerFieldErrors`.
- `frontend/src/features/panels/state/formSubmission.test.ts` (new) — unit coverage.
- `frontend/src/features/panels/ui/form/useFormPanelValues.ts` — added `markAllTouched`,
  `setExternalErrors` (external-error precedence, cleared by `setValue`); `seedValueFor` leaves a
  `file` control empty regardless of `initialValue`.
- `frontend/src/features/panels/ui/form/useFormPanelValues.test.ts` — added coverage for the
  above.
- `frontend/src/features/panels/ui/form/FormPanelView.tsx` — gained `panelId`, `noValidate`, the
  submit handler (client validation → build → request → outcome), `submitState`, always-mounted
  alert/status regions, deferred focus management, the submit button.
- `frontend/src/features/panels/ui/form/FormPanelView.test.tsx` — rewritten: success, client-side
  block, server field errors, unrendered-field summary, transport failure, reset/no-reset,
  double-activation, Enter-submits.
- `frontend/src/features/panels/ui/form/FormPanel.css` — the submit button (Primary recipe,
  DESIGN.md §5) and the two live-region styles.
- `frontend/src/features/panels/ui/renderers/FormRenderer.tsx` — passes `panel.id` through.
- `e2e/hel1087-form-submit-path.spec.ts` (new) — live-browser: API-bypass rejections, UI server
  rejection (announced/associated/preserved/focused), transport failure, and a real success
  (+1 row on the bound source, +0 on another), both-theme screenshots.

## Contracts / docs

- `schemas/panels/form-submit-request.schema.json` (new) — titled `FormSubmitRequest`.
- `schemas/shared/field-validation-error-response.schema.json` (new) — titled
  `FieldValidationErrorResponse`.
- `CLAUDE.md`, `openspec/config.yaml` — added `POST /api/panels/:id/submit` to the endpoint list.
- `openspec/changes/form-submit-append-path/mutation-evidence.md` (new) — C7/C8 red-first proofs
  (backend no-write-on-rejection; frontend preserved-input).
