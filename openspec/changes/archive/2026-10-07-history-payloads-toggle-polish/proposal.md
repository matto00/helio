## Why

HEL-1331 shipped the Output editor's "Keep each run's rows" toggle with three rough edges (HEL-1372): the upsell link navigates away and loses unsaved editor edits, the cap and retention figures in the help copy are frontend constants that go wrong as soon as an operator overrides `PAYLOAD_HISTORY_*` env vars, and the disabled-state note renders at a larger type size than the help text. The owner ruled on the first two (open in a new tab; serve the figures from the backend).

## What Changes

- Output REST responses gain a read-only `historyPayloadLimits` object next to `historyPayloadsAvailable`: `maxRows`, `maxBytes`, and per-tier (`free`, `beta`, `owner`) `maxRuns` / `maxAgeDays`, taken from the running server's `PayloadHistoryConfig` (env overrides included). JSON schema updated in the same change.
- The Output editor renders the help text's figures from `historyPayloadLimits` and drops its hard-coded constant; when the field is absent it renders wording without figures rather than guessing.
- The "Request Beta access" link opens Settings in a new tab (`target="_blank"`, `rel="noopener noreferrer"`), with an accessible "opens in a new tab" cue, so the editor keeps its state.
- The disabled-state note uses the help-text style (`--text-xs`, muted) instead of the larger `type-hint` style.
- helio-mcp: `OutputResponse` type gains `historyPayloadLimits`; `update_output`'s description points at the field instead of hard-coding 1,000 rows / 1 MiB / tier retention.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `output-routes-api`: Output responses also report the payload-history limits.
- `output-history-payloads-toggle`: help text figures come from the response; upsell link opens in a new tab; note styling.
- `mcp-output-tools`: `update_output` documents the limits via the field rather than fixed numbers.

## Impact

- Backend: `OutputProtocol.scala` (response field + format), `OutputRoutes.scala` (`withAvailability` stamps limits), backend spec coverage.
- Schema: `schemas/outputs/output.schema.json`.
- Frontend: `frontend/src/features/pipelines/types/output.ts`, `HistoryPayloadsField.tsx`, `OutputEditorSheet.tsx` (prop pass-through), `OutputEditorSheet.css` if needed, unit tests, `e2e/hel1331-history-payloads-toggle.spec.ts`.
- helio-mcp: `src/types.ts`, `src/tools/outputs.ts`, related tests.
- No migration, no new endpoint, no prod config change. Avoids `compareOptions.ts`.
