## Why
The owner needs an aggregate usage view of the app. HEL-1208 stores per-user events and daily rollups but exposes no read surface.

## What Changes
- New owner-tier-only endpoint `GET /api/admin/usage?days=N` returning aggregates read from the rollup tables only.
- New owner-only admin usage page in the frontend (route, charts, labels), reachable from navigation only for owners.
- No per-user data is returned; no migration unless a GRANT is proven necessary under the prod-like role.

## Capabilities
### New Capabilities
- `owner-usage-admin`: owner-only aggregate usage endpoint and page.

### Modified Capabilities
(none)

## Impact
Backend: new route + service + read-only repository over the five rollup tables, wired in ApiRoutes. Frontend: new feature folder, route, conditional nav entry, slice/service. Tests: seeded-events end-to-end test, 403 tests (free/beta), role/RLS test.
