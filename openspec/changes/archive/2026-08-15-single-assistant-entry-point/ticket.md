# HEL-666: Single global assistant entry point (retire AuthoringChatDrawer + per-feature buttons)

## Description

HEL-659 is a big-bang replacement, not a parallel rollout. Today there are per-feature entry points
to the old assistant (e.g. the "magic wand" button next to Create Dashboard in `DashboardList.tsx`);
the new design wants exactly one entry point to the assistant per page. See
`docs/superpowers/specs/2026-08-14-top-level-assistant-design.md`.

Depends on: `AssistantService` (needs a live backend to talk to), the Chat nav destination ticket,
and the visual design ticket (implements that design, doesn't invent it).

## Scope (as written)

* Add the single inline quick-launcher to the app command bar, available on every screen,
  opening/focusing the same active conversation as an overlay rather than navigating away.
* Remove `AuthoringChatDrawer`'s current mount point in `DashboardList.tsx` and any other
  per-feature entry buttons to the old assistant.
* Wire proposals produced by the new assistant into the existing, untouched
  `ProposalReviewPage.tsx`/`ProposalReview.tsx` — same hand-off contract as today, just a different
  producer.
* Update/replace `useDashboardAuthoringStream` (or its successor) for the new event shape
  (tool-call/search progress, not just text/proposal).

## Acceptance Criteria

- [ ] Every page has exactly one way to reach the assistant (the inline launcher) plus the
      dedicated `/chat` page — no leftover per-feature buttons anywhere in the app.
- [ ] A proposal produced via the new assistant reaches Proposal Review UI and applies exactly as
      today's dashboard proposals do — verified live against the real dev backend, not just
      mocked, per this session's established practice of live-verifying authoring flows.
- [ ] `AuthoringChatDrawer` and its now-dead entry points are deleted, not left dormant.

## Context / Notes

- Parent epic: HEL-659. Seventh of 8 child tickets; delivery order 660→661→662→663→664→665 (all
  merged, HEL-665 delivered as two PRs after a post-merge reopen) → 666 (this ticket) → 667.
- **Research finding at planning time: two of this ticket's four stated scope bullets are already
  fully shipped by HEL-665, not genuinely open work.**
  - **Quick-launcher (bullet 1)**: already fully built and mounted unconditionally in
    `.app-command-bar__right` (`App.tsx`), reachable on every authenticated route, plus a
    `Cmd/Ctrl+K` shortcut — confirmed by reading the real current code, not the ticket's own
    (now-stale) framing. Nothing left to build here; this ticket's job is to verify it, not
    construct it.
  - **Proposal hand-off (bullet 3)**: `ProposalHandoff.tsx` (HEL-665) already navigates to
    `/proposals/review`/`/patch-sets/review` with the parsed proposal in router state, reusing the
    *exact* mechanism `AuthoringChatDrawer.handleReviewAndApply` used, and `ProposalReviewPage.tsx`
    already treats `authoringRequestId` as fully optional (a fire-and-forget telemetry call only —
    the apply path itself is unconditional and identical either way). Functionally complete for
    the dashboard-proposal case; this ticket's job is live re-verification (AC2's own wording),
    not new code.
  - **Bullet 4 (`useDashboardAuthoringStream`) is mischaracterized in the ticket's own text.**
    Confirmed its only real consumer is `AuthoringChatDrawer.tsx` itself, and confirmed the new
    chat surface (`ChatPage`/`ActiveConversationPanel`/`MessageComposer`) never imports it — it has
    its own, entirely independent Redux-slice-based data flow. Once `AuthoringChatDrawer` is
    deleted, this hook has zero remaining consumers: it should be **deleted alongside it**, not
    "updated for a new event shape" (there is no successor to update it into — the new surface
    never needed an equivalent).
  - **`RefinementChatDrawer` ("Refine with AI") is explicitly out of scope.** The canonical epic
    spec's own "Relationship to existing tickets" section names only `AuthoringChatDrawer`'s mount
    point as retired; HEL-343 (Conversational Refinement) is called out as "unaffected." Confirmed
    live in code: `RefinementChatDrawer` is a wholly independent flow (its own hook, its own
    buffered `/api/refinements` endpoint, targets an *existing* dashboard) with its own still-valid
    mount point in `App.tsx`, untouched by HEL-665. **Do not touch this component or its button.**
  - **Backend `DashboardAuthoringService`/`DashboardAuthoringRoutes` stay.** This ticket's own
    scope is stated entirely in frontend terms; nothing in it implies retiring the backend
    endpoint. The new assistant's `propose_dashboard` tool reuses `DashboardProposalService`
    directly (service-layer logic reuse, confirmed in `AssistantToolExecutor.scala`), never calling
    the old HTTP route internally — so the backend route becomes unreachable from any frontend
    consumer after this ticket, but stays as real, independently-tested code. Retiring it is a
    separate, larger, out-of-scope decision this ticket does not make.
  - **The genuinely open work, precisely scoped**: delete `AuthoringChatDrawer.{tsx,css,test.tsx}`,
    `useDashboardAuthoringStream.{ts,test.ts}`, and `frontend/src/test/sseMock.ts` (a shared test
    helper with zero remaining consumers once both of the above test files are gone — confirmed via
    grep); remove the mount point/button/state/import in `DashboardList.tsx` (+ its now-dead
    `.dashboard-list__author-ai` CSS rules + its now-obsolete test); remove the now-unused
    `AUTHORING_DASHBOARD_ENDPOINT` export from `authoringService.ts` (its other two exports,
    `fetchAuthoringConversation`/`postAuthoringOutcome`, stay — still used by `RefinementChatDrawer`
    and `ProposalReviewPage` respectively, confirmed via grep); a `REMOVED Requirements` openspec
    delta against the `nl-authoring-chat-surface` capability; and live re-verification of the
    already-shipped quick-launcher + proposal hand-off (AC1/AC2's own literal requirement, even
    though no new code is needed to satisfy them).
