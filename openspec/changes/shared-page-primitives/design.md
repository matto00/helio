## Context

Nine top-level routes are in scope. Verified header inventory (grep for `page-title|<h1|__header`
across all nine): only **three** render a title today — `SourcesPage.tsx:84`, `PipelinesPage.tsx:41-42`
(both `<h1 className="page-title">` inside a `__header` element), and `SettingsPage.tsx:45` (its own
`.settings-page__title` class, not `.page-title`). **`ChatPage` renders no header/title of any kind**
(`<div className="chat-page">` straight into content). **`PipelineDetailPage` also has no title/heading**
— it renders the bespoke `PipelineDetailHeader` chip row (source/type/schedule info, no `<h1>`/`<h2>`,
no back link) instead of a page title. The four review routes (`ProposalReviewPage`,
`PatchSetReviewPage`, `PipelineProposalReviewPage`, `CombinedProposalReviewPage`) also render no
header — full-content `EmptyState` only, since these are single-purpose hand-off screens.

So the real split is: **3 routes with a `.page-title`-shaped header today** (Sources, Pipelines,
Settings — the only ones that gain `PageHeader` in this ticket, see Decision 4), **2 non-review routes
with no title today** (Chat, PipelineDetail — kept header-less in this ticket, same Decision), and
**4 review routes** with no title (also kept header-less).

Two loading/error styles already coexist: `SourcesPage`/`PipelinesPage` use `PageContentSkeleton` +
`EmptyState intent="error"` (closest to the target end state, and already have **no** duplicated CSS to
delete); `ChatPage` and `SettingsPage` hand-roll raw loading/error markup with their own near-identical
CSS (`page__loading`/`page__error` rules — verified by grep, exactly these 2 files, not 7 as the
ticket's original filing-time estimate said); `SettingsPage` additionally gates per-section rather than
page-wide.

`TypeRegistryPage`, `TypeDetailPage`, `MetricsPage`, and `MetricDetailPage` are **excluded from this
change** (Decision 0 below) — they are dead code the moment HEL-909 lands, per the remodel spec
(`docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md`), and their own loading/error
CSS (`MetricsPage.css`, `MetricDetailPage.css`) is deleted wholesale by HEL-909 along with the pages
themselves, not migrated here.

The existing `loading-state-pattern`/`shared-skeleton`/`error-state-pattern` specs govern *list-level*
states (a `Skeleton`-shaped placeholder for a resolved-shape list, e.g. `PanelList`, `DashboardList`).
`PageStatus` is a different, page-level concern: whether the route's own top-level data is in flight or
failed *before* any list-level content exists to skeleton. The two compose: a page can pass
`PageStatus` for "is `PipelineDetailPage`'s pipeline itself loaded" while a nested list inside it still
uses `Skeleton` for its own rows.

## Goals / Non-Goals

**Goals:**
- One `PageShell`/`PageHeader` pair every listed route composes for its container and title/actions/back
  link, so header geometry cannot drift per-route again.
- One `PageStatus` component covering the loading/error half of DESIGN.md §7 at the page level, deleting
  the duplicated CSS recipes that exist in routes surviving the Pipelines & Outputs remodel.
- Preserve every route's existing *behavioral* nuance (retry semantics, per-section vs. page-wide
  gating, forbidden/not-found copy via `ERROR_KIND_ICON`) — this is a presentational consolidation, not a
  behavior change. `SettingsPage`'s deliberate per-section gating (F-047, each section renders regardless
  of another section's failure) is preserved via three independent `PageStatus` instances (one per
  section), not one page-wide instance — see Decision 3a.

**Non-Goals:**
- Not migrating `TypeRegistryPage`, `TypeDetailPage`, `MetricsPage`, or `MetricDetailPage` — see
  Decision 0. These are handed to HEL-909 as-is.
- Not changing `loading-state-pattern`'s list-level `Skeleton`/`PageContentSkeleton` contract —
  `PageStatus` may internally render a `Skeleton`-composed shape for a route that already has one
  (Sources, Pipelines), or the plain accent `Spinner` for a route that doesn't (Chat, Settings), matching
  each route's own pre-existing choice rather than forcing one look everywhere.
- Not adding new API calls, Redux state, or route changes.
- Not touching any review route's demo-fixture logic or apply/reject flow — only their container/status
  presentation. None of the four review routes gain a `PageHeader` (see Decision 4) since none renders a
  title today.
- Not adding a `PageHeader` to `ChatPage` or `PipelineDetailPage` in this ticket — neither renders a
  title today, so doing so would be new UI (an invented title string, and for `PipelineDetailPage` an
  unspecified interaction with the existing `PipelineDetailHeader` chip row), not a like-for-like
  migration. Both still adopt `PageShell`/`PageStatus`. See Decision 4.

## Decisions

0. **RESOLVED by human ruling (escalated during design gate round 1): exclude
   `TypeRegistryPage`/`TypeDetailPage`/`MetricsPage`/`MetricDetailPage` from this change.**
   `ticket.md`'s leading note ("do not migrate... they are deleted by HEL-909") is the remodel-aware
   text; its own Scope list, which named these routes for migration, is stale pre-remodel wording. The
   governing rule for this whole batch (per `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md`,
   verified directly): line 168 explicitly lists `TypeRegistryPage`/`TypeDetailPage`,
   `MetricsPage`/`MetricDetailPage`/`CreateMetricModal`/`MetricEditorForm` among the pages **removed
   outright** by the remodel, and decision 11 (line 40) states "No deprecation. Retired structures...
   are deleted wholesale in the ticket that replaces them — no shims, aliases, dual-read paths." Migrating
   these four pages onto new primitives now would be throwaway work spent on code HEL-909 deletes anyway,
   and would make HEL-909's deletion diff noisier (a migrated call site to unwind instead of a page to
   delete outright).

   **AC #1 is corrected, not gutted, to match:** "One shared loading/error implementation exists and
   every page that *survives* the remodel uses it; duplicated recipes in surviving pages are deleted."
   `ChatPage.css` and `SettingsPage.css` are the two in-scope deletions (verified — see Context).
   `MetricsPage.css`/`MetricDetailPage.css` are **not** exempted from ever being deleted; they are handed
   to HEL-909, which deletes the pages and their CSS outright as part of its own removal work (task 5.4
   below tracks this obligation so it isn't silently dropped, and the PR body records it so HEL-909's
   implementer inherits it).

   The real consumers of these primitives are the new Pipeline page (HEL-908) and the reworked dashboard
   surfaces (HEL-909) — the API is judged against the remodel spec's page structure, not against fitting
   two legacy pages that are about to disappear. A shell/header/status API that satisfies Sources,
   Pipelines, PipelineDetail, Chat, Settings, and the four review routes is sufficient scope for this
   ticket.

1. **Three components, one file each** (not one combined component): `PageShell.tsx`, `PageHeader.tsx`,
   `PageStatus.tsx` — a route may need `PageShell` without `PageHeader` (the four review routes) and
   `PageStatus` is meaningful even in a route that renders no `PageHeader` at all. Exported together from
   `shared/ui/index.ts`.

2. **`PageStatus` takes rendered content, not a full render-prop switch.** It renders only the
   loading/error branches; the route still renders its own resolved content unconditionally below/beside
   it, exactly as today's pattern already does (`{status === "loading" && <PageStatus .../>}` /
   `{status !== "loading" && status !== "failed" && <ResolvedContent/>}` at each call site) — this keeps
   the migration mechanical (swap the existing branch's markup for `<PageStatus>`, don't restructure
   control flow) and avoids `PageStatus` needing to know each route's resolved-content shape.

3. **Loading variant is a prop, not auto-detected**: `PageStatus` accepts an optional `variant?: "spinner"
   | "skeleton"` (default `"spinner"`); a route with an existing shape-matched skeleton (Sources,
   Pipelines) passes `variant="skeleton"` and its own skeleton component as `children` when
   `status="loading"` — `PageStatus` provides the *slot and error branch*, not a one-size skeleton shape,
   since skeleton geometry is inherently route-specific (`shared-skeleton` spec's own "per-row geometry
   matches exactly" requirement already governs that; `PageStatus` doesn't duplicate it).

3a. **`SettingsPage` uses three independent `PageStatus` instances, not one page-wide instance.** This
   resolves the spec's "no listed route's own CSS retains a loading/error rule" requirement literally
   (`.settings-page__loading`/`__error` are deleted, same as every other migrated route) while preserving
   F-047's independent per-section gating exactly: each of the three sections (preferences, agent memory,
   API tokens) renders its own `<PageStatus status={sectionStatus} .../>` beside its own content, so one
   section's failure never blanks another. No spec exemption is needed — every route, including
   `SettingsPage`, satisfies the literal requirement.

4. **`PageHeader` is rendered only by the three routes that already have a title today
   (`SourcesPage`, `PipelinesPage`, `SettingsPage`); every other route in scope stays header-less in
   this ticket — not decided per-route ad hoc, decided once, against the verified inventory in Context.**
   Corrected from an earlier round's false premise that `ChatPage` and `PipelineDetailPage` also had a
   title today (they don't — see Context) and so could get a like-for-like `PageHeader` swap. Adding a
   `PageHeader` to either would be **new UI**, not a migration: `ChatPage` has no obvious title string to
   introduce and no existing precedent for one, and `PipelineDetailPage` already has a bespoke
   `PipelineDetailHeader` chip row whose interaction with a new `PageHeader` (stacked above it? merged
   into its `actions` slot?) is a real layout decision this ticket does not need to make to satisfy its
   own acceptance criteria (header *consistency* only needs to hold across routes that already share a
   header shape). Both routes still adopt `PageShell` for outer padding and `PageStatus` for their
   loading/error branch — only the header piece is deferred. All **four** review routes —
   `ProposalReviewPage`, `PatchSetReviewPage`, `PipelineProposalReviewPage`, `CombinedProposalReviewPage`
   — likewise render no `PageHeader` at all, matching today's header-less full-content `EmptyState`
   pattern across all four (verified identical structure in all four files), but still adopt `PageShell`
   and `PageStatus`. `spec.md`'s header requirement is scoped to exactly these three routes accordingly.

5. **CSS deletion is per-file, verified by grep**, not a bulk regex pass — each migrated route's own
   `.css` is hand-checked for now-dead loading/error selectors before deletion, since some files (e.g.
   `PipelineDetailPage.css`) may share a stylesheet with non-loading/error rules that must stay. The
   verified starting inventory of files with a loading/error rule to delete **in this change** is exactly
   two: `ChatPage.css`, `SettingsPage.css`. (`MetricsPage.css`/`MetricDetailPage.css` are out of scope —
   see Decision 0 — and are deleted whole by HEL-909, not edited here.)

## Risks / Trade-offs

- **Regression risk in retry semantics**: `SourcesPage`/`PipelinesPage`/`ProposalReviewPage` have
  route-specific retry-disabled/"Retrying…" logic keyed off their own status enum. `PageStatus`'s
  `onRetry`/loading-disables-retry contract must be verified against each route's actual retry semantics
  during migration, not assumed identical — this is exactly what the evaluator's spec-conformance pass and
  the skeptic's Playwright pass should check per-route, not just once.
- **`SettingsPage`'s deliberate non-page-wide gating (F-047)** is easy to accidentally regress by wrapping
  its three sections in one `PageStatus` — explicitly called out as a Non-Goal above to guard against it.
- **Visual regression surface** (9 routes — 3 with a PageHeader, 6 header-less) for a
  design-judgment-gated ticket — the skeptic's UI pass (Playwright) must actually visit each of the 9
  routes' loaded, loading (throttle/inspect network), and error states, not just spot-check one or two.
- **HEL-909 obligation carried forward**: `MetricsPage.css`/`MetricDetailPage.css`'s loading/error rules
  are not deleted here; HEL-909 must delete them as part of removing the pages outright. Task 5.4 and the
  PR body both record this so it isn't silently dropped between tickets.
