## ADDED Requirements

### Requirement: Client preference saves are serialised and coalesced

The web client SHALL send every `PATCH /api/users/me/preferences` through one serialiser shared by all writers of that route (appearance, shell layout, assistant default model, dashboard tabs). At most one such request SHALL be in flight at a time. A patch queued while a request is in flight SHALL be merged into a single pending patch (the latest value per top-level key wins, including an explicit `null`), and that pending patch SHALL be sent as one trailing request once the in-flight request settles, whether it succeeded or failed. A failed request SHALL NOT be re-sent. A sign-out SHALL discard any pending patch, and no patch queued before the sign-out SHALL be sent afterwards.

#### Scenario: An older in-flight choice cannot win

- **WHEN** the user picks Mono, the Mono `PATCH` is held in flight, and the user then picks Serif
- **THEN** exactly one more `PATCH` (carrying Serif) is sent, and only after the Mono request has settled
- **AND** the stored type style read back from the server is Serif

#### Scenario: A burst becomes one trailing request

- **WHEN** a request is in flight and the user makes several further changes before it settles
- **THEN** at most one trailing request is sent, carrying the latest value of every key changed during the burst

#### Scenario: Different fields do not overwrite each other

- **WHEN** an appearance change and an assistant-default-model change are queued behind an in-flight request
- **THEN** the trailing request carries both keys and both are stored

#### Scenario: Sign-out drops a pending save

- **WHEN** a patch is pending behind an in-flight request and the user signs out
- **THEN** the pending patch is never sent
