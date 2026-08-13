## Evaluation Report — Cycle 2 (evaluation-2.md)

Resumed from cycle 1 (evaluation-1.md, FAIL). Re-read the diff and the new commit
(`fe93f112 "HEL-395 Fix: add missing CSRF header to the streaming authoring POST"`) only —
ticket/proposal/design/tasks re-read skipped per resumability rules (planning artifacts stable).

### Phase 1: Spec Review — PASS

- The AC that failed in cycle 1 ("A user can open an in-app chat surface, type a goal, and see a
  streamed response") is now **genuinely satisfiable end-to-end**, confirmed live (see Phase 3):
  a real goal submission reached a real Claude call, returned a real validated `DashboardProposal`,
  and landed in the review UI with zero console errors.
- All other cycle-1 Phase 1 findings still hold (task list matches implementation, no scope creep,
  no regressions, no schema changes needed, D4 hard constraint intact).
- design.md now carries a D2 addendum documenting the CSRF-header gap for future raw-`fetch`
  streaming-POST hooks — directly closes the planning-artifact gap identified in cycle 1 (the
  original design never called out that a POST, unlike the GET-only `usePipelineRunEvents`
  precedent, needs this header).

### Phase 2: Code Review — PASS

Gates (fresh run, this worktree, at commit `fe93f112`):
- `npm run lint` — PASS (0 warnings)
- `npm run format:check` — PASS
- `npm test` — PASS (150 suites / **1525** tests, one more than cycle 1's 1524 — the new CSRF-header
  regression test)
- `npm --prefix frontend run build` — PASS (same pre-existing >500kB chunk-size advisory, unrelated)

Fix verified against source, not just the commit message:

- `frontend/src/features/dashboards/hooks/useDashboardAuthoringStream.ts:81` now reads
  `headers: { "Content-Type": "application/json", "X-Helio-Requested-With": "1" }` — exactly the
  prescribed change request #1, with a doc comment explaining why (mirrors `httpClient.ts`'s
  default, since this hook bypasses `httpClient` for streaming).
- The new regression test (`useDashboardAuthoringStream.test.ts`, "sets the CSRF header
  (X-Helio-Requested-With) on the streaming POST") asserts the **actual header value** on the
  real `fetchMock.mock.calls[0]` init object (`init.headers["X-Helio-Requested-With"]).toBe("1")`)
  — this is a genuine assertion, not a tautology: it reads the header back off the call the hook
  itself made, so removing the header from the fetch call (reverting the fix) would fail this test.
  Confirmed by inspection this is not asserting against a hardcoded/mocked value independent of the
  hook's own behavior. The pre-existing "POSTs {goal}" test's header expectation was also updated
  to match, so both tests now agree with the real implementation.
- No other files changed in this cycle's commit besides the hook, its test, and the design.md
  addendum — `AuthoringChatDrawer.tsx`, `DashboardList.tsx`, and everything else reviewed in cycle 1
  is byte-identical (`git diff 9b71fd5a fe93f112 --stat` touches exactly 3 non-report files), so
  cycle 1's clean findings on DESIGN.md/CONTRIBUTING.md compliance, DRY, type safety, and the
  retry-after-error fix all still hold unchanged.

### Phase 3: UI Review — PASS

Dev servers reused (already healthy from cycle 1 — `PASS servers` via `assert-phase.sh`); frontend
is Vite dev server with HMR, so it picked up the fix without a restart (confirmed by the request
result below, not assumed).

**Live re-attempt of the exact flow that 403'd in cycle 1** (real dev account session, real
`ANTHROPIC_API_KEY` configured in this worktree's `backend/.env`, DEV_PORT=5827,
BACKEND_PORT=8734):

1. Opened the drawer via "Author dashboard with AI", typed "Show total profit over time as a line
   chart", clicked "Generate proposal".
2. Network log: `POST http://localhost:5827/api/authoring/dashboard?stream=true => 200 OK` (was
   `403` in cycle 1 with the identical goal/flow).
3. Zero console errors, zero console warnings for the entire flow (cycle 1 had exactly one error,
   the 403).
4. The app navigated to `/proposals/review` and rendered a **real, Claude-authored, validated**
   proposal via the completely untouched `ProposalReview.tsx`/`ProposalReviewPage.tsx`: dashboard
   name "Profit Over Time", one chart panel "Total Profit Over Time" bound to DataType "Profit"
   (mapping `xAxis → date`, `yAxis → profit`, layout `x0 y0 · 12×8`), with "Nothing is created
   until you accept. Edit titles, remove panels, or reject." and Reject/Accept & create controls —
   this is the real AC path working end-to-end, not a stubbed reproduction.
5. Confirmed via network log (`filter=apply`) that **no apply-proposal request was made** at any
   point — nothing is written until the user would explicitly accept, which I did not trigger
   (accepting would create a real dashboard/panel, out of scope for verification once the hand-off
   to the review UI is already confirmed).
6. All cycle-1 Phase 3 findings that didn't depend on the CSRF defect remain valid and unchanged
   (D4 file-diff check re-confirmed empty; breakpoints 1440/1100/768/430; Escape-to-close;
   accessible names; DESIGN.md token/accent discipline; streaming progress shows indeterminate
   "Composing your dashboard…" activity, never raw JSON — re-observable in step 1 above since the
   real stream also passes through `authoring-progress` events before the terminal result).

### Overall: PASS

### Non-blocking Suggestions

- None new this cycle. Cycle 1's suggestion (documenting the raw-fetch-needs-CSRF-header gap in
  design.md for future hooks) was already acted on as part of the fix, not merely deferred.
