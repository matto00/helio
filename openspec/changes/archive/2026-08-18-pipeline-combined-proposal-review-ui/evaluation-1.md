## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Compared implementation against `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
`specs/pipeline-proposal-review-ui/spec.md`.

- All ticket ACs addressed: pipeline proposal review page (source/steps/output, Accept/Reject),
  combined proposal review page (nested pipeline + read-only dashboard half, single Accept/Reject),
  `ProposalHandoff.tsx` wired for `pipeline`/`combined` kinds, new routes registered in
  `AppRoutes.tsx` alongside `/proposals/review`/`/patch-sets/review`, lazy-loaded per plan.
- No AC reinterpreted. The ticket's "consider surfacing" `analyze` preview was explicitly declined
  with a documented reason (design.md D2 — no id exists on an unapplied proposal to analyze) and
  carried into "Not in Scope" in `proposal.md`; this is a disclosed scope decision, not silent
  reinterpretation.
- All 26 `tasks.md` items marked `[x]` and verified against the diff — each maps to a real,
  present file/behavior (see file-by-file check below); no task claimed done that isn't.
- No scope creep: diff touches only the planned new files, `ProposalHandoff.tsx`/`.css`/test,
  `AppRoutes.tsx`, `pipelinesSlice.ts` (additive thunk only), `store.ts` (one reducer
  registration). `ProposalReview.tsx` is untouched, matching design.md D8's explicit non-goal.
- No regressions found: `dashboard`/`patch` branches of `ProposalHandoff.tsx` are unchanged
  (diff confirms only the `pipeline`/`combined` branches and the dead `--info` card were touched);
  full frontend test suite (2287 tests) passes.
- No API contract changes — both backend routes (`POST /api/pipelines/apply-proposal`,
  `POST /api/proposals/apply`) are reused verbatim, confirmed by reading
  `PipelineProposalProtocol.scala`/`CombinedProposalProtocol.scala`/`PipelineProposalRoutes.scala`/
  `CombinedProposalRoutes.scala` directly — new frontend types (`pipelineProposal.ts`,
  `combinedProposal.ts`) match the wire shapes field-for-field (including the `source: Option[...]`
  vs. `run: RunResultResponse` (non-Option) asymmetry — see non-blocking note below).
- Planning artifacts (design.md decisions D1–D8, Risk 1/2) match the final implementation exactly,
  including the two skeptic-round fixes called out inline (D7's dual dispatch, D8's new read-only
  JSX instead of reusing `ProposalReview.tsx`) — both verified present in the actual code, not just
  claimed in comments.

### Phase 2: Code Review — PASS

**Gates (fresh run, `WORKTREE_PATH`, no `CLEAN_WORKTREE`):**
- `npm run lint` — pass, zero warnings.
- `npm run format:check` — pass.
- `npm test` — pass, 217 suites / 2287 tests, 0 failures.
- `npm --prefix frontend run build` — succeeds; new routes code-split into their own small chunks
  (`PipelineProposalReviewPage-*.js` 1.82 kB, `CombinedProposalReviewPage-*.js` 3.41 kB gzip),
  consistent with the "lazy-loaded like `/proposals/review`" plan. The pre-existing >500kB chunk
  warning (`ChartPanel`/`index`) is unrelated to this change.
- Backend gates not run — diff touches no `backend/**` files.

**CONTRIBUTING.md / DESIGN.md mechanical compliance:**
- File-size budget: every new/touched source file is well under the ~250-line soft budget (largest
  new file is `CombinedProposalReviewPage.tsx` at 142 lines).
- No inline FQNs (frontend-only change; `check:scala-quality` N/A, and no Scala touched).
- Token discipline: spot-checked every custom property used in the three new/touched CSS files
  (`PipelineProposalReview.css`, `CombinedProposalReview.css`, `ProposalHandoff.css` diff) against
  `theme.css` — `--app-warning`, `--eyebrow-tracking`, `--font-mono`, `--weight-semibold`,
  `--weight-medium`, `--app-radius-pill`, `--app-surface-soft`, `--app-border-subtle`,
  `--text-micro` all exist with light/dark values. No hardcoded hex/rgba found. The only literal
  px values (`72px` flex-basis, `1px`/`2px` padding) are an exact byte-for-byte match of
  `ProposalReview.css`'s existing `dt`-column recipe (lines 112/118) — an established precedent,
  not a new violation, and within DESIGN.md's "≤4px optical tweaks may be literal" carve-out.
- Shared-component reuse (DESIGN.md §6): `Modal`, `InlineError`, `EmptyState` are reused, not
  reinvented; footer buttons use the canonical `ui-modal-btn`/`ui-modal-btn--primary/--secondary`
  classes from `Modal.css` (verified byte-identical class names to `ProposalReview.tsx`/
  `PatchSetReview.tsx`'s own usage). `ProposalHandoff.css`'s now-dead `.proposal-handoff--info`
  rule was correctly removed alongside its only two callers.
- DRY: `PipelineProposalSummary` is written once and reused unmodified inside
  `CombinedProposalReview` (confirmed by import, not a copy) — matches design.md's stated goal.
- Readable / modular: route-container-plus-pure-component split mirrors the two existing
  precedents exactly; no component exceeds a single clear responsibility.
- Type safety: `PipelineProposalStep`/`PipelineProposalSource`'s intentionally loose typing is
  explicitly justified in both design.md (D4/D5) and inline doc comments, and matches the
  backend's own `JsObject`-opaque `config` looseness — not an undocumented escape hatch. The
  `extraction.input as PipelineProposal`/`as CombinedProposal` casts in `ProposalHandoff.tsx`
  mirror the pre-existing `as DashboardProposal`/`as PatchSet` pattern already used for the other
  two kinds (source: `input: unknown` by design, per `proposalExtraction.ts`'s own documented
  rationale) — consistent, not a new pattern.
- Error handling: both apply thunks unwrap Axios errors into a user-facing string
  (`applyPipelineProposal`/`applyCombinedProposal`), both review pages display the error inline via
  `InlineError` and never navigate away on failure — verified live (see Phase 3).
- Tests: all seven planned test files present and meaningful — e.g.
  `combinedProposalsSlice.test.ts` asserts the exact dual-dispatch fix (D7) by inspecting
  `dispatch.mock.calls`, not just end state; `PipelineProposalReviewPage.test.tsx` covers empty
  state, render, accept+navigate, accept-error, reject — a real regression in any of these paths
  would fail the corresponding test.
- No dead code: no leftover TODO/FIXME, no unused imports (lint would have caught this; it's
  clean).
- No over-engineering: no new abstraction beyond what design.md scoped (e.g., no premature
  per-step-kind switch in `PipelineProposalSummary`, per D4's explicit reasoning for staying loose).
- Behavior-preserving: `ProposalHandoff.tsx`'s `dashboard`/`patch` branches are untouched; only the
  informational fallback for `pipeline`/`combined` was replaced, exactly as scoped.

**Non-blocking observation:** `PipelineProposalApplyResponse.run` is typed `Record<string,
unknown> | undefined` in `pipelineProposal.ts`, but the backend's `PipelineProposalApplyResponse`
has `run: RunResultResponse` as a required (non-`Option`) field — only `source` is actually
optional on the wire. Harmless today since the frontend type's own comment says `run` is
deliberately left untyped/unused, but the `?` on `run` doesn't reflect the real wire contract
precisely. Consider `run: Record<string, unknown>` (no `?`) if this type is ever extended.

### Phase 3: UI Review — PASS

Triggered by `frontend/**` changes. Started dev servers via
`scripts/concertino/start-servers.sh`/`assert-phase.sh` (`PASS servers`), tested live in the
browser (DEV build, port 6171).

- **Happy path — pipeline proposal:** `/pipeline-proposals/review` renders the DEV demo fixture
  (source, 0 steps, output DataType) correctly; clicking "Accept & create" actually created the
  pipeline, ran it, and navigated to `/pipelines/:id`, which showed "Succeeded" / "Rows written: 2"
  — full round-trip through the real backend apply-proposal route.
- **Happy path — combined proposal:** `/combined-proposals/review` renders both halves; the
  `"$pipelineOutput"` sentinel is correctly special-cased as "This pipeline's own output" (design.md
  Risk 1/D8), never as a raw id or lookup miss. Accepting created both the pipeline and the
  dashboard, navigated to `/`, selected the new dashboard (confirmed by page title "Demo proposed
  dashboard · Dashboards · Helio"), and the panel actually rendered live data (`10 / ALPHA`) —
  confirms `dashboardUpserted` + `setSelectedDashboardId` (D7) both fired correctly.
- **Unhappy paths:** Reject on the pipeline page navigated away with zero `applyPipelineProposal`
  calls (also confirmed by unit test). Accept-failure inline error display is covered by passing
  unit tests for both pages (`PipelineProposalReviewPage.test.tsx`,
  `CombinedProposalReviewPage.test.tsx`); the "Nothing to review" empty state (F-002, production
  behavior) is covered by a passing unit test that mocks `IS_DEV=false` — not independently
  re-verified in a production build in-browser, since DEV always supplies the demo fixture, but the
  test asserts the exact `EmptyState` render with no synthesized proposal and no dispatch, which is
  the behavior that matters.
- **No console errors** across either happy-path flow. (One 404 for
  `/api/pipelines/:id/schedule` appeared after pipeline creation — pre-existing, documented
  `PipelineDetailPage` behavior for "no schedule set yet," unrelated to this ticket and not a
  console *error* from this change's own code paths.)
- **Loading/empty/error states:** "Nothing to review" uses the shared `EmptyState` (`main` variant,
  matching precedent's implicit default); accept-error uses the shared `InlineError`.
- **Entry points:** `ProposalHandoff.tsx`'s "Review proposal" button → correct route + router state
  is unit-tested for both `pipeline` and `combined` kinds (`ProposalHandoff.test.tsx`); the
  destination pages were independently verified live in-browser as above. Reproducing the full
  live-LLM chat → propose_pipeline/propose_combined → handoff path end-to-end was not attempted (out
  of proportion for this review and not required — the navigation contract itself is what changed,
  and it's covered both by unit test and live destination-page verification).
- **Accessibility:** Both review buttons have accessible names ("Review proposal", "Accept &
  create", "Reject") confirmed via ARIA snapshot; the modal is a native `<dialog>` (via the shared
  `Modal` component) — `Escape` correctly closed it and triggered `onReject`'s navigation, verified
  live.
- **Breakpoints (1440 / 1100 / 768 / 430):** all four render without layout breakage or overflow —
  screenshotted the combined-proposal modal at each width; text wraps, no clipping, footer buttons
  stay reachable. (Modal itself is the shared, already-responsive primitive; only its content is
  new.)

### Overall: PASS

### Non-blocking Suggestions
- `PipelineProposalApplyResponse.run` (`frontend/src/features/pipelines/types/pipelineProposal.ts`)
  is typed optional (`run?: Record<string, unknown>`) though the backend's
  `PipelineProposalApplyResponse.run` is a required field (only `source` is actually `Option` on
  the wire, per `PipelineProposalProtocol.scala`). Harmless since the field is unused by this UI,
  but drop the `?` if this type is ever extended to read `run`.
