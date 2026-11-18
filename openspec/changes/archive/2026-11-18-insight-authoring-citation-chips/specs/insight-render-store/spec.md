## MODIFIED Requirements

### Requirement: Public insight read
`GET /api/dashboards/:d/panels/:p/insight` SHALL authorize the dashboard with the same sharing-aware dashboard ACL and
`?token=` parameter as the public history route, before resolving the panel, and SHALL return only the
newest `ok` render's markdown, creation time and citations reduced to `id`, `field`, `number`, `date`, `capturedAt`,
`isPct` and an optional `panelId`. `panelId` SHALL be present only when a panel on the same dashboard is bound to the
cited Output, and SHALL then name one such panel, chosen deterministically. It SHALL NOT expose cost, model, token
counts, run id, input digest, trigger, attempt status or cited Output ids.

#### Scenario: Private dashboard refused
- **WHEN** an anonymous caller or a signed-in stranger requests the insight of a panel on a private dashboard
- **THEN** the response is 404 with the same body as for an unknown dashboard, while a valid share token gets 200

#### Scenario: Panel from another dashboard
- **WHEN** the panel id belongs to a different dashboard than the one in the path
- **THEN** the response is 404

#### Scenario: Public projection omits internal fields
- **WHEN** the public route serves a render whose row has every column populated
- **THEN** the response and its schema contain no cost, model, token, run-id, digest or outputId field

#### Scenario: Placed and unplaced citations
- **WHEN** a render cites one Output that is placed on the dashboard and one that is not, and the cited Output is
  also placed on another dashboard
- **THEN** the first citation's `panelId` names the panel on the requested dashboard and the second has no `panelId`
