# output-routes-api Specification

## Purpose
Expose the Output persistence model (HEL-904/outputs-model) over HTTP so a pipeline node's
visualization can be created, read, updated, deleted, and previewed independently of any panel
placement.

## Requirements

### Requirement: Output CRUD is scoped to a pipeline and ACL-checked
The backend SHALL expose `GET/POST /api/pipelines/:id/outputs` and `GET/PATCH/DELETE
/api/outputs/:id`. Every route SHALL apply the same owner/grantee/other ACL evaluation as the
parent pipeline: owner or a grantee with pipeline-sharing access gets 200; an UNAUTHENTICATED
caller (or one with no ACL relationship at all, on the sharing-aware GET routes) gets 404
(existence not leaked); an AUTHENTICATED caller with no pipeline grant on `POST
/api/pipelines/:id/outputs` gets **403** (`AccessChecker.requireAccess`'s standard rule,
identical to `PanelService.create`'s own dashboard-ACL check — this is a pre-existing,
codebase-wide convention, not a new rule invented for Outputs). `PATCH`/`DELETE
/api/outputs/:id` are owner-only (RLS `outputs_update`/`outputs_delete`) — a non-owner grantee
gets **404** there (RLS makes the row invisible to the update/delete statement, not a 403). `POST`
SHALL accept `{ nodeStepId?, kind, name, config }`; `nodeStepId` absent or null SHALL bind the
Output to the pipeline root. **`OutputResponse.nodeStepId` is `Option[String]`, serialized via
`jsonFormat10` on a protocol with no `NullOptions` mixed in anywhere in this backend — a
root-bound Output's response has the `nodeStepId` key OMITTED entirely, never present as a
literal `null`** (same class of wire-shape imprecision as the `pipeline-shape-registry` delta's
`expand` `outputs` key).

#### Scenario: Owner creates an Output at the pipeline root
- **WHEN** the pipeline's owner calls `POST /api/pipelines/:id/outputs` with no `nodeStepId`
- **THEN** the response is `201 Created` with the `nodeStepId` key OMITTED from the raw response
  JSON entirely (not present as `null`) — asserted against the raw parsed JSON object, not just
  the unmarshalled case class, since `resp.nodeStepId shouldBe None` cannot distinguish "key
  omitted" from "key present as null"

#### Scenario: Authenticated caller with no pipeline grant gets 403 on create
- **WHEN** an authenticated user with no ACL relationship to the pipeline calls
  `POST /api/pipelines/:id/outputs`
- **THEN** the response is `403 Forbidden` (the pipeline's existence is not hidden from an
  authenticated caller — matches `PanelService.create`'s dashboard-ACL convention)

#### Scenario: Non-owner grantee gets 404 on PATCH/DELETE
- **WHEN** an editor grantee (not the owner) calls `PATCH` or `DELETE /api/outputs/:id`
- **THEN** the response is `404 Not Found` (owner-only RLS makes the row invisible to the write,
  not a 403)

### Requirement: DELETE /api/outputs/:id cascades to panels and reports removed placements
The backend SHALL delete every panel placement referencing the Output before deleting the Output
row, in the same transaction, and SHALL return the count and ids of the panels removed.

#### Scenario: Deleting an Output removes its placements
- **WHEN** `DELETE /api/outputs/:id` is called for an Output placed on two dashboards
- **THEN** the response is `200 OK` with `{ removedPanelIds: [<id>, <id>] }` and both panels no
  longer exist

### Requirement: GET /api/outputs/:id/rows returns paginated data rows
The backend SHALL expose `GET /api/outputs/:id/rows?offset=&limit=`, replacing
`GET /api/types/:id/rows`, returning the Output's node's materialized row snapshot
(`node_snapshots`), offset/limit paginated (mirroring `Page`/`PagedResult`'s existing convention
used by `GET /api/dashboards`/`GET /api/panels` — NOT a `page`/`pageSize` scheme). ACL is the same
sharing-aware `outputRepo.findById` select `GET /api/outputs/:id` uses.

#### Scenario: First page of rows
- **WHEN** `GET /api/outputs/:id/rows` is called with no query params on an Output with rows
- **THEN** the response is `200 OK` with the first page of rows using the endpoint's default
  offset (`0`) and limit (`200`)

#### Scenario: Negative offset is rejected
- **WHEN** `GET /api/outputs/:id/rows?offset=-1` is called
- **THEN** the response is `400 Bad Request`

### Requirement: GET /api/outputs/:id/panels lists placements
The backend SHALL expose `GET /api/outputs/:id/panels` returning every panel placement (id,
dashboardId, dashboardName) referencing the Output, for the delete-warning UI and the Output sheet.

#### Scenario: Output with no placements
- **WHEN** `GET /api/outputs/:id/panels` is called for an Output placed nowhere
- **THEN** the response is `200 OK` with `{ items: [] }`

### Requirement: GET /api/outputs/:id/assertion-status reports the node's last assertion outcome
The backend SHALL expose `GET /api/outputs/:id/assertion-status`, replacing
`GET /api/types/:id/assertion-status`, returning the last pipeline run's assertion outcome
(pass/fail/severity) for the Output's bound node.

#### Scenario: Node with a passing last run
- **WHEN** the Output's node's last run had no failing assertions
- **THEN** the response is `200 OK` with a passing assertion status

### Requirement: Lean paginated list endpoint for Outputs
The backend SHALL expose a paginated `GET /api/outputs?offset=&limit=` list endpoint scoped to
the OUTPUTS THE CALLER OWNS (`OutputRepository.findAllByOwner` — NOT sharing-aware, unlike
`GET /pipelines/:id/outputs`; a shared-but-not-owned Output does not appear here), returning
summary fields only (no full `schema`).

#### Scenario: Paginated Outputs list
- **WHEN** `GET /api/outputs?offset=0&limit=20` is called
- **THEN** the response is `200 OK` with at most 20 items owned by the caller and a total count

#### Scenario: A grantee-owned Output on a shared pipeline does not appear in another caller's list
- **WHEN** the caller owns pipeline P and has granted an editor a share on P, and the editor has
  created their OWN Output on P
- **THEN** `GET /api/outputs` for the pipeline owner does not include the editor's Output (it is
  visible via `GET /pipelines/:id/outputs`, but not via this owner-scoped list)

### Requirement: PATCH /api/outputs/:id partial-merges config, never replaces it
The backend SHALL expose `PATCH /api/outputs/:id` accepting any subset of `{ name, config }`,
owner-only-ACL-scoped like the other Output write routes. When `config` is provided, its fields SHALL
be merged into the existing `config` object rather than replacing it wholesale — a partial
`chart.legend` object merges into the stored `legend` rather than being rejected for missing
fields, and the same partial-merge behavior holds for `tooltip`, `seriesColors`, and `axisLabels`
(HEL-877 — checked here because Output config now carries what these used to live under on panel
`appearance`). Absent-vs-null `RequestValidation` normalization (HEL-362/HEL-623 idiom) applies:
an absent key leaves the existing value untouched, while an explicit `null` clears it.

#### Scenario: Partial chart.legend merges instead of being rejected
- **WHEN** `PATCH /api/outputs/:id` is called with `{ "config": { "chart": { "legend": { "position":
  "bottom" } } } }` on an Output whose existing `chart.legend` also has a `visible` field
- **THEN** the response is `200 OK`, the stored `legend.position` is `"bottom"`, and `legend.visible`
  is unchanged

#### Scenario: Same partial-merge holds for tooltip, seriesColors, and axisLabels
- **WHEN** `PATCH /api/outputs/:id` is called with a partial `tooltip`, `seriesColors`, or
  `axisLabels` object missing some of its existing sibling fields
- **THEN** the response is `200 OK` and only the provided fields are overwritten; siblings already
  present on the stored config are preserved

#### Scenario: Absent config leaves the Output unchanged
- **WHEN** `PATCH /api/outputs/:id` is called with `{ "name": "Renamed" }` and no `config` key
- **THEN** the Output's `config` is unchanged and only `name` is updated
