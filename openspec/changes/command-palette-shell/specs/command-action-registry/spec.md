## Purpose

Defines the typed contract every command-palette entry conforms to, and the register/deregister API through
which any part of the app contributes actions to the palette without the palette knowing about them.

## ADDED Requirements

### Requirement: Every palette entry conforms to one typed action contract
The frontend SHALL define a single `CommandAction` contract that every palette entry conforms to, carrying:
a stable unique `id`; a human-readable `title`; an optional `subtitle` for a secondary line of context (a
resource's type or parent, for entries whose title alone is ambiguous); optional `keywords` that broaden
matching without being displayed; an optional `section` grouping label; an optional icon; an optional
`matchesQuery` opt-out from local filtering (see the opt-out Requirement below); and a `run` behavior invoked
when the user selects the entry. Every field except `id`, `title`, and `run` SHALL be optional, so a minimal
action needs only those three.

#### Scenario: A minimal action is valid
- **WHEN** a contributor registers an action carrying only `id`, `title`, and `run`
- **THEN** it type-checks, appears in the palette, and runs when selected

#### Scenario: A subtitle disambiguates entries sharing a title
- **WHEN** two actions carry the same title but different subtitles
- **THEN** both are listed and each renders its own subtitle as secondary context

#### Scenario: Keywords broaden matching without being displayed
- **WHEN** an action declares keywords that do not appear in its title
- **THEN** querying one of those keywords matches the action, and the keywords are not rendered as its label

### Requirement: Actions can be registered and deregistered at runtime
The registry SHALL expose a way to register one or more actions and to deregister exactly those same actions
again, so a feature can contribute actions only while it is mounted or relevant. Registration SHALL return a
disposer that removes precisely the actions that registration added, leaving every other registrant's actions
untouched. Registering actions SHALL take effect for a palette that is already open.

#### Scenario: Deregistering removes only that registrant's actions
- **WHEN** two features have each registered actions
- **AND** one of them invokes its disposer
- **THEN** only that feature's actions are gone and the other feature's actions remain

#### Scenario: Disposing twice is safe
- **WHEN** a registration's disposer is invoked more than once
- **THEN** no error is raised and no other registrant's actions are affected

#### Scenario: Registration is visible to an open palette
- **WHEN** the palette is open
- **AND** a feature registers a new action
- **THEN** the palette's results update to include it without the palette being reopened

### Requirement: Action ids are unique and collisions are surfaced
Action `id`s SHALL be unique across all registrants at any moment. When a registration would introduce an id
that is already registered, the registry SHALL surface the collision in development rather than silently
dropping or silently overwriting an action, and SHALL keep the palette in a usable state.

#### Scenario: Duplicate id is surfaced, not silently swallowed
- **WHEN** a feature registers an action whose id is already registered by another feature
- **THEN** the collision is reported in development and the palette continues to render without crashing

### Requirement: React callers register declaratively and clean up automatically
The registry SHALL provide a React hook that registers a caller's actions for the lifetime of the calling
component and deregisters them on unmount, so contributors cannot leak actions. When the caller's action list
changes, the hook SHALL replace that caller's previously registered actions with the new list.

#### Scenario: Unmounting removes the component's actions
- **WHEN** a component that registered actions through the hook unmounts
- **THEN** its actions no longer appear in the palette

#### Scenario: Changing the action list replaces the previous registration
- **WHEN** a component using the hook re-renders with a different list of actions
- **THEN** the palette shows the new list and none of that component's superseded actions

### Requirement: Registrants can observe the palette's live query
The registry SHALL expose the palette's current query to registrants, so a contributor whose entries depend
on what the user typed can compute its actions from that query. The exposed query SHALL be empty while the
palette is closed. This exists so query-dependent contributors — resource search and recents among them —
can plug into this contract without it having to change.

#### Scenario: Query-dependent contributor sees the typed query
- **WHEN** the palette is open and the user has typed a query
- **THEN** a registrant observing the query receives that query and can register actions derived from it

#### Scenario: Query resets when the palette closes
- **WHEN** the palette is closed
- **THEN** the query observed by registrants is empty

### Requirement: A registrant can opt out of local query filtering
An action SHALL be able to declare that it has already been matched against the query by whoever produced it,
so the palette does not filter it a second time locally. When an action declares this opt-out, the palette
SHALL display it for the current query without re-testing its title and keywords. Because such an action
carries no local match strength, it SHALL NOT be scored against the local ranking tiers; instead it SHALL
retain the relative order its registrant supplied, and SHALL be ordered after locally-matched actions within
the same section. See the `command-palette-filtering` capability's ranking Requirement, which states the same
rule from the ranking side. This exists so a contributor whose entries were matched elsewhere — resource search
results ranked by a server, or recents ranked by usage — is not silently discarded by local matching that
knows nothing about why the entry was produced.

#### Scenario: A pre-matched action is not filtered out locally
- **WHEN** a registrant supplies an action that declares the opt-out
- **AND** the action's title and keywords do not contain the current query
- **THEN** the action is still shown in the results for that query

#### Scenario: Opted-out actions keep the order their registrant supplied
- **WHEN** a registrant supplies several opted-out actions in a deliberate order
- **THEN** they appear in that same relative order, and are not reordered by local scoring

#### Scenario: Actions without the opt-out are filtered normally
- **WHEN** an action does not declare the opt-out
- **THEN** it is matched against the query by title and keywords as usual

### Requirement: The registry contract is documented for contributors
The registry module SHALL carry a short usage comment showing how a feature registers and deregisters
actions, so tickets building on it do not have to infer the contract from its implementation.

#### Scenario: Usage documentation is present
- **WHEN** a contributor opens the registry module
- **THEN** a concise comment documents the action contract and a register/deregister example
