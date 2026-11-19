## ADDED Requirements

### Requirement: Ask on a shared dashboard

The dashboard ask surface SHALL be offered on a dashboard the caller holds a named `viewer` or `editor` grant on, from
the same entries as on an owned dashboard (the dashboard meta row's Ask control or its kebab item, and the command
bar's kebab item). On a dashboard the caller does not own, the ask flow (opening the surface, asking, reading the answer
and opening a citation's provenance) SHALL NOT send any request to `/api/outputs/*` or `/api/pipelines/*`, except the
pin action's own requests when the server returned a non-null `pin` (the caller can edit the cited pipeline). A citation
chip there SHALL open provenance through `GET /api/dashboards/:id/panels/:panelId/provenance` for a panel on that
dashboard bound to the cited Output; when no loaded panel of that dashboard binds the cited Output, the chip SHALL render
as its plain ordinal with no provenance action. Cited Outputs SHALL be listed by name only, never as a link. The pin
action SHALL follow the response's `pin` unchanged (none when `pin` is `null`). A free-tier grantee SHALL see the
existing upsell in place of the question field, and no ask request SHALL be sent.

#### Scenario: Viewer grantee asks a shared dashboard

- **WHEN** a beta-tier user holding only a viewer grant on a dashboard (no pipeline grant) opens Ask on it and submits
  a question
- **THEN** exactly one `POST /api/dashboards/:id/ask` is sent, the answer card renders, no pin action is rendered, and
  no request to `/api/outputs/*` or `/api/pipelines/*` is sent

#### Scenario: Grantee opens a citation's provenance

- **WHEN** that viewer activates a citation chip in the answer
- **THEN** the provenance popover loads from `/api/dashboards/:id/panels/:panelId/provenance` of a panel bound to the
  cited Output, and `/api/outputs/:id/provenance` is not requested

#### Scenario: Editor grantee without a pipeline grant

- **WHEN** a beta-tier user holding an editor grant on the dashboard and no grant on the cited pipeline asks
- **THEN** the answer card renders with no pin action

#### Scenario: Free-tier grantee

- **WHEN** a free-tier user holding a viewer grant opens Ask on the shared dashboard
- **THEN** the upsell is shown in place of the question field and no ask request is sent

#### Scenario: Owner unchanged

- **WHEN** the dashboard's owner asks and opens a citation chip
- **THEN** the chip's provenance loads from `/api/outputs/:id/provenance` as before, and the pin action is shown when
  `pin` is non-null
