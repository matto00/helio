## ADDED Requirements

### Requirement: The public panel list carries the dashboard's stored layout
`GET /api/dashboards/:id/panels` SHALL include a top-level `layout` object with exactly the keys `lg`, `md`,
`sm`, `xs`, each an array of items with exactly the keys `panelId`, `x`, `y`, `w`, `h`, taken from the
dashboard's stored layout and filtered to items whose `panelId` is one of the panels in the same response.
It SHALL be served behind the same `authorizeResourceWithSharing` gate as the panel list and SHALL NOT carry
a layout version, appearance, dashboard name or owner id.

#### Scenario: Share-token viewer gets the layout
- **WHEN** a caller with a valid share token lists a dashboard's panels
- **THEN** the response carries `layout` whose items match the stored layout for those panels

#### Scenario: Stale layout ids are dropped
- **WHEN** the stored layout contains an item for a panel id that is not in the response
- **THEN** that item is absent from `layout`

#### Scenario: Denied caller learns nothing new
- **WHEN** a caller with an invalid, expired or revoked token lists the panels
- **THEN** the response is the existing single `404`, with no `layout`

### Requirement: A form panel's bound field declarations are readable publicly
`GET /api/dashboards/:dashboardId/panels/:panelId/form-schema` SHALL, behind the same sharing gate as the
panel list, return `{fields: [{name, type, required}]}` for a `form` panel on that dashboard: only the fields
the form binds (`config.fields[].sourceField`), in the dataset's declared order, with no `default`, no row,
no data source id, no row cap and no owner id. It SHALL return the same `404` for a panel not on that
dashboard, an unknown panel, a non-form panel or a missing dataset. It SHALL NOT change the authorisation of
`POST /api/panels/:id/submit`.

#### Scenario: Only bound fields
- **WHEN** a token viewer reads the form schema of a form binding 2 of a dataset's 4 declared fields
- **THEN** exactly those 2 fields are returned, each with only `name`, `type` and `required`

#### Scenario: Non-form panel
- **WHEN** the route is called for a markdown panel on the shared dashboard
- **THEN** the response is `404`

#### Scenario: Submit stays closed
- **WHEN** an anonymous token viewer posts to `POST /api/panels/:id/submit` for that form
- **THEN** the response has the exact status the unauthenticated request gets before this change (recorded in
  the red run and asserted by value), and no row is appended

#### Scenario: A form pointing at a dataset its owner cannot read
- **WHEN** a form panel's `config.dataSourceId` names a dataset the form's owner does not own
- **THEN** the route returns the same `404` and no part of that dataset's declaration appears

## MODIFIED Requirements

### Requirement: Every public route response is free of the owner's user id
No response from a route reachable without authentication or via optional authentication SHALL contain a key or value
containing an owner's user id for a non-owner caller. This covers: the public panel list (including its `layout`),
rows, filter-capabilities, distinct-values, output-meta, provenance, history, insight and form-schema routes; the image
upload fetch; connector completion (GET and POST); `/health`; and the error bodies of the `/api/auth/*` routes (register,
login, Google OAuth callback, MFA verify) plus the Google OAuth start redirect's `Location` header. Success bodies of
register, login, the OAuth callback and MFA verify are excluded, since they return the caller's own identity.

#### Scenario: Generic guard
- **WHEN** each public route is called anonymously against a fixture whose owner id is a distinctive value
- **THEN** a recursive walk of the response JSON finds no key or string containing that owner id

#### Scenario: Auth error bodies for the owner's own email
- **WHEN** an anonymous caller logs in with a wrong password, or registers again, using the owner's email (exact
  case or a case variant), or verifies MFA with a bad challenge, or calls the OAuth callback with a bad state
- **THEN** the error body contains no key or string containing the owner's user id
