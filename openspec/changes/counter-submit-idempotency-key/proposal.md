## Why

A form or counter submit whose acknowledgement is lost (the write committed, the client saw no response) cannot be
re-sent safely today: `POST /api/panels/:id/submit` carries no idempotency key, so any re-send appends a second
row. There is also no client retry, so the only re-send is a manual re-click, which the client cannot tell apart
from a deliberate second increment. HEL-1175 closes the gap with an owner-ruled scheme (2026-11-25, Q0-Q5).

## What Changes

- The JSON submit body accepts an optional `submitKey` (a UUID). Absent = today's behaviour exactly.
- `dataset_rows` gains nullable `submit_key`, `submit_user_id`, `submit_panel_id` columns and a partial unique
  index on `(data_source_id, submit_key)`; the key lives as long as its row (no purge job, no new table).
- Inside the existing source lock, a keyed submit first looks up `(data_source_id, submit_key)`:
  - no hit: append as today, storing the key, submitter and panel;
  - hit by the same submitter and panel: append nothing and answer `200` with the original row's response shape
    (masked for a non-owner exactly as today), with no audit event, no auto-run trigger, no debounce re-arm and no
    `triggered_by_user_id` update;
  - hit by a different submitter or panel: `409`, never a replay.
- The web client generates one key per submit (counter click or form submit) and, when a request gets no HTTP
  response, retries it automatically with the same key, at most 2 times with short backoff, before the existing
  HEL-1169 indeterminate handling and reconcile run.

## Capabilities

### New Capabilities

### Modified Capabilities
- `form-panel-submit`: keyed, idempotent JSON submits and a bounded same-key client retry of a no-response submit.

## Impact

Backend: `PanelRoutes`, `PanelProtocol`, `PanelService.submitForm`, `DataSourceService.appendFormRow`,
`DataSourceRepository.appendBuiltRowAction`, a new Flyway migration (next free V-number). Schema:
`schemas/panels/form-submit-request.schema.json`. Frontend: `panelService.submitFormPanel`, its callers
(`useCompactCounterSubmit.ts`, `FormPanelView.tsx`). No change to the multipart file submit path.

## Non-goals

- Multipart (file-attached) submits: no key, unchanged (owner ruling Q1; follow-up triage at Delivery).
- Deduplicating a MANUAL re-click or re-submit: a manual action always gets a fresh key.
- `POST /api/data-sources/:id/rows` and every other dataset write path.
- Detecting a same-key re-send whose body differs from the original (the original response is replayed).
