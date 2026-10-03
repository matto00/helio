## ADDED Requirements

### Requirement: Public panel list never exposes an owner-id-equivalent to a non-owner
`GET /api/dashboards/:id/panels` SHALL omit `ownerId` and `meta.createdBy` from every panel for any caller who is neither the dashboard's owner nor that panel's creator (anonymous, share-token-only, or authenticated grantee/stranger). The dashboard owner and the panel's creator SHALL still receive both fields. `meta.createdAt` and `meta.lastUpdated` SHALL be unaffected.

#### Scenario: Anonymous caller
- **WHEN** an anonymous caller lists a public dashboard's panels
- **THEN** no key at any depth of the serialized response has a value equal to the owner's user id

#### Scenario: Owner caller
- **WHEN** the owner lists their own dashboard's panels
- **THEN** each panel carries `ownerId` and `meta.createdBy`

### Requirement: Every public route response is free of the owner's user id
No response from a route reachable without authentication or via optional authentication (panel rows, filter-capabilities, distinct-values, output-meta, provenance, image upload fetch, connector completion) SHALL contain a key or value containing an owner's user id for a non-owner caller.

#### Scenario: Generic guard
- **WHEN** each public route is called anonymously against a fixture whose owner id is a distinctive value
- **THEN** a recursive walk of the response JSON finds no key or string containing that owner id
