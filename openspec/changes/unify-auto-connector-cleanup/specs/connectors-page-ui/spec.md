## ADDED Requirements

### Requirement: The Connectors list refreshes after an undo removed an inline source
When a patch-set undo reports that it removed an inline source, the client SHALL invalidate its cached Connectors list so the next Connectors view refetches it, because the server may have removed that source's implicit Connector.

#### Scenario: Undo removed an inline source
- **WHEN** an undo outcome lists an inline source as `removed`
- **THEN** the cached Connectors list is marked stale and is refetched on the next Connectors view

#### Scenario: Undo removed nothing
- **WHEN** an undo outcome lists inline sources only as `kept` or `alreadyGone`, or lists none
- **THEN** the cached Connectors list is unchanged
