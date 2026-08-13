## Context

`frontend/src/features/pipelines/hooks/usePipelineRunEvents.ts` is the one existing SSE-consumption
precedent: `fetch(url, { credentials: "include", signal })`, not `EventSource` (can't send cookies),
manual line-buffered `event:`/`data:` parsing, `AbortController` cleanup on unmount. `ProposalReviewPage.tsx`
(`frontend/src/features/dashboards/ui/`) already reads `(location.state as {proposal?})?.proposal` and
its own comment names in-app NL authoring as "a deliberate follow-on... intentionally not done here."
`/proposals/review` is an already-registered route (`frontend/src/app/App.tsx`). HEL-392 shipped
`POST /api/authoring/dashboard`/`?stream=true`, emitting real SSE events verified directly from
`DashboardAuthoringProtocol.scala`: `authoring-progress` (`{text}`), `authoring-status` (`{label}`),
`authoring-result` (`{proposal, warnings}`), `authoring-error` (`{message}`) — exactly one terminal
`authoring-result`/`authoring-error` per stream, never zero, never two. `proposalService.ts` is the
"thin service" precedent: one typed async function per endpoint, no fetch/stream logic inline.

## Goals / Non-Goals

**Goals:**
- A goal → streamed response → review hand-off, reusing the review/apply path completely unmodified.
- Mirror the one proven SSE-consumption pattern this codebase already has, not invent a second one.

**Non-Goals:**
- Multi-turn refinement within the chat (sibling ticket) — single-shot only.
- Rendering `authoring-result`'s `warnings` array anywhere — `ProposalReviewPage` doesn't accept a
  warnings prop today and this ticket doesn't add one; a future ticket can surface them.
- `contextOptions` (budget tuning) exposed in the UI — not something an end user needs to configure.

## Decisions

**D1 — Chat surface is a drawer overlay, not a new route.** The ticket calls it "panel/drawer";
`/proposals/review` already exists as its own route and stays that way (the drawer's job ends at
`navigate`). A drawer, not `Modal.tsx` (the existing shared overlay, sized for short confirmations),
keeps the streamed-response area comfortably tall without redesigning `Modal`. New component under
`frontend/src/features/dashboards/ui/` (same directory as `ProposalReview`), toggled by local state
from wherever the entry point lives (D5) — no new route, no new Redux state (this is view-local,
transient UI state, not shared application state per `CLAUDE.md`'s own Redux guidance).

**D2 — `useDashboardAuthoringStream` mirrors `usePipelineRunEvents` structurally, not just in spirit.**
Same `fetch` + `credentials: "include"` + `AbortController` + manual SSE line-buffer parse (never
`EventSource`) — the one difference is the request itself: `POST` with a JSON body (`{goal}`) instead
of a parameterless `GET`, and event-name dispatch on the real HEL-392 event names (`authoring-progress`
→ accumulate text, `authoring-status` → surface the label e.g. "repairing", `authoring-result` →
terminal success, `authoring-error` → terminal failure) instead of `run-status`. Alternative
considered: `EventSource` — rejected for the identical reason `usePipelineRunEvents`'s own doc comment
already gives (no `credentials: "include"` support, so the session cookie never attaches).

**D2 addendum (evaluation cycle 1):** `POST` (unlike the GET-only `usePipelineRunEvents` precedent)
must also carry the `X-Helio-Requested-With: 1` CSRF header — `AuthDirectives.requireCsrfHeader` 403s
every non-`GET` request that carries the `helio_session` cookie without it. `httpClient` (axios) sets
this by default on every other mutating call in the app, but any hook that bypasses `httpClient` for a
raw-`fetch` streaming `POST` (this one, and any future one mirroring it) must add the header itself —
this was missed in the first implementation pass and only surfaced in live (real-backend) review, not
in mocked unit tests. Any future raw-`fetch` streaming-POST hook should add this header from the start.

**D3 — `authoringService.ts` holds only the endpoint path + request/response TS types, not the
stream-parsing logic.** Matches this codebase's existing split: `proposalService.ts` (thin REST
wrapper) lives in `services/`, `usePipelineRunEvents.ts` (stream consumption) lives in `hooks/` — the
new authoring hook follows the same split rather than inventing a third pattern.

**D4 — Zero changes to `ProposalReviewPage.tsx`/`ProposalReview.tsx`/`applyProposal`.** On a terminal
`authoring-result`, the hook's caller does `navigate("/proposals/review", { state: { proposal } })` —
byte-identical to the shape `ProposalReviewPage` already destructures
(`(location.state as {proposal?})?.proposal`). This is what makes "no second apply implementation"
structurally guaranteed rather than merely tested: the existing component's read path is never
touched, so there is nothing new to diverge from it.

**D5 — Entry point sits beside the existing dashboard-creation affordance, exact component at
implementer discretion.** The ticket asks for "a discoverable affordance" without specifying which
existing screen; self-approved to place it next to whatever the current "create a dashboard" trigger
is (grounded in `DESIGN.md`'s icon-button conventions), rather than a new standalone location — not
an architectural decision, a placement one.

## Risks / Trade-offs

[No `EventSource` reconnect semantics, matching `usePipelineRunEvents`'s own existing trade-off] →
acceptable: a dropped connection surfaces `connectionError` state (same shape as the pipeline hook),
user can resubmit their goal — no worse than the one precedent this pattern is copied from.

[Warnings from `authoring-result` are silently dropped this ticket] → explicit Non-Goal, not an
oversight; `ProposalReviewPage` has no prop for them today, and the ticket's own ACs don't ask for it.

[Streamed JSON-in-progress text isn't meaningful to show verbatim mid-stream — the model is composing
raw proposal JSON, not conversational prose] → the chat surface shows progress as an indeterminate
"composing your dashboard..." activity state (not raw token text) while `authoring-progress` events
arrive, only rendering real content once `authoring-result` lands — avoids showing users broken
mid-JSON fragments, still gives the "streaming" visual feedback the AC asks for.

## Migration Plan

Additive only — new component/hook/service files, one entry-point affordance change, zero changes to
existing review/apply code. No backend, schema, or database changes (this ticket consumes HEL-392
unmodified).

## Planner Notes

Self-approved: drawer-not-route placement, hook/service split, SSE parsing approach (proven pattern,
not new), and "don't render warnings yet" — all conventional extensions of existing patterns, no new
dependency, no architectural change beyond the ticket's own scope. Exact entry-point pixel placement
(D5) is implementer discretion within `DESIGN.md`, not a design-gate-worthy decision.

## Open Questions

None outstanding.
