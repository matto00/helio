## Skeptic Report — design gate (round N, skeptic-design-1.md)

### What I verified (with evidence)

1. **`usePipelineRunEvents.ts` SSE pattern matches the claim.** Read
   `frontend/src/features/pipelines/hooks/usePipelineRunEvents.ts` in full. Confirmed: `fetch(url, {
   credentials: "include", signal })` (not `EventSource`, with the same cookie-attachment rationale
   the design doc cites), manual line-buffered `event:`/`data:` SSE parsing, `AbortController` +
   `unmounted` flag cleanup on unmount, `Content-Type` validation before treating the body as a
   stream, `connectionError` state on fetch failure / non-SSE response / stream drop. This is exactly
   the shape design.md's D2 and Context section describe as the pattern to mirror. The corresponding
   test file (`usePipelineRunEvents.test.ts`) hand-constructs SSE byte chunks via a mocked
   `ReadableStream`, matching the precedent tasks.md 5.1 cites.

2. **HEL-392's real SSE event names/payloads match design.md/spec.md exactly.** Read
   `backend/src/main/scala/com/helio/api/protocols/DashboardAuthoringProtocol.scala` and
   `backend/src/main/scala/com/helio/api/routes/DashboardAuthoringRoutes.scala`. Confirmed
   `AuthoringStreamEvent.toSseBytes` emits exactly: `authoring-progress` → `{text}`, `authoring-status`
   → `{label}`, `authoring-result` → `{proposal, warnings}`, `authoring-error` → `{message}` — a
   byte-for-byte match to design.md's Context section and spec.md's requirements. Route is
   `POST /api/authoring/dashboard` with `?stream=true` returning `HttpEntity.Chunked` at
   `text/event-stream`, matching the ticket's endpoint reference and CLAUDE.md's already-updated route
   table entry. `DashboardAuthoringResponse(proposal, warnings)` confirms the buffered (non-stream)
   shape referenced by tasks 1.1 also matches.

3. **`ProposalReviewPage.tsx` reads `location.state.proposal` in exactly the claimed shape, zero
   changes needed.** Read the full file. Line 26:
   `const stateProposal = (location.state as { proposal?: DashboardProposal } | null)?.proposal;` —
   matches design.md D4's claim verbatim. The file's own comment (lines 13–21) independently
   corroborates the "in-app NL author... deliberate follow-on... intentionally not done here" framing
   proposal.md's "Why" section quotes. `ProposalReview.tsx` has no `warnings` prop (grepped its full
   prop surface) — confirms design.md's Non-Goal claim that warnings can't be rendered without
   modifying that component. `/proposals/review` is registered in `frontend/src/app/App.tsx:511`
   exactly as claimed. No changes to any of these three files are required by the plan, and none are
   scoped in tasks.md — consistent with the "Modified Capabilities: none" declaration in proposal.md.

4. **`proposalService.ts`'s thin-service style is accurately described.** One typed async function
   (`applyDashboardProposal`) wrapping `httpClient.post`, no fetch/stream logic — matches D3's framing
   of what the new `authoringService.ts` should mirror (types + endpoint path only, stream logic
   staying in the hook).

5. **DESIGN.md conventions are represented accurately.** Read DESIGN.md's Styling Approach (§1) and
   Shared Components (§6) sections. Confirmed: co-located CSS Modules, BEM-ish naming, no new styling
   system — matches design.md D1/tasks 3.1's instructions verbatim. Confirmed `Modal.tsx` is the only
   existing shared overlay primitive (sizes sm/md/lg, 420–720px, native `<dialog>`) — no existing
   `Drawer` component in the codebase (grepped for "drawer" across `frontend/src`, zero hits), so D1's
   "new drawer component, not `Modal`" is a genuine judgment call, not a fabricated precedent, and is
   reasoned (streamed-response area needs more comfortable height than a confirmation-sized dialog).
   `InlineError`/`StatusMessage` (referenced implicitly by spec.md's inline-error requirement) do exist
   under `frontend/src/shared/chrome/`.

6. **Entry-point placement claim (D5) is grounded.** `DashboardList.tsx` has an existing
   create-dashboard affordance (`"Create dashboard"` button, `faPlus` icon, `"Add dashboard"`
   aria-label, an `EmptyState` CTA labeled `"New dashboard"`) — a real, existing "dashboard-creation
   affordance" for the new "Author with AI" entry point to sit beside, as D5/task 4.1 describe.

7. **Frontend type mirror is plausible.** `frontend/src/features/dashboards/types/proposal.ts`'s
   `DashboardProposal`/`ProposalPanel` shapes align with what `DashboardAuthoringResponse.proposal`
   (Scala) would serialize to. `schemas/dashboard-authoring-request.schema.json` and
   `-response.schema.json` exist as proposal.md's Impact section claims.

8. **Acceptance-criteria traceability.** All 5 ticket ACs map to concrete tasks/spec requirements: AC1
   → tasks 2.x/3.1 + spec Requirement 1; AC2 → task 3.2 + D4 + spec Requirement 2; AC3 → spec
   Requirement 3 + test 5.2 (no apply-proposal call assertion); AC4 → task 3.1 (DESIGN.md tokens) +
   task 5.5 (lint/test/format); AC5 → task 5.4 (existing `ProposalReviewPage`/`ProposalReview` suites
   confirmed to pass unmodified). No AC is left uncovered.

9. **No placeholders/hand-waving.** Grepped the full change directory for
   TODO/TBD/"figure out"/"to be determined"/placeholder — zero hits. "Open Questions: None
   outstanding" in design.md is consistent with the plan's actual level of specificity — every
   non-trivial decision (D1–D5) is made and justified, not deferred.

10. **No internal contradictions found** between ticket.md, proposal.md, design.md, tasks.md, and
    spec.md. Scope is consistent throughout (single-shot goal → proposal → review hand-off; multi-turn
    refinement and warnings-rendering explicitly and consistently out of scope across all four
    documents).

### Verdict: CONFIRM

The design is sound and unusually well-grounded: every "existing pattern" or "existing signature"
claim I checked against the actual current source (`usePipelineRunEvents.ts`, `ProposalReviewPage.tsx`,
`ProposalReview.tsx`, `proposalService.ts`, `DashboardAuthoringProtocol.scala`,
`DashboardAuthoringRoutes.scala`, `App.tsx`, `DashboardList.tsx`, `Modal.tsx`, DESIGN.md) matched
exactly, including specific claims that would have been easy to get subtly wrong (event names, payload
field names, the exact `location.state` destructuring shape, the absence of a `warnings` prop). No
placeholders, no scope drift, no missing AC coverage, no missing contract updates (correctly none
needed — HEL-392's contract is consumed unmodified). This is implementation-ready.

### Non-blocking notes

- D1's "not `Modal.tsx`... keeps the streamed-response area comfortably tall without redesigning
  `Modal`" is a defensible but subjective call; an alternative (widening `Modal` with a new size
  preset) wasn't explicitly weighed in the Decisions section's "Alternative considered" style the way
  D2 does for `EventSource`. Not blocking — DESIGN.md doesn't mandate reuse over a new primitive when
  the existing one's dimensions are a genuine poor fit, and a net-new drawer is easy for the Skeptic's
  final-gate pass to hold to DESIGN.md token/BEM conventions regardless.
- tasks.md doesn't explicitly call out which shared input primitives (`TextField`/`Textarea` from
  DESIGN.md §6) the goal input should use. Minor implementer-discretion gap, not a blocker — DESIGN.md
  §6 already makes "reuse, don't reinvent" mechanical/greppable, so an evaluator will catch a hand-rolled
  input at the final gate if one appears.
