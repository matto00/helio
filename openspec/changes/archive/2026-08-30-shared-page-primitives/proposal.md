## Why

Every top-level route hand-rolls its own container div, header markup, and loading/error state, with
drifting CSS and inconsistent header spacing/title styling. This was explicitly flagged as a follow-up
during the beta UI/UX polish sweep (PR #382) and declined mid-sweep as out of scope. It is also now a
prerequisite: the rebuilt Pipeline page (HEL-908) and reworked Dashboard/Output-picker surfaces
(HEL-909) — both later rows of the Pipelines & Outputs remodel (HEL-903) — are meant to be built on
these primitives, not on another one-off container.

## What Changes

- Add `PageShell`/`PageHeader` to `shared/ui`: shared page container (padding tokens per DESIGN.md §3),
  optional Fraunces `.page-title`, optional eyebrow, optional back link, and an actions slot — replacing
  each route's own `<div className="X-page">` / `<header className="X-page__header">` markup.
- Add `PageStatus` to `shared/ui`: one component implementing DESIGN.md §7's loading (spinner/skeleton)
  and error (EmptyState `intent="error"`) states for a route's top-level fetch, replacing each route's own
  hand-rolled loading/error branches. **Verified ground truth (grep `page__loading|page__error` across
  `frontend/src/**/*.css`): exactly 4 files carry a duplicated recipe today** — `ChatPage.css`,
  `MetricsPage.css`, `MetricDetailPage.css`, `SettingsPage.css`. `SourcesPage.css`/`PipelinesPage.css`
  carry none (they already compose `PageContentSkeleton` + `EmptyState`). The ticket's "7 near-identical
  recipes" figure was the sweep's original estimate at filing time, not the current count.
- Migrate Sources, Pipelines, PipelineDetail, Chat, Settings, and all four review routes
  (`ProposalReviewPage`, `PatchSetReviewPage`, `PipelineProposalReviewPage`, `CombinedProposalReviewPage`)
  onto `PageShell`/`PageStatus` (header only where the route already has one — see Non-goals).
- **RESOLVED (human ruling): `TypeRegistryPage`, `TypeDetailPage`, `MetricsPage`, and `MetricDetailPage`
  are excluded from this change.** The ticket's leading note ("do not migrate... deleted by HEL-909") is
  the remodel-aware text; its own Scope list naming them was stale pre-remodel wording. The Pipelines &
  Outputs remodel spec (`docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md`, verified
  directly — line 168 lists these exact pages as removed outright, decision 11 states "no deprecation...
  deleted wholesale in the ticket that replaces them") makes these four pages dead code the moment
  HEL-909 lands; migrating them now would be throwaway review budget spent on code about to be deleted,
  and would make HEL-909's own deletion diff noisier. See `design.md` Decision 0.
- Delete the superseded per-page loading/error CSS for the two in-scope files (`ChatPage.css`,
  `SettingsPage.css`) once each route migrates. `MetricsPage.css`/`MetricDetailPage.css` are **not**
  exempted from ever being deleted — they are handed to HEL-909, which deletes those pages and their CSS
  outright; this obligation is tracked explicitly (tasks.md 5.4) and called out in the PR body so
  HEL-909's implementer inherits it.

## Capabilities

### New Capabilities

- `page-shell-primitives`: `PageShell`/`PageHeader` container+header primitives and the `PageStatus`
  loading/error primitive, plus the contract that the 9 listed surviving routes (3 with a PageHeader, 6 header-less — 2 non-review + 4 review) render through them.

### Modified Capabilities

(none — `loading-state-pattern`/`error-state-pattern`/`shared-skeleton` govern list-level and
form-level states that already exist and are unchanged; `PageStatus` is a distinct, page-level state
that composes `EmptyState`/`Spinner`, it does not alter their own requirements.)

## Impact

- New files: `frontend/src/shared/ui/PageShell.tsx`, `PageHeader.tsx`, `PageStatus.tsx`, plus CSS and
  tests, exported from `frontend/src/shared/ui/index.ts`.
- Modified: `SourcesPage`, `PipelinesPage`, `PipelineDetailPage`, `ChatPage`, `SettingsPage`,
  `ProposalReviewPage`, `PatchSetReviewPage`, `PipelineProposalReviewPage`, `CombinedProposalReviewPage`
  and their `.css` (deleting now-dead loading/error rules where present); no Redux, API, or schema
  changes.
- Not modified: `TypeRegistryPage`, `TypeDetailPage`, `MetricsPage`, `MetricDetailPage` — out of scope,
  handed to HEL-909.

## Non-goals

- Does not migrate `TypeRegistryPage`, `TypeDetailPage`, `MetricsPage`, or `MetricDetailPage` — see
  design.md Decision 0. HEL-909 deletes these pages outright.
- Does not change list-level skeleton/empty behavior governed by `loading-state-pattern`.
- Does not implement HEL-908/HEL-909 themselves — only the primitives they will consume.
- Does not force a `PageHeader` onto the four review routes, none of which render a title today
  (single-purpose hand-off screens) — see design.md Decision 4.
- Does not collapse `SettingsPage`'s three independently-gated sections (F-047) into one page-wide
  `PageStatus` — see design.md Goals and Decision 3a.

## Acceptance Criteria (corrected from ticket)

- One shared loading/error implementation (`PageStatus`) exists, and every listed page that **survives**
  the Pipelines & Outputs remodel uses it; the duplicated loading/error recipes in those surviving pages
  (`ChatPage.css`, `SettingsPage.css`) are deleted. `MetricsPage.css`/`MetricDetailPage.css` are handed to
  HEL-909 for deletion alongside the pages themselves, not deleted here (tracked in tasks.md 5.4).
- Page headers are visually consistent (title style, spacing, actions placement) across the 3 listed
  routes that render one today (Sources, Pipelines, Settings). `ChatPage` and `PipelineDetailPage` keep
  their existing header-less/bespoke-header shape in this ticket (design.md Decision 4 — adding a header
  to either would be new UI, not a migration); the four review routes remain header-less by design as
  well.
