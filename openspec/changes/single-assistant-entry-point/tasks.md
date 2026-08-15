## 1. Frontend: Delete the old assistant surface

- [x] 1.1 Delete `frontend/src/features/dashboards/ui/AuthoringChatDrawer.tsx`,
      `AuthoringChatDrawer.css`, `AuthoringChatDrawer.test.tsx`
- [x] 1.2 Delete `frontend/src/features/dashboards/hooks/useDashboardAuthoringStream.ts`,
      `useDashboardAuthoringStream.test.ts` (design.md D1 — zero remaining consumers once 1.1 is
      done)
- [x] 1.3 Delete `frontend/src/test/sseMock.ts` (design.md D1 — zero remaining consumers once 1.1
      and 1.2 are done)
- [x] 1.4 Remove the now-unused `AUTHORING_DASHBOARD_ENDPOINT` export from
      `frontend/src/features/dashboards/services/authoringService.ts` (design.md D2) —
      `fetchAuthoringConversation`/`postAuthoringOutcome` stay untouched (still used by
      `RefinementChatDrawer.tsx`/`ProposalReviewPage.tsx` respectively)

## 2. Frontend: Remove the DashboardList.tsx entry point

- [x] 2.1 Remove `import { AuthoringChatDrawer } from "./AuthoringChatDrawer"`,
      `isAuthoringOpen` state, and the `<AuthoringChatDrawer open={...} onClose={...} />` mount
      from `DashboardList.tsx`
- [x] 2.2 Remove the `dashboard-list__author-ai` "magic wand" button from `DashboardList.tsx`'s JSX
      (design.md D3)
- [x] 2.3 Remove the `.dashboard-list__author-ai` CSS rules from `DashboardList.css`
- [x] 2.4 Remove `DashboardList.test.tsx`'s "opens the Author with AI chat drawer" test — the
      affordance it tests no longer exists
- [x] 2.5 Confirm `RefinementChatDrawer.tsx` and its "Refine with AI" mount point in `App.tsx` are
      completely untouched (design.md D4) — a diff review checkpoint, not a code change

## Tests

- [x] 3.1 Test/regression check: `DashboardList.test.tsx`'s remaining tests (add source, delete,
      duplicate, etc.) still pass after the entry-point removal
- [x] 3.2 Test/regression check: `RefinementChatDrawer`'s existing tests, and `ProposalReviewPage`'s
      existing tests, are unaffected by this diff (confirm via `git diff --name-only` these files
      are not touched)
- [x] 3.3 Live verification (AC1 — Playwright, against a real running dev server): every
      authenticated page (at minimum `/`, `/sources`, `/pipelines`, `/registry`, `/metrics`,
      `/chat`) shows exactly one way to reach the assistant — the command-bar quick-launcher icon
      (or the dedicated `/chat` page itself) — and no leftover per-feature button anywhere,
      specifically confirming the "magic wand" button no longer renders in `DashboardList.tsx`.
      Note explicitly (design-gate round 1 non-blocking observation): the "Refine with AI" button
      is a second, DIFFERENT AI-related icon that remains visible on `/` with a dashboard selected
      — this is `RefinementChatDrawer`'s own, separate, explicitly-out-of-scope entry point
      (design.md D4), not a violation of AC1's "exactly one way to reach the assistant," which is
      scoped to the new top-level assistant HEL-659 is about, not HEL-343's independent refinement
      flow. Implemented as `e2e/hel666-single-assistant-entry.spec.ts`, run via `npm run e2e`
      against real dev servers — PASSED.
- [x] 3.4 Live verification (AC2 — against the real dev backend, real `ANTHROPIC_API_KEY`, per this
      session's established live-verification practice): send a real message via the composer that
      causes the assistant to produce a `propose_dashboard` result, activate "Review proposal,"
      confirm it lands on `/proposals/review` with the correct proposal content, and confirm
      accepting it actually creates the dashboard — the exact same apply path today's dashboard
      proposals already use, now reached via a different producer. Implemented in the same e2e
      spec file — PASSED (real Claude tool call, real apply, dashboard visible in the sidebar).
- [x] 3.5 Confirm no stray references to `AuthoringChatDrawer`/`useDashboardAuthoringStream`/
      `sseMock` remain anywhere in the frontend (grep sweep) — no dangling imports, no dead doc
      comments pointing at deleted files left uncorrected where they'd mislead a future reader.
      Grep sweep found only historical/comparative doc comments in files explicitly out of scope to
      touch (`RefinementChatDrawer.tsx`, everything under `features/assistant/`) — left as-is; fixed
      the one present-tense factually-stale comment in `emptyWorkspaceCopy.ts` (not in the
      untouched-files list).
- [x] 3.6 `npm test` fully green; `npm run lint`/`npm run format:check`/`npm run build` clean

## 4. Fold-in addendum (post-delivery, before Phase 4 cleanup)

- [x] 4.1 Delete `AuthoringGoalRequest`/`AuthoringResult` interfaces from
      `frontend/src/features/dashboards/types/authoring.ts`
- [x] 4.2 Remove `AuthoringGoalRequest`/`AuthoringResult` from the import and the re-export line in
      `frontend/src/features/dashboards/services/authoringService.ts` — leave
      `fetchAuthoringConversation`/`postAuthoringOutcome` and the remaining re-exports untouched
- [x] 4.3 Grep sweep: confirm zero remaining references to either name anywhere in `frontend/src`
- [x] 4.4 `npm test` / `npm run lint` / `npm run format:check` / `npm run build` clean
