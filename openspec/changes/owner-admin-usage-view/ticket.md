# HEL-1211: Owner-only admin view: aggregate app usage from product telemetry

## Description
Leaf 6 (last) of HEL-916. The owner wants an admin view of aggregate app usage. Leaf 3 (HEL-1208) stores per-user events plus aggregate rollups; this leaf is the read surface. Owner-tier only (`tier = owner`, from `HELIO_OWNER_EMAILS`; 403 for everyone else including beta). Aggregate only, no per-user drill-down.

Metrics: signups per day; time-to-first-dashboard (median, p90) for NEW users only (no backfill: pre-telemetry users excluded on purpose; label says so); first-run funnel (file dropped -> dashboard created -> first dashboard rendered); template choice counts; provenance opens per day; DAU/WAU.

Reads come from the rollups, not full scans of `product_events`. DESIGN.md binding; use the app's own chart components.

## Acceptance Criteria
- A non-owner (free, beta) gets 403 from the route, and the page is not reachable from navigation. Red-first.
- Numbers match the fixture events exactly (seeded-events test through the REAL write path and REAL rollup code, not hand-inserted rollup rows).
- Verified live in both themes (desktop + phone widths); a11y per DESIGN.md.
- Read path proven under a non-BYPASSRLS prod-like role (no RLS/grant masking by superuser).
- Owner decisions: 90-day retention, signup_completed and first_dashboard_rendered exempt from purge, no TTFD backfill.
