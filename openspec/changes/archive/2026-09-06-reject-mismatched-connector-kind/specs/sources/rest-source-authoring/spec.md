## MODIFIED Requirements

### Requirement: Connector selection in the REST source form
The REST source form SHALL let the user select an existing Connector, or create one inline and
return to the form with it selected, before the source can be saved. The picker SHALL list only
Connectors whose `kind` matches the source type being authored — for a REST source, only
`rest_api` Connectors — so a mismatched kind cannot be chosen from the form. This filtering is an
affordance that keeps the user out of a known-bad state; it is NOT the enforcement boundary, which
is the server-side check on the create path. The form SHALL display the selected Connector's
name and kind, and a statement that its credential will be applied to outbound requests, so the
absence of auth fields reads as intentional.

When the user owns no Connector of the matching kind, the picker SHALL show an explanatory empty
state naming why no Connector is listed and offering inline Connector creation, rather than an
empty control with no explanation.

#### Scenario: User selects an existing Connector
- **WHEN** the user opens the REST source form and picks a Connector from the picker
- **THEN** the form shows the Connector's name/kind and applies it (`connectorId`) to the composed
  request used for test-before-save and for the create payload

#### Scenario: User creates a Connector inline
- **WHEN** the user chooses "create new" from the Connector picker and completes Connector creation
- **THEN** the form returns focus to REST source authoring with the newly created Connector selected,
  without losing any other field values already entered

#### Scenario: Non-matching-kind Connectors are not offered
- **WHEN** the user opens the REST source form while owning both a `rest_api` Connector and a
  Connector of another kind
- **THEN** the picker lists the `rest_api` Connector and does not list the other, and the
  non-matching Connector cannot be selected

#### Scenario: No matching Connector exists
- **WHEN** the user opens the REST source form owning no `rest_api` Connector
- **THEN** the picker shows an explanatory empty state that says no REST Connector exists yet and
  offers inline Connector creation, rather than a bare empty control
