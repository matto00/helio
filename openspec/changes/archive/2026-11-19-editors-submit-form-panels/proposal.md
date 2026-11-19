## Why

The owner ruled (2026-11-19) that a user with edit access to a dashboard can submit its form panels. Today
`POST /api/panels/:id/submit` admits only the form's owner, and HEL-1773 hides the form body from every non-owner, so
an editor of a shared dashboard cannot record anything through its forms.

## What Changes

- `POST /api/panels/:id/submit` admits any caller with `owner` or `editor` access to the panel's dashboard. A named
  viewer gets `403` with the view-only message. A signed-in user with no named grant (including on a public dashboard)
  gets `404`, as does a caller who cannot see the panel.
- The append runs on the app pool (`helio_app`, RLS enforced) in the **form owner's** database context, so the row
  lands only on a source the form owner owns; the submitter needs no grant on the source.
- New `GET /api/panels/:id/form-schema`: returns only the declarations of the fields the form binds, for an owner or
  editor of the panel's dashboard. Nothing else of the dataset's schema.
- A non-owner submitter's `201` response omits each row's `seq` (owner ruling 3).
- The appended row's audit event records the submitter as actor, with `panelId`.
- A non-owner's rejection never names a field the form does not configure (generic message instead), and a row-limit
  rejection states no number.
- A counter submit is now refused (`400`, nothing written) when the dataset no longer has the counter row shape. This
  includes the owner's direct-API submit, which used to return `201` and write a row with no usable timestamp.
- Any auto-run the write schedules still runs as (and counts against) the pipeline owner; the last writer is stored on
  the debounce row (Flyway **V146**: `pipeline_auto_run_debounce.triggered_by_user_id`) and recorded as the run's
  `triggered_by_user_id`, as HEL-1492 records an editor's manual run.
- Frontend: the form body renders for `owner` and `editor` roles (still not for viewers). A user who is not the form's
  owner loads the schema from the new panel route, and a counter field shows `+`/`-` and a local tally of their own
  clicks with no aggregate read of the dataset (owner ruling 1).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `form-panel-submit`: who may submit (dashboard owner/editor instead of form owner only), the per-panel form-schema
  route, `seq` omitted for non-owner submitters, counter reconciliation limited to the form owner, attribution of the
  write and its auto-run.
- `form-panel-rendering`: the schema a non-owner's form loads comes from the per-panel route; the form body is offered
  to dashboard editors, not to viewers.

## Impact

- Backend: `PanelService`, `PanelFormFileSubmission`, `DataSourceService.appendFormRow`, `PanelRoutes` (new GET route),
  `AutoRunTriggerService`, `PipelineAutoRunDebounceRepository`, `PipelineAutoRunDebounceFirer`,
  `PipelineRunService.submit`, panel/source protocols, new migration `V146`.
- Domain: `FormSubmission.buildRow`, `FormSchemaConsistency` (a public counter-shape wrapper), `FormSubmitError` (a
  `reason` discriminator).
- Schemas: `schemas/panels/form-submit-response.schema.json`, new `schemas/panels/form-schema-response.schema.json`; the submit response schema's `seq` becomes optional.
- Frontend: `FormRenderer.tsx`, `FormPanelView.tsx`, a panel-scoped schema client in `panelService.ts`. Not the panel
  card / role / `PanelDetailModal` files the in-flight HEL-1780 lane owns.
- e2e: a new spec covering editor, viewer and stranger.
