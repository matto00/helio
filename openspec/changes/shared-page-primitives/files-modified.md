# Files modified — HEL-725

## New primitives

- `frontend/src/shared/ui/PageShell.tsx` / `.css` / `.test.tsx` — canonical page container (DESIGN.md §6 padding/gap tokens).
- `frontend/src/shared/ui/PageHeader.tsx` / `.css` / `.test.tsx` — title/eyebrow/actions/back-link header. Cycle 2 (CR6): the back affordance now renders a real accessible name (`aria-label="Back"`) and uses react-router's `Link` for `backTo` (SPA transition, not a full document navigation) / a `<button>` for `onBack`; added `backTo` and `onBack`-precedence test cases.
- `frontend/src/shared/ui/PageStatus.tsx` / `.css` / `.test.tsx` — page-level loading/error primitive (DESIGN.md §7). Cycle 2 (CR3): added a `size?: "page" | "section"` prop — `"section"` renders a compact inline text row (mirroring each pre-migration section's own hand-rolled markup) instead of the full-page `EmptyState` hero, for independently-gated sub-sections like `SettingsPage`'s three F-047 sections. Also added `secondaryCta` pass-through (cycle 1, used by `ProposalReviewPage`/`PatchSetReviewPage`).
- `frontend/src/shared/ui/index.ts` — exports the three new primitives.

## Migrated routes

- `frontend/src/features/sources/ui/SourcesPage.tsx` + `.css` — `PageShell`/`PageHeader`/`PageStatus` (`variant="skeleton"`). Cycle 2 (CR4/CR5): deleted the now-dead `.sources-page__header` rule and the `.sources-page` container-geometry declarations (`display`/`flex-direction`/`gap`/`padding`/`min-height`) that `.page-shell` now owns.
- `frontend/src/features/pipelines/ui/PipelinesPage.tsx` + `.css` — same treatment as Sources; same cycle-2 CSS cleanup (`.pipelines-page__header`, container geometry).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — `PageShell`/`PageStatus` on the loading/error early returns only (no `PageHeader`, per design.md Decision 4). Cycle 2 (CR2): the **resolved-content return** no longer uses `PageShell` — reverted to a plain `<div className="pipeline-detail-page">` so the route's own full-bleed layout (chip header + `__footer-region` flush to the container edges, the HEL-719 design) is preserved; `PageShell`'s section-overview padding/gap was never appropriate for this route's layout.
- `frontend/src/features/assistant/ui/ChatPage.tsx` — `PageShell`/`PageStatus` (`variant="spinner"`). Cycle 2 (CR5): `ChatPage.css` deleted outright (its only rule was the container geometry `.page-shell` now owns, plus the already-deleted `.chat-page__loading`/`__error` from cycle 1) — no import remains.
- `frontend/src/features/settings/ui/SettingsPage.tsx` + `.css` — `PageShell`/`PageHeader`; **three independent `PageStatus` instances** (preferences, agent memory, API tokens — F-047 per-section gating preserved, design.md Decision 3a). Cycle 2 (CR3): all three now pass `size="section"` so a failed/loading section renders at its original compact inline scale instead of a page-scale hero.
- `frontend/src/features/patchSets/ui/PatchSetReviewPage.tsx` — `PageShell` around every return; loading/error branches converted to `PageStatus`. Cycle 2 (CR1): both the `loadError` and `previewError` `PageStatus` calls now pass `secondaryCta={{ label: "Back to dashboards", onClick: () => navigate("/") }}` — cycle 1 had dropped this escape action, stranding the user on a dead-end route.
- `frontend/src/features/dashboards/ui/ProposalReviewPage.tsx` — unchanged this cycle; already correct (`secondaryCta` preserved from cycle 1).
- `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalReviewPage.tsx` — unchanged this cycle.
- `frontend/src/features/proposals/ui/CombinedProposalReviewPage.tsx` — unchanged this cycle.

## Test-infrastructure fix (incidental, cycle 2)

- `frontend/src/theme/tokenAuditSweep.css.test.ts` — updated two stale baseline line numbers for `PipelinesPage.css` (98/99 → 85/86) after the CR5 CSS deletion shifted the file's remaining raw-spacing-literal lines up. Not a new finding, no policy change — a mechanical baseline re-pin.

## Out of scope (per design.md Decision 0, human-ruled)

`TypeRegistryPage`, `TypeDetailPage`, `MetricsPage`, `MetricDetailPage` are **not** touched — they are
deleted outright by HEL-909. Their CSS (`MetricsPage.css`, `MetricDetailPage.css`) still contains
loading/error rules; those are **intentionally left behind** for HEL-909 to delete as part of removing
the pages themselves — not an oversight of this change (tasks.md 5.4 / design.md Risk section).

## Root cause / probe (systematic-debugging Iron Law, cycle 2 fixes)

This cycle's changes are evaluator-report fixes, not independently-discovered bugs — each fix maps
1:1 to the evaluator's exact file/line finding in `evaluation-1.md`, so root cause is the evaluator's
own diagnosis in each case:

- **CR1** — root cause: the cycle-1 migration of `PatchSetReviewPage`'s two error branches to
  `PageStatus` dropped the `cta`'s "Back to dashboards" action because `PageStatus` was called without
  `secondaryCta`. Probe: evaluator's live-DOM check found no actionable element on either error screen.
  Fix confirmed by `PatchSetReviewPage.test.tsx` (14/14 pass) plus the pattern now matching
  `ProposalReviewPage`'s identical call shape.
- **CR2** — root cause: `PageShell`'s default `padding: var(--space-5) var(--space-6); gap: var(--space-7)`
  was applied to `PipelineDetailPage`'s resolved-content return, whose own CSS (`height: 100%;
  overflow: hidden`, no padding/gap) depends on flush edges for the HEL-719 footer-region design; equal
  CSS specificity meant import order (not intent) decided the result. Probe: evaluator's computed-style
  measurement (`padding: 20px 24px; gap: 32px` where `main` has none). Fix: dropped `PageShell` from
  that one return path; `PipelineDetailPage.test.tsx` (119/119) still passes.
- **CR3** — root cause: `PageStatus` had only one rendering scale (the full-page `EmptyState` hero), so
  `SettingsPage`'s three independently-gated sections (correct per Decision 3a) each rendered a ~350px
  hero instead of the original one-line inline message. Probe: evaluator drove a live section-fetch
  failure and measured the rendered height/copy. Fix: added `size="section"`; `SettingsPage.test.tsx`
  (9/9) and `PageStatus.test.tsx` (5/5) pass.
- **CR4/CR5** — root cause: task 5.1 in cycle 1 checked for *loading/error* selectors only, missing the
  now-dead `__header` rules and the duplicated container-geometry declarations that `.page-shell` now
  also supplies on the same element. Probe: evaluator's grep found zero `.tsx` references to
  `.sources-page__header`/`.pipelines-page__header`, and diffed the byte-identical geometry block against
  `PageShell.css`. Fix: deleted the dead rules; deleted `ChatPage.css` outright (nothing left to keep).
- **CR6** — root cause: `PageHeader`'s back affordance used a bare `<a href>` with a bare `←` text node
  as its only accessible name, and performed a full document navigation for the `backTo` path (no
  react-router integration). Probe: evaluator's accessible-name computation + `backTo`'s absence from
  any test. Fix: `aria-label="Back"` plus a real `Link`/`button` split; two new `PageHeader.test.tsx`
  cases pin both the `backTo` `Link` shape and `onBack`-over-`backTo` precedence.

## Verification evidence (cycle 2, fresh)

- `npm run lint` — 0 warnings/errors.
- `npm run typecheck` — clean.
- `npm test` — 274 suites / 2960 tests passed (2 more than cycle 1: the two new `PageHeader.test.tsx` cases).
- `npm run format:check` — all files match Prettier style.
- `npm --prefix frontend run build` — production build succeeds.
