# owner-usage-admin Specification

## Purpose
Owner-tier-only endpoint and page showing aggregate app usage read from the product-telemetry rollups, with no per-user data.

## Requirements

### Requirement: Owner-only usage endpoint
`GET /api/admin/usage` SHALL require authentication and SHALL return 403 for any user whose tier is not `owner` (free and beta included). The decision SHALL be made server-side from the user's stored tier.

#### Scenario: Free user denied
- **WHEN** a free-tier user calls the endpoint
- **THEN** the response is 403 and no aggregate data is returned

#### Scenario: Beta user denied
- **WHEN** a beta-tier user calls the endpoint
- **THEN** the response is 403

#### Scenario: Owner allowed
- **WHEN** an owner-tier user calls the endpoint
- **THEN** the response is 200 with the aggregates

### Requirement: Aggregates from rollups only
The response SHALL contain signups per day, TTFD median and p90 per day with sample count (new users only), first-run funnel counts (file dropped, dashboard created, first dashboard rendered), template choice counts, provenance opens per day, and daily/weekly active users per day. Data SHALL be read from the rollup tables and SHALL NOT scan `product_events` or contain any user identifier.

#### Scenario: Numbers match real events
- **WHEN** events are ingested via the real write path and the real rollup runs
- **THEN** the endpoint returns exactly the counts those events imply

### Requirement: Owner-only page
The frontend SHALL provide an admin usage page that renders the aggregates with the app's own chart components and DESIGN.md tokens, labels the TTFD figure as covering new users only, and is not linked from navigation (nor routable) for non-owner users.

#### Scenario: Non-owner navigation
- **WHEN** a non-owner user views navigation
- **THEN** no admin usage entry is present and visiting the route does not render the page

### Requirement: Usage page charts render text in the theme text colour
The admin usage page's charts SHALL render their axis tick labels, axis names, legend text and global text style in the live `--app-text` theme token, tracking light/dark theme changes, and that text SHALL measure at least 4.5:1 (WCAG 2.x SC 1.4.3 AA, normal text) against the surface the chart renders on in both themes.

#### Scenario: Usage chart in dark theme
- **WHEN** the owner views the admin usage page in dark theme
- **THEN** every usage chart's axis labels and legend text use the dark theme's `--app-text` colour
- **AND** that colour measures at least 4.5:1 against the rendered card surface

#### Scenario: Usage chart in light theme
- **WHEN** the owner views the admin usage page in light theme
- **THEN** every usage chart's axis labels and legend text use the light theme's `--app-text` colour
