## Why

A `form` panel renders its fields (HEL-1085) but has no submit path: `FormPanelView.tsx:4,82` renders a
submit-prevented `<form>` with no button, so nothing typed ever reaches the bound dataset. The row-append API
(HEL-1077) validates against the declared schema but knows nothing about the form — its tighten-only `required`
and `select` options are enforced only in the browser, the "convenience, not enforcement" gap the ticket names.

## What Changes

- New `POST /api/panels/:id/submit`: one name-keyed row for a `form` panel, targeting the panel's persisted
  `dataSourceId` only. Under the source lock it enforces the form's rules (closed keys, tighten-only `required`,
  `select` membership, no `file` yet), then the declared schema via the row-append path; any failure writes nothing.
- `400` validation responses gain structured `fieldErrors` (route-local completion, HEL-401 precedent); the
  `{message}` envelope is unchanged.
- Frontend: a submit button (`submit.label` or "Submit"), submit-time client validation, success / field-level
  error / network-failure states, focus to the first invalid field, always-mounted live regions; input is never
  cleared on rejection; success resets unless `resetOnSuccess` is `false`.
- Specs/docs: new `form-panel-submit`; `form-panel-rendering`'s no-submit-affordance requirement removed; two JSON
  Schemas; `CLAUDE.md` endpoint list.

## Capabilities

### New Capabilities
- `form-panel-submit`: the panel-scoped submit API, its server-side enforcement and error shape, and the panel's
  submit-time behaviour.

### Modified Capabilities
- `form-panel-rendering`: the no-submit-affordance requirement is removed; Enter in a text field now submits.

## Impact

- Backend: `PanelRoutes`, `PanelService`, `DataSourceService`/`Repository` (lock-held row-builder seam),
  `DatasetRowValidator`, new pure `FormSubmission`, protocol types.
- Frontend: `FormPanelView`, `FormRenderer`, `useFormPanelValues`, `panelService`, new `state/formSubmission.ts`,
  `FormPanel.css`.
- Contracts: two JSON Schemas, `form-panel-rendering` delta. Tests: ScalaTest, Jest, Playwright, red-first
  mutation proofs.

## Non-goals

- Submissions by grantees or public viewers (the write runs under the caller's RLS context).
- `file` fields (HEL-1086), counters (HEL-1088/1089), the a11y audit (HEL-1090), Output refresh (Epic 4),
  helio-mcp, any change to `POST .../rows`.
