## Why

HEL-392 shipped the backend NL authoring endpoint, but nothing in the app can call it yet —
`ProposalReviewPage.tsx` still only reads a proposal from `location.state` (MCP hand-off or a demo
fixture) and its own comment names this exact gap as "a deliberate follow-on." This ticket is that
follow-on: a chat entry point that turns a typed goal into a proposal the existing review UI already
knows how to render and apply.

## What Changes

- Add a chat surface (drawer overlay, not a new route) under `frontend/src/features/dashboards/ui/`:
  goal input, streamed assistant response area, submit/cancel.
- Add `useDashboardAuthoringStream` (`frontend/src/features/dashboards/hooks/`), mirroring the
  existing `usePipelineRunEvents` fetch+`ReadableStream` SSE-consumption pattern exactly (not
  `EventSource`, which can't send the `helio_session` cookie) — parses the real
  `authoring-progress`/`authoring-status`/`authoring-result`/`authoring-error` SSE events HEL-392
  already emits.
- Add a thin `authoringService.ts` (`frontend/src/features/dashboards/services/`) holding the
  endpoint path + request/response types, mirroring `proposalService.ts`'s style — the streaming
  fetch/parse logic itself lives in the hook, matching the existing hooks/services split.
- On a terminal `authoring-result` event, `navigate("/proposals/review", { state: { proposal } })` —
  the **exact** shape `ProposalReviewPage.tsx` already destructures from `location.state.proposal`.
  Zero changes to `ProposalReviewPage.tsx`, `ProposalReview.tsx`, or `applyProposal` — the existing
  review/apply path is reused completely unmodified.
- Add a discoverable "Author with AI" entry point near the existing dashboard-creation affordance.

## Capabilities

### New Capabilities

- `nl-authoring-chat-surface`: goal-input chat drawer, streamed response, hand-off to the existing
  Proposal Review UI. No new apply path.

### Modified Capabilities

(none — `ProposalReviewPage`/`ProposalReview`/`applyProposal` are consumed exactly as they already
exist; no existing capability's documented requirements change.)

## Impact

- New: a chat drawer component + CSS module, `useDashboardAuthoringStream.ts` (+ test),
  `authoringService.ts` (+ test), an entry-point affordance change to wherever dashboard creation is
  currently triggered.
- No backend changes (HEL-392 already shipped the consumed endpoint). No schema changes (frontend
  types mirror the already-shipped `schemas/dashboard-authoring-*.schema.json`).
- No database/migration impact.
