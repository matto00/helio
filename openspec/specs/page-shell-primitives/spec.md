# page-shell-primitives Specification

## Purpose
Shared page-level container/header/status primitives (`PageShell`, `PageHeader`, `PageStatus`) that every
top-level route composes, replacing per-route hand-rolled containers, headers, and duplicated
loading/error CSS with one consistent implementation per DESIGN.md §3/§6/§7.

## Requirements

### Requirement: PageShell provides the canonical page container
The system SHALL provide a `PageShell` component in `frontend/src/shared/ui/` that renders a route's
top-level container using the section-overview padding/gap tokens (`padding: var(--space-5)
var(--space-6)`, `gap: var(--space-7)`, per DESIGN.md §6 "Section overview pages"). It SHALL accept
`children` and an optional `className` for route-specific layout additions, without requiring the
consumer to redeclare the container's own padding/gap.

#### Scenario: A route renders through PageShell with standard geometry
- **WHEN** a route renders `<PageShell>` with content
- **THEN** the rendered container has the standard section-overview padding and gap, with no
  route-specific override needed to match other routes

### Requirement: PageHeader provides a consistent title/eyebrow/actions/back-link header
The system SHALL provide a `PageHeader` component in `frontend/src/shared/ui/` accepting a required
`title` string (rendered as an `<h1 className="page-title">`, Fraunces per DESIGN.md §3 typography), an
optional `eyebrow` string (rendered via the `.eyebrow` utility above the title), an optional `actions`
slot (rendered trailing, e.g. buttons), and an optional `backTo`/`onBack` affordance (rendered leading,
for detail routes). Omitting any optional prop SHALL render nothing for that slot rather than an empty
wrapper element.

#### Scenario: A list route's minimal header
- **WHEN** `PageHeader` is rendered with only `title="Data Sources"`
- **THEN** the title renders as an `<h1 className="page-title">` and no eyebrow, actions, or back link
  elements are present in the DOM

#### Scenario: A detail route's header with a back link and actions
- **WHEN** `PageHeader` is rendered with `title`, `backTo`, and `actions`
- **THEN** the back affordance renders before the title and the actions render after it, in a single
  header row

### Requirement: PageStatus renders a route's top-level loading or error state
The system SHALL provide a `PageStatus` component in `frontend/src/shared/ui/` accepting a `status` prop
of `"loading" | "failed"` (a route renders its own resolved content itself once `status` is neither —
`PageStatus` is not rendered in that case), and, when `status="failed"`, a `message` string and an
optional `onRetry` callback. When `status="loading"`, it SHALL render the established DESIGN.md §7
loading pattern (a skeleton or the accent border-`Spinner`, per the route's own already-declared choice —
see below). When `status="failed"`, it SHALL render `EmptyState` with `intent="error"`, the given
`message`, and — when `onRetry` is given — a `cta` that invokes it labeled `"Retry"` (`"Retrying…"` and
disabled while `status` remains `"loading"` on a subsequent retry).

#### Scenario: Loading renders the established spinner pattern
- **WHEN** `PageStatus` is rendered with `status="loading"`
- **THEN** it renders the accent border-`Spinner` (or a `Skeleton`-composed placeholder, for a route that
  already has a resolved-shape skeleton), never a flash of empty content

#### Scenario: Failed renders an intent-error EmptyState with retry
- **WHEN** `PageStatus` is rendered with `status="failed"`, a `message`, and `onRetry`
- **THEN** it renders `EmptyState` with `intent="error"`, the given message, and a `"Retry"` cta that
  calls `onRetry`

#### Scenario: Failed without onRetry renders no cta
- **WHEN** `PageStatus` is rendered with `status="failed"` and no `onRetry`
- **THEN** the rendered `EmptyState` has no `cta`

### Requirement: The nine listed routes render through PageShell/PageStatus, and through PageHeader only where they already have a title today
`SourcesPage`, `PipelinesPage`, `PipelineDetailPage`, `ChatPage`, `SettingsPage`, `ProposalReviewPage`,
`PatchSetReviewPage`, `PipelineProposalReviewPage`, and `CombinedProposalReviewPage` SHALL render their
top-level container through `PageShell` and their top-level fetch's loading/error state through
`PageStatus` instead of a hand-rolled equivalent. (`TypeRegistryPage`, `TypeDetailPage`, `MetricsPage`,
and `MetricDetailPage` are explicitly out of scope — see `design.md` Decision 0; they are removed
outright by HEL-909, not migrated here.) Of these nine, only `SourcesPage`, `PipelinesPage`, and
`SettingsPage` render a title today; each of these three SHALL render that title through `PageHeader`.
`ChatPage` and `PipelineDetailPage` render no title today (`PipelineDetailPage` has only the bespoke
`PipelineDetailHeader` chip row) and SHALL NOT gain a `PageHeader` in this change (see `design.md`
Decision 4) — only their container/status presentation is migrated. No listed route's own `.css` file
SHALL retain a loading or error style rule once migrated, whether the route uses one `PageStatus`
instance (most routes) or several independent instances for independently-gated sections (`SettingsPage`,
per its own F-047 requirement) — either way, no bespoke loading/error CSS remains in the route's own
stylesheet once every instance is migrated.

#### Scenario: A migrated route's stylesheet has no loading/error rules
- **WHEN** a migrated route's `.css` file is inspected after migration
- **THEN** it contains no loading-state or error-state style rule (those now live in `PageStatus.css`)

#### Scenario: SettingsPage's independently-gated sections each migrate to their own PageStatus
- **WHEN** `SettingsPage` is inspected after migration
- **THEN** each of its three independently-fetched sections renders its own `PageStatus` instance, one
  section's failure does not affect another's rendering, and `SettingsPage.css` retains no loading/error
  rule

#### Scenario: Headers are visually consistent across the three routes that have one
- **WHEN** any two of `SourcesPage`, `PipelinesPage`, and `SettingsPage` are rendered
- **THEN** their title font, size, weight, and header spacing are identical (both compose the same
  `PageHeader`), even where one has actions or a back link and the other does not

#### Scenario: ChatPage and PipelineDetailPage render no PageHeader
- **WHEN** `ChatPage` or `PipelineDetailPage` is rendered after migration
- **THEN** no `PageHeader` element is present — `ChatPage` renders no title, and `PipelineDetailPage`
  renders only its existing `PipelineDetailHeader` chip row, unchanged

#### Scenario: Review routes render no PageHeader
- **WHEN** any of the four review routes is rendered
- **THEN** no `PageHeader` element is present, matching their pre-existing header-less, single-purpose
  hand-off structure
