## ADDED Requirements

### Requirement: Connectors surfaced in workspace context
`WorkspaceContextResponse` SHALL include a `connectors` list: one entry per Connector owned by
the caller, each carrying only `id`, `name`, `kind`, and `host` (the base host/origin) — built
via a dedicated, explicitly allow-listed projection, never `ConnectorMeta` verbatim and never a
`config`/`defaultHeaders`-derived value. `ConnectorAuthShape.defaultHeaders` is free-form,
user-supplied header data that can hold a credential-shaped value (e.g. a custom `Authorization`
header); it is never referenced by this projection's serialization code, by construction — not
filtered, not redacted, simply not read. This lets an agent see what it can author a REST source
against without a separate call.

#### Scenario: Workspace context includes the caller's Connectors
- **WHEN** `GET /api/workspace/context` runs for a caller with one or more Connectors
- **THEN** the response's `connectors` field contains one entry per Connector, each with exactly
  the keys `id`/`name`/`kind`/`host` — no `config`, `defaultHeaders`, `authType`, or
  credential-shaped field of any kind

#### Scenario: A Connector with credential-shaped defaultHeaders is still projected safely
- **WHEN** a caller's Connector has `config.defaultHeaders` containing an `Authorization`-shaped
  entry (a legitimate but sensitive custom-header auth configuration)
- **THEN** that Connector's `connectors` entry still contains only `id`/`name`/`kind`/`host` —
  the `defaultHeaders` value never appears anywhere in the response, proven by asserting the
  exact serialized key set of the entry, not merely the absence of a field literally named
  `credential`

#### Scenario: Workspace context omits another user's Connectors
- **WHEN** `GET /api/workspace/context` runs for a caller who owns no Connectors but another user
  does
- **THEN** the response's `connectors` field is an empty list, never another user's entries

### Requirement: Connectors are a structural field, never shrunk by budget trimming
`connectors` is a structural field for the purposes of the existing "Deterministic, priority-ordered
budget trimming" requirement (unmodified by this change): like `counts` and each
`dataSources[]`/`dataTypes[]`/`pipelines[]`/`dashboards[]` entry's identity fields, it SHALL NEVER be shrunk
or omitted to meet `budgetBytes`. This is additive to that requirement's closed enumeration, not a
change to its existing trimming order for `sampleRows`/`exampleValues`/`joinHints`.

#### Scenario: Connectors survive even the tightest budget
- **GIVEN** a workspace whose assembled response exceeds the effective budget even after
  `sampleRows`, `exampleValues`, and `joinHints` are all fully emptied (as in "Structural identity
  survives even the tightest budget")
- **WHEN** `GET /api/workspace/context` is called by that workspace's owner
- **THEN** the response's `connectors` field is present and contains every one of the caller's
  Connectors, unchanged from its natural (untrimmed) size
