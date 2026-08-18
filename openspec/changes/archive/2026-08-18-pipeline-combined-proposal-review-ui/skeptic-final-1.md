## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Ground truth re-established independently of the evaluator.** Read `ticket.md`,
  `proposal.md`, `design.md` (Decisions D1–D8), `tasks.md`,
  `specs/pipeline-proposal-review-ui/spec.md`, `evaluation-1.md`, `workflow-state.md`, and
  `git diff main...HEAD --stat` (34 files, +2648/-36) directly from disk in the worktree —
  none of my conclusions below are taken from the evaluator's narrative without independent
  confirmation.

- **Wire-shape parity (AC: "mirror the two shipped precedents").** Read
  `backend/src/main/scala/com/helio/api/protocols/PipelineProposalProtocol.scala` and
  `CombinedProposalProtocol.scala` directly and diffed field-for-field against
  `frontend/src/features/pipelines/types/pipelineProposal.ts` and
  `frontend/src/features/proposals/types/combinedProposal.ts`. `PipelineProposalSource`'s
  flat-optional shape (D5), the loose `PipelineProposalStep` (D4), and
  `CombinedProposalApplyResponse.dashboard: AppliedProposal` vs. the backend's
  `DuplicateDashboardResponse(dashboard, panels)` (confirmed byte-shape-identical by reading
  `DashboardProtocol.scala:35,210`) all check out. Endpoint paths confirmed by grep:
  `pathPrefix("pipelines") { path("apply-proposal")` and `pathPrefix("proposals") { path("apply")`
  match `pipelineProposalService.ts`/`combinedProposalService.ts` exactly. Sentinel string
  `"$pipelineOutput"` (`CombinedProposalService.scala:111`) matches
  `CombinedProposalReview.tsx`'s special-case, confirmed live (see below).

- **D7 dual-dispatch fix present in code, not just claimed.** Read
  `frontend/src/features/proposals/state/combinedProposalsSlice.ts:32-45` — `applyCombinedProposal`
  dispatches both `dashboardUpserted(...)` and `setSelectedDashboardId(...)` on success, exactly as
  design.md D7 (the round-1 skeptic-design fix) specifies.

- **D8 read-only dashboard-half fix present in code, not just claimed.** Live-rendered
  `/combined-proposals/review`: the dashboard half renders plain text ("Total value", "metric",
  "Data type: This pipeline's own output", "Mapping: value → value, label → label") with no
  title-edit textbox or remove-panel button, unlike `/proposals/review`'s dashboard-only flow
  (editable `textbox "Panel 1 title"` + `button "Remove panel..."`, confirmed by live comparison
  screenshot of both routes). `ProposalReview.tsx` is untouched in the diff — confirmed.

- **Gates re-run fresh, not merely trusted from evaluation-1.md:**
  - `npm run lint` (frontend) — pass, zero warnings, re-run myself.
  - `npx jest --testPathPatterns="PipelineProposal|CombinedProposal|ProposalHandoff|pipelinesSlice|combinedProposalsSlice"`
    — 7 suites / 100 tests, all pass, re-run myself.
  - Backend gates: N/A, diff touches no `backend/**` files (confirmed by `git diff --stat`).

- **Live UI verification (DEV, port 6171/9078, `assert-phase.sh servers` → `PASS servers`).**
  Logged-in session already present. Navigated to `/pipeline-proposals/review` and
  `/combined-proposals/review` (DEV demo fixtures render, per F-002). Both pages render
  correctly: source/steps/output for the pipeline half, nested pipeline+dashboard for the
  combined half, Accept/Reject footer, `"$pipelineOutput"` sentinel correctly special-cased as
  "This pipeline's own output" (not a raw id or lookup miss) — Risk 1/D8 confirmed working.
  Verified in both dark and light theme (toggled via `localStorage['helio-theme']` + reload) —
  no hardcoded-color/contrast issues in the new CSS, consistent with `ProposalReview.css`'s
  existing token usage.

### A REFUTE-worthy defect found independently (not in evaluation-1.md)

**The two new routes are missing from `frontend/src/shared/chrome/sections.ts`, the single
route/section registry that HEL-724 (commit `6ba9988b`, merged to `main` *before* this ticket's
branch point) established as "the single source of truth for every route the authenticated shell
renders" — driving the desktop breadcrumb, `document.title`, and the sr-only accessibility `<h1>`
heading for every route inside `AppShell`.**

Both `/pipeline-proposals/review` and `/combined-proposals/review` are nested inside `<AppShell>`
in `AppRoutes.tsx` (same as `/proposals/review` and `/patch-sets/review`), but neither route was
added to the `sections` array in `frontend/src/shared/chrome/sections.ts`. Since
`sectionLabel()`/`sectionForPathname()` fall back to `"Dashboards"` for any unregistered pathname
(`sections.ts:163`), and neither new `ReviewPage` component sets its own title/heading (confirmed
by reading `PipelineProposalReviewPage.tsx`/`CombinedProposalReviewPage.tsx` in full — both are
pure route containers with no `document.title`/heading logic of their own, exactly mirroring
their precedents' structure), the shell chrome silently mislabels both new pages.

**Live-verified, side-by-side against the working precedent:**

| Route | Breadcrumb (visible, `app-command-bar__breadcrumb`) | `document.title` | sr-only `<h1>` |
|---|---|---|---|
| `/proposals/review` (existing, registered) | "Review Proposal" | "Review Proposal · Helio" | "Review Proposal" |
| `/pipeline-proposals/review` (new, HEL-739) | **"Dashboards"** | **"Dashboards · Helio"** | **"Dashboards"** |
| `/combined-proposals/review` (new, HEL-739) | **"Dashboards"** | **"Dashboards · Helio"** | **"Dashboards"** |

This is not a cosmetic nitpick — it is the *exact same bug class* HEL-724 (PR #382) explicitly
fixed for `/proposals/review`/`/patch-sets/review`/`/settings`, and the codebase carries a named
regression test guarding against precisely this recurrence:
`frontend/src/shared/chrome/sections.test.ts:61-73` —
`"gives /settings, /proposals/review, and /patch-sets/review each a distinct, non-'Dashboards'
label"`, with the comment *"The direct fix for the 'review routes had no section' bug (PR #382) —
these three used to all silently fall through breadcrumbLabel's default case to 'Dashboards'."*
HEL-739 reintroduces that identical, already-named bug for its two new sibling routes, and this
existing regression test was not extended to cover them (its `expected` array at
`sections.test.ts:16-25` still lists only 9 routes; it should be 11).

None of the planning artifacts (`design.md`, `tasks.md`, `proposal.md`) mention `sections.ts`
anywhere (grepped, zero matches) — this integration point was never on the plan, and the two
prior skeptic-design rounds (`skeptic-design-1.md`, `skeptic-design-2.md`) didn't catch it
either. `evaluation-1.md`'s Phase 3 UI review screenshotted the modal content at four breakpoints
but never looked at the breadcrumb/tab-title chrome around it, so it also missed this.

The ticket's own scope item 3 — "Add the new route(s) to `AppRoutes.tsx` **alongside the
existing** `/proposals/review` and `/patch-sets/review` entries" — is only half satisfied:
the route is registered in `AppRoutes.tsx`, but not in the parallel, equally-necessary
`sections.ts` registry that gives those existing entries their correct chrome.

### Verdict: REFUTE

### Change Requests

1. **Add two entries to `frontend/src/shared/chrome/sections.ts`'s `sections` array**, mirroring
   the existing `/proposals/review`/`/patch-sets/review` entries exactly (`pickerId: "other"`,
   `showInNav: false`), e.g.:
   ```ts
   { path: "/pipeline-proposals/review", pickerId: "other", label: "Review Pipeline Proposal", showInNav: false },
   { path: "/combined-proposals/review", pickerId: "other", label: "Review Proposal", showInNav: false },
   ```
   (exact label wording is an implementer judgment call — just needs to be distinct and
   non-"Dashboards", consistent with the sibling entries' phrasing.)
2. **Extend `frontend/src/shared/chrome/sections.test.ts`** — add the two new routes to the
   `expected` array (line 16-25, now 11 routes not 9) and to the
   `"gives ... each a distinct, non-'Dashboards' label"` test (line 61-73), so this exact
   regression class stays guarded for all five "other"-picker review routes, not three.
3. **Re-verify live** after the fix: breadcrumb, `document.title`, and the sr-only `<h1>` on both
   `/pipeline-proposals/review` and `/combined-proposals/review` must read a real label, not
   "Dashboards" — screenshot or accessibility-snapshot both routes to confirm before re-submitting.

### Non-blocking notes

- `evaluation-1.md`'s non-blocking observation about `PipelineProposalApplyResponse.run` being
  typed optional (`run?: Record<string, unknown>`) when the backend field is actually required —
  confirmed accurate (`PipelineProposalProtocol.scala:49`, `jsonFormat4` with no `Option`), and
  genuinely harmless since the field is unused by this UI. Worth fixing alongside the change
  requests above but not blocking on its own.
- Once Change Request 1 is applied, double check `CommandBar.tsx`'s `mobileTitleVisible = pickerId
  !== "other"` still correctly hides the phone-only title switcher for both new routes (it will,
  since `pickerId: "other"` is unchanged by this fix) — flagging only so the fix isn't
  over-corrected into also changing `pickerId`.
