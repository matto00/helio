## ADDED Requirements

### Requirement: Panel wire carries dataAsOf as a backend-only field
The panel list response of `GET /api/dashboards/:id/panels` (the shared public/optional-auth panel-list route, including authenticated viewers of it) SHALL carry `dataAsOf` (the bound Output's pipeline `lastRunAt`, or null) for `OutputPanel`s. Other panel responses (create, update, dashboard contents, snapshot) carry null. No frontend indicator renders it; freshness is presented by the provenance read.

#### Scenario: Bound panel carries dataAsOf
- **WHEN** a panel bound to an Output whose pipeline has run is listed via `GET /api/dashboards/:id/panels`
- **THEN** `dataAsOf` equals the pipeline's last run timestamp

## REMOVED Requirements

### Requirement: Frontend panel displays freshness indicator when dataAsOf is non-null
**Reason**: The "Data as of" indicator no longer exists in the UI; freshness moves to the provenance popover (HEL-916/HEL-1207).
**Migration**: Use `GET /api/outputs/:id/provenance` (`lastRun.completedAt`).

### Requirement: PanelBase TypeScript interface includes dataAsOf
**Reason**: No frontend code reads `dataAsOf`; the typed field is not a contract anyone relies on.
**Migration**: None; the optional field may remain in the type without a spec requirement.
