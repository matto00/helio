## Purpose
Frontend spec for the Connectors page: create/list/edit/delete/rotate saved credentialed hosts,
with the shown-once credential UX, implicit-Connector presentation, and dependent-aware deletion.

## ADDED Requirements

### Requirement: /connectors route renders ConnectorsPage
The frontend SHALL register a `/connectors` route via React Router that renders `ConnectorsPage`.
The sidebar SHALL include a nav link "Connectors" alongside the existing Data Sources / Data
Pipelines links.

#### Scenario: Navigating to /connectors shows ConnectorsPage
- **WHEN** the user navigates to `/connectors`
- **THEN** `ConnectorsPage` is rendered with the Connectors list (or its empty state) visible

### Requirement: ConnectorsPage lists Connectors
`ConnectorsPage` SHALL dispatch a fetch of the user's Connectors on mount and render one row per
Connector showing: name, kind, base host/URL, and a masked credential placeholder.

#### Scenario: Empty Connectors state
- **WHEN** `GET /api/connectors` returns an empty list
- **THEN** a shared `EmptyState` component is rendered rather than one-off markup

#### Scenario: List row never contains the credential
- **WHEN** the Connectors list renders
- **THEN** no row displays the raw or masked-but-derived credential value — only a fixed
  placeholder indicating a credential is set

### Requirement: Create form is credential-once, kind-driven
The create form SHALL collect name, kind (`rest_api` first — the form does not hardcode this as
the only kind), base host/URL, auth type (none / bearer / api key with header-or-query
placement), and the credential value (omitted entirely when auth type is none). On success, the
credential input SHALL NOT be retained in any client-side state beyond the single submission.

#### Scenario: Create a Connector with a credential
- **WHEN** the user submits name/kind/baseUrl/authType=bearer and a token value
- **THEN** `POST /api/connectors` is called with those fields and, on success, the created
  Connector appears in the list with a masked-credential placeholder, not the entered value

#### Scenario: Create a no-auth Connector
- **WHEN** the user submits name/kind/baseUrl/authType=none with no credential entered
- **THEN** `POST /api/connectors` is called with an empty credential and succeeds — the form
  does not block submission on a missing credential in this case

### Requirement: Credential is shown exactly once, never re-displayed
Once a Connector is created, no subsequent view of that Connector (list, detail, or edit form)
SHALL display, reveal, or offer to reveal its credential value in any form.

#### Scenario: Editing a Connector never shows the existing credential
- **WHEN** the user opens the edit form for an existing Connector
- **THEN** the credential field shows a masked placeholder and a "Replace credential" action,
  never the actual value or an empty field that could be mistaken for data loss

### Requirement: Credential rotation via a dedicated action
`ConnectorsPage` SHALL provide a "Replace credential" action per Connector, reusing the same
credential-entry component the create form uses, that submits only the new credential value via
the dedicated rotation endpoint — never bundled into the general edit-fields submission.

#### Scenario: Rotate a Connector's credential
- **WHEN** the user clicks "Replace credential", enters a new value, and confirms
- **THEN** `PUT /api/connectors/:id/credential` is called with the new value, a success
  confirmation is shown, and the credential field returns to the masked placeholder state

#### Scenario: Rotation is presented as irreversible
- **WHEN** the user opens the "Replace credential" action
- **THEN** the UI states that the existing credential cannot be viewed or recovered and that
  submitting replaces it immediately

### Requirement: Implicit Connectors are visually distinguished
A Connector synthesized by the legacy dual-support path (`config.implicit === true`) SHALL
appear in the list visually distinguished from user-created Connectors (e.g. a badge/label
indicating it was auto-created from an existing source), never hidden and never presented as
indistinguishable from an explicitly-created Connector.

#### Scenario: Implicit Connector shows a distinguishing badge
- **WHEN** the list includes a Connector whose stored config has `implicit: true`
- **THEN** that row displays a badge/label (e.g. "Auto-created") that a user-created Connector's
  row does not

### Requirement: Dependent sources are visible proactively, not only on a blocked delete
Every Connector row SHALL display its dependent count (how many sources currently reference it),
sourced from the backend's `dependentCount` field, at all times — not only when a delete attempt
is blocked.

#### Scenario: Dependent count shown on every row
- **WHEN** the Connectors list renders
- **THEN** each row displays its dependent count (including "0" when no sources reference it)

### Requirement: Deletion surfaces dependents clearly
When a delete is blocked because dependent sources reference the Connector, the UI SHALL
surface that explicitly — that deletion is blocked and why, referencing the same dependent count
already shown on the row — rather than presenting a bare or generic failure.

#### Scenario: Delete blocked shows dependent explanation
- **WHEN** the user attempts to delete a Connector and the backend returns 409
  `ConnectorHasDependents`
- **THEN** the UI displays a message explaining the Connector cannot be deleted because N
  sources depend on it (N from the Connector's dependent count), distinct from a generic error
  toast

#### Scenario: Delete succeeds with no dependents
- **WHEN** the user deletes a Connector with no dependent sources
- **THEN** `DELETE /api/connectors/:id` is called and, on success, the Connector is removed from
  the list

### Requirement: Connection-test reuses the existing affordance, for saved Connectors only
`ConnectorsPage` SHALL reuse `TestConnectionAffordance`/`POST /api/sources/test` for testing an
already-saved Connector's configuration (from the list row or edit modal), posting
`{ type: "rest_api", config: { connectorId } }` — never a second test mechanism, and never
offered inline during the create form before the Connector exists (a saved credential cannot be
read back client-side, so no pre-save test payload can faithfully include its auth).

#### Scenario: Test a saved Connector's configuration
- **WHEN** the user triggers connection-test from the Connectors page for an existing Connector
- **THEN** the existing `TestConnectionAffordance` component posts
  `{ type: "rest_api", config: { connectorId } }` to `POST /api/sources/test`, and the result
  (success/failure) is displayed inline

#### Scenario: No test action during creation
- **WHEN** the user is filling out the create form for a new Connector
- **THEN** no connection-test action is offered until after the Connector has been created

### Requirement: Touch targets meet the 44px floor
Every interactive control on `ConnectorsPage` (buttons, action icons, form inputs) SHALL meet
the 44px mobile touch-target floor at 430px and 768px viewport widths, verified by HEL-813's
rendered-geometry probe (`e2e/support/touchTargetProbe.ts`).

#### Scenario: Touch targets pass at 430px and 768px
- **WHEN** HEL-813's touch-target sweep runs against `/connectors` at 430px and 768px
- **THEN** every interactive control on the page meets the 44px floor
