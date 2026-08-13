## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — FAIL

Issues:

- AC "A user can open an in-app chat surface, type a goal, and see a streamed response" is
  **not actually satisfiable end-to-end** for any real, session-cookie-authenticated user — see
  Phase 2/3 for the root cause (missing CSRF header on the streaming `fetch` POST). The code
  *looks* like it implements the flow, and the mocked unit/RTL tests pass, but the live app 403s
  on the very first real submission. This is a reinterpretation-by-omission of the AC: it reads
  as satisfied from the diff/tests alone but is not true in the running app.
- All other checklist items pass:
  - Task list (tasks.md) matches what was implemented — verified each task item against the diff.
  - No scope creep — diff is limited to the new chat surface + one entry-point wiring change in
    `DashboardList.tsx`/`.css`, exactly per proposal.md's "Impact" section.
  - No regressions to existing behavior: `ProposalReviewPage.test.tsx` / `ProposalReview.test.tsx`
    pass unmodified (confirmed via a fresh `npm test` run — 150/150 suites, 1524/1524 tests).
  - No schema/API contract changes needed or made (consumes an already-shipped endpoint) — correct
    per proposal.md's "Impact" section.
  - Planning artifacts (design.md D1–D5) accurately describe the implemented structure; the one gap
    is that design.md's D2 never calls out that the POST (unlike the GET-only
    `usePipelineRunEvents` precedent it mirrors) needs the app's CSRF header — an omission in the
    design that surfaced as the code-level defect below.

### Phase 2: Code Review — FAIL

Gates (fresh run, this worktree, frontend-only diff):
- `npm run lint` — PASS (0 warnings)
- `npm run format:check` — PASS
- `npm test` — PASS (150 suites / 1524 tests)
- `npm --prefix frontend run build` — PASS (only the pre-existing >500kB chunk-size advisory,
  unrelated to this diff)

Issues:

1. **[BLOCKING] Missing CSRF header on the streaming POST — breaks the feature for every real
   session-authenticated user.** `frontend/src/features/dashboards/hooks/useDashboardAuthoringStream.ts:78-84`:
   ```ts
   response = await fetch(`${AUTHORING_DASHBOARD_ENDPOINT}?stream=true`, {
     method: "POST",
     credentials: "include",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ goal }),
     signal: controller.signal,
   });
   ```
   `backend/src/main/scala/com/helio/api/AuthDirectives.scala:171-183` (`requireCsrfHeader`)
   rejects every non-`GET` request that carries the `helio_session` cookie unless it also carries
   `X-Helio-Requested-With: 1`. `frontend/src/services/httpClient.ts:15` sets this header by
   default on every axios request — that's why every other mutating call in the app (dashboard
   create, panel update, etc.) works. `useDashboardAuthoringStream` bypasses `httpClient` (by
   design, per design.md D2 — raw `fetch` is required for streaming) but never adds the header
   itself, so the one real difference from its `usePipelineRunEvents` precedent (`POST` vs `GET`,
   which the CSRF directive explicitly exempts) is exactly where it breaks.
   **Live-reproduced, not theoretical**: see Phase 3 below — the real dev backend 403s the
   unmodified request and 200s the identical request once `X-Helio-Requested-With: 1` is added.
   **Fix**: add `"X-Helio-Requested-With": "1"` to the `headers` object at line 81.
2. Tests do not catch #1: `useDashboardAuthoringStream.test.ts` and `AuthoringChatDrawer.test.tsx`
   both mock `global.fetch` (`frontend/src/test/sseMock.ts`), so a missing header never fails the
   mock the way it fails the real backend's `requireCsrfHeader` directive. Recommend a test
   asserting the CSRF header is present on the outgoing request (mirroring
   `httpClient.test.ts`'s own "sets the CSRF header by default" assertion), which would have
   caught this before it reached a human/live review.

Everything else reviewed clean:
- **CONTRIBUTING.md**: no inline FQNs, all new files under the ~250-line soft budget
  (`useDashboardAuthoringStream.ts` 202, `AuthoringChatDrawer.tsx` 192), imports at top of file,
  no `any`.
- **DESIGN.md [mechanical]**: `AuthoringChatDrawer.css` uses only `--app-*`/`--space-*`/`--text-*`/
  `--control-*`/`--app-radius-*` tokens throughout — no hardcoded hex/rgb, no ad-hoc font-family,
  no numeric font-weight literals, no non-token control heights. Reuses `Textarea`, `InlineError`,
  `useOverlay` (matches `MobileNavSheet`'s non-native-`<dialog>` overlay convention) rather than
  hand-rolling. `width: min(420px, calc(100vw - 32px))` and `min-height: 96px` literal-px usages
  match existing precedent exactly (`Modal.css:37`, `inputs.css:57`).
- **DRY**: `sseMock.ts` is a genuine extraction/generalization of `usePipelineRunEvents.test.ts`'s
  local mock helper, reused by both new test files rather than duplicated.
- **Type safety**: no untyped escape hatches; SSE payloads are cast via `as` at the JSON.parse
  boundary consistent with the existing `usePipelineRunEvents` precedent, wrapped in try/catch.
- **Error handling**: connection failure, non-SSE response, terminal `authoring-error`, and stream
  drop are all distinct, surfaced states — nothing is silently swallowed.
- **The self-reported "stale error after Try again" bug fix is real and genuinely tested.**
  `AuthoringChatDrawer.tsx:46-47` gates `phase` on `submittedGoal === null` before consulting
  `inlineError`:
  ```ts
  const phase: Phase =
    submittedGoal === null ? "idle" : inlineError !== null ? "error" : "streaming";
  ```
  The hook only resets `error`/`connectionError` at the *start* of the next connection (inside
  `connect()`), never when `active` flips to `false` — so after "Try again" (`handleReset` sets
  `submittedGoal` back to `null`), the previous attempt's error is still sitting in hook state.
  Verified by hand that checking `inlineError` before `submittedGoal === null` (the described
  buggy order) would keep `phase === "error"` after the reset, which would fail the
  `AuthoringChatDrawer.test.tsx:138-157` ("lets the user retry after an error") assertions —
  `getByRole("button", {name: "Generate proposal"})` wouldn't render and the goal textarea would
  stay `disabled` — so this is a real regression test, not one that would pass either way.
- **No dead code / no over-engineering**: no leftover TODOs; `progressText` is exposed on the hook
  but deliberately unused by the drawer per design.md's Risk note (documented, not orphaned).

### Phase 3: UI Review — FAIL

Dev servers started via `scripts/concertino/start-servers.sh` / `assert-phase.sh` — both healthy
(`PASS servers`).

1. **D4 hard constraint — CONFIRMED.** `git diff main...HEAD -- frontend/src/features/dashboards/ui/ProposalReviewPage.tsx frontend/src/features/dashboards/ui/ProposalReview.tsx frontend/src/features/dashboards/state/dashboardsSlice.ts` produces **zero output** — all three files are byte-for-byte untouched.
2. **Retry-after-error fix — CONFIRMED** (see Phase 2 above; verified against source, not just the test).
3. **Streaming progress state — CONFIRMED visually.** Live-reproduced the real backend 403 first
   (see #5 below), then used a page-level `window.fetch` stub (test double injected via
   `browser_evaluate` — no app source touched) to simulate the real SSE event sequence
   (`authoring-progress` with a raw `{"dashboardName":"Sales` fragment → `authoring-status`
   `"repairing"` → `authoring-result`). Screenshots confirm: during progress, the drawer shows only
   an indeterminate spinner + "Composing your dashboard…" — the injected raw JSON fragment never
   appears anywhere in the DOM. On the status event, the text updates to "Repairing…". On the
   terminal result, the app navigated to `/proposals/review` with `location.state.proposal` set to
   the exact proposal object, and `ProposalReviewPage.tsx`'s own pre-existing empty-panels branch
   rendered correctly (my stub proposal had `panels: []`) — confirming the hand-off shape is
   exactly what that untouched component expects.
4. **DESIGN.md [judgment] first pass**: drawer follows the "curated instrument" language well —
   opaque dark surface, hairline border, accent used only on the primary button/focus ring, no
   accent bleeding into structural chrome, Fraunces not used for body copy, one entrance animation.
   No violations spotted; deferring final subjective sign-off to the skeptic per this agent's
   charter.
5. **[BLOCKING] Live reproduction of the CSRF defect.** Typed a real goal and clicked "Generate
   proposal" against the live dev backend (a real `ANTHROPIC_API_KEY` is configured in this
   worktree's `backend/.env`): the drawer surfaced "Unexpected response: 403" with a "Try again"
   button (the `connectionError` path handled the symptom gracefully — no blank screen, no
   unhandled exception — but the underlying request never succeeds). Confirmed root cause directly
   in-browser: the exact same POST body/credentials, re-issued via `fetch` with
   `"X-Helio-Requested-With": "1"` added, returned `200`/`text/event-stream`; without it, `403`.
   One console error per attempt (the failed fetch), consistent with this single root cause.
6. **Breakpoints** — resized to 1440 / 1100 / 768 / 430 (canonical set) with the drawer open at
   each: no layout breakage, drawer stays within `min(420px, 100vw-32px)`, backdrop covers the
   full viewport, no horizontal scroll, no clipped controls.
7. **Keyboard / accessibility**: `Escape` closes the drawer (via the shared `useOverlay` primitive)
   — confirmed by snapshot before/after. All interactive elements have accessible names ("Author
   dashboard with AI", "Author a dashboard with AI" dialog, "Dashboard goal" textbox, "Close",
   "Generate proposal", "Cancel", "Try again").
8. Entry point: single documented entry point (design.md D5), confirmed reachable and opens the
   drawer.
9. No `applyProposal`/apply-endpoint call observed anywhere in the chat surface's own flow, in
   either the real 403 path or the stubbed-success path (network request log inspected both
   times).

### Overall: FAIL

### Change Requests

1. **(Blocking)** Add the CSRF header to the streaming POST in
   `frontend/src/features/dashboards/hooks/useDashboardAuthoringStream.ts:81` — change
   `headers: { "Content-Type": "application/json" }` to
   `headers: { "Content-Type": "application/json", "X-Helio-Requested-With": "1" }` (matching
   `frontend/src/services/httpClient.ts:15`'s default and satisfying
   `backend/src/main/scala/com/helio/api/AuthDirectives.scala:171-183`'s `requireCsrfHeader`).
   Without this, the feature 403s for every real user on first submit — this is the single
   highest-priority fix for the next cycle.
2. Add a test asserting the outgoing `fetch` call in `useDashboardAuthoringStream.test.ts` includes
   `"X-Helio-Requested-With": "1"` in its headers (mirroring
   `frontend/src/services/httpClient.test.ts:21-23`'s existing "sets the CSRF header by default"
   assertion), so a future regression here fails the unit suite instead of only surfacing in a live
   browser.

### Non-blocking Suggestions

- Once fixed, consider a short note in design.md flagging that any future raw-`fetch` hook mirroring
  `usePipelineRunEvents`/`useDashboardAuthoringStream` for a non-`GET` method must add the CSRF
  header explicitly, since `httpClient`'s automatic handling doesn't cover raw `fetch` call sites —
  this is exactly the kind of one-off gap that will recur for the next streaming-POST hook otherwise.
