## Why

HEL-1276 shipped `outputs.config.historyPayloads` (opt-in full-row history per run), but it can only be set through a raw
`PATCH /api/outputs/:id`. HEL-1277's changed-rows view depends on it, so users and agents need a first-class way to turn
it on, with the caps and tier rules stated where the choice is made. Owner rulings are recorded in `ticket.md`.

## What Changes

- Output responses from the Output REST routes gain a read-only `historyPayloadsAvailable` boolean: whether the
  PIPELINE OWNER's tier keeps any run rows. It is computed server-side; the viewer's own tier is never used.
- The Output editor (existing Outputs) gains a History section with a "Keep each run's rows" toggle. Its help text
  states the 1,000-row / 1 MiB caps, the summary-only fallback, per-tier retention, and that turning it off lets stored
  rows expire normally. When `historyPayloadsAvailable` is false the toggle is disabled, with the note "Free stores run
  summaries only" and a "Request Beta access" link to Settings.
- The helio-mcp `update_output` tool description documents `config.historyPayloads` and `historyPayloadsAvailable`.

## Capabilities

### New Capabilities
- `output-history-payloads-toggle`: the Output editor's toggle, copy, and its disabled-with-upsell state.

### Modified Capabilities
- `output-routes-api`: Output responses carry `historyPayloadsAvailable`.
- `mcp-output-tools`: `update_output` documents the `historyPayloads` opt-in.

## Non-goals

- Purging stored rows on opt-out (owner ruling Q4: they expire on the normal schedule).
- A toggle in the create flow (the Output is created first, then edited; see design.md D4).
- Changing caps, retention, or which runs store payloads.
- Exposing env-overridden cap values to the client (the copy mirrors the backend defaults).

## Impact

- Backend: `OutputProtocol` (`OutputResponse`), `OutputRoutes`, a batched pipeline-owner-tier lookup on the privileged
  pool, `PayloadHistoryConfig` wiring into the routes; `schemas/outputs/output.schema.json`.
- Frontend: `types/output.ts`, `outputEditor/OutputEditorSheet.tsx` + a new History-section component,
  `buildOutputConfig.ts`.
- helio-mcp: `src/tools/outputs.ts` description, plus tests.
- e2e: one spec for the toggle in both themes, using `e2e/support/evidencePath.ts` (HEL-1363).
