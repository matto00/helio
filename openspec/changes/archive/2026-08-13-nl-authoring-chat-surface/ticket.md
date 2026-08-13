# HEL-395: In-app chat surface: prompt input, streaming response, wire proposal → Proposal Review UI → apply

## Description

The proposal → review → apply frontend already exists: `ProposalReviewPage.tsx` reads a proposal from router `location.state.proposal` (today only ever supplied by an MCP hand-off or a synthesized demo), renders `ProposalReview.tsx`, and on Accept dispatches `applyProposal` (`dashboardsSlice.ts`) → `POST /api/dashboards/apply-proposal`. What's missing is the *entry point*: an in-app natural-language chat surface where the user states a goal and gets a proposal, which then flows into that existing review UI.

This ticket builds the chat surface (panel/drawer) that calls the NL authoring endpoint (HEL-392, shipped: `POST /api/authoring/dashboard`), streams the response, and hands the resulting validated proposal to the existing Proposal Review UI for apply. Binding to `DESIGN.md` for all frontend work.

Touches: new chat UI under `frontend/src/features/dashboards/ui/` (or a new `features/authoring/`), a new service in `frontend/src/features/dashboards/services/`, routing/entry-point wiring (`App.tsx`, a launch affordance), and reuse of `ProposalReview.tsx` / `applyProposal`.

## Scope

* Frontend TS/React: a chat surface (drawer or panel) with a goal prompt input, a streaming assistant response area (consume the SSE/streaming variant of the authoring endpoint), and a "review proposal" hand-off. Presentational-first; shared state via Redux where it must persist. Follow `DESIGN.md` tokens/components.
* Frontend TS: a service wrapping `POST /api/authoring/dashboard` (streaming) — mirror `proposalService.ts`'s thin-service style.
* Wire the returned proposal into the existing `ProposalReview` flow (reuse `ProposalReviewPage`/`ProposalReview` and `applyProposal`) rather than building a second apply path — the user still reviews + explicitly accepts before anything is written.
* Entry point: a discoverable affordance (e.g. an "Author with AI" action) that opens the chat surface.
* Loading/streaming states + a clear "reviewing" transition; no writes until the user accepts in the review UI.
* Tests: Jest/RTL for the chat surface (submit goal → streamed response rendered → proposal handed to review), the service, and the entry-point wiring.

## Acceptance criteria

- [ ] A user can open an in-app chat surface, type a goal, and see a streamed response.
- [ ] The resulting validated proposal is handed to the existing `ProposalReview` UI; Accept applies via the existing `applyProposal` path (no second apply implementation).
- [ ] Nothing is written until the user accepts in the review UI.
- [ ] UI follows `DESIGN.md`; `npm run lint` (zero-warnings) + `npm test` + `npm run format:check` green.
- [ ] Backward-compat: the existing `ProposalReviewPage` MCP/demo entry paths still work.

## Out of scope

* Multi-turn refinement of the proposal within the chat (sibling ticket) — this ticket delivers single-shot goal → proposal → review.
* The backend endpoint (sibling ticket, HEL-392, already shipped).
* Conversational refinement of *existing* resources (HEL-343).

## Dependencies

* Depends on the HEL-341 NL authoring endpoint ticket (HEL-392, shipped: `POST /api/authoring/dashboard`, buffered + `?stream=true` SSE variants). Related to HEL-365 and to the HEL-341 multi-turn state ticket and HEL-343 refinement (shared chat surface).
