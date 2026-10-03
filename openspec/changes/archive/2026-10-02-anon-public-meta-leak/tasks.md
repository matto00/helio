## 1. Red tests first

- [x] 1.1 Add a JSON-walking helper `assertNoOwnerId` plus its own unit test (flags the id under an arbitrary key/array/nesting)
- [x] 1.2 Add per-field absence tests for `GET /api/dashboards/:id/panels` as anonymous, share-token-only, and authenticated non-owner (`ownerId`, `meta.createdBy` absent; `createdAt`/`lastUpdated` present); run on unmodified main and record the red output
- [x] 1.3 Add a generic-guard test over every public route (panel list, rows, filter-capabilities, distinct-values, output-meta, provenance, image upload, connector completion routes as applicable) using a distinctive owner id; record red where it leaks
- [x] 1.4 Add owner-view tests: dashboard owner receives `ownerId`/`meta.createdBy` on every panel including a grantee-created one; a grantee viewing another user's panel does not
- [x] 1.5 Guard fixture uses one distinctive id for panel owner, dashboard owner, output owner, pipeline owner and share-token creator; also walk 404/403 error bodies

## 2. Fix

- [x] 2.1 Make `ResourceMetaResponse.createdBy` optional with `includeCreatedBy` param defaulting true
- [x] 2.2 `PanelResponse.fromDomain`: apply the owner-identifying flag to `meta.createdBy` as well as `ownerId`
- [x] 2.3 `PublicDashboardRoutes` panel list: bind the directive's `_` to a named `access`; caller-is-owner decision per panel (`access == Owner` or panel creator). Fix positional `ResourceMeta`/`ResourceMetaResponse` constructions in `AggregatorRegressionSpec` and `PatchSetUndoInverseSpec` (need `Some(...)`)
- [x] 2.4 Fix any further leak the route audit finds
- [x] 2.5 Frontend `types/models.ts` and `helio-mcp/src/types.ts`: `createdBy` optional; typecheck both
- [x] 2.6 `schemas/shared/resource-meta.schema.json`: drop `createdBy` from `required`, document omission; `npm run check:schemas` green

## 3. Verify

- [x] 3.1 Rerun new tests green; mutation proof for the generic guard (restore leak, see red, revert), red and green output persisted as evidence
- [x] 3.2 `cd backend && nice -n 19 sbt testFull`; frontend lint/typecheck/format; `npm run check:schemas`
- [x] 3.3 Write the route-by-route audit table (route, fields examined, fields removed) into the PR body
