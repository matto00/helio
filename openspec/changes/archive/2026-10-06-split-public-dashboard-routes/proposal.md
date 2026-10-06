## Why

`PublicDashboardRoutes.scala` (500 lines at b2a0d8088) mixes five concerns behind one class: the public panel list,
row reads plus control capabilities (filter-capabilities / distinct-values), Output metadata (output-meta /
provenance), and history. HEL-1273's history route pushed it past the repo's 250-line soft budget. Splitting by
concern keeps each public surface reviewable on its own, which matters because each one carries its own leak rule.

## What Changes

- Move each concern's logic (resolvers, validator, panel-list assembly) into its own module in
  `com.helio.api.routes.dashboards`; one shared helper owns the panel-belongs-to-dashboard -> bound-Output resolution.
- `PublicDashboardRoutes` keeps its name, package, constructor and its directive tree (paths, params, every ACL call,
  in the original order) and becomes the composing entry point that delegates to the modules. ACL calls stay in this
  file so `ExistenceNotLeakedRoutesSpec`'s access-helper file guard stays truthful without a test edit.
- Update `api/routes/dashboards/README.md` "Holds" list.
- No behaviour change: identical route tree, identical responses, identical test count; no test file edited.

## Non-goals

- No route, parameter, status-code, JSON-shape or ACL change. No change to `ApiRoutes.scala` wiring.
- No test changes (the existing specs keep covering optional-auth and D8 summary-only).
- No bug fixes, comment rewrites or cleanup beyond moving code; findings become noted spinoffs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — pure structural refactor (`skip_specs: true`).

## Impact

- `backend/src/main/scala/com/helio/api/routes/dashboards/` (one file split into several; README).
- No API, schema, migration or frontend impact.
