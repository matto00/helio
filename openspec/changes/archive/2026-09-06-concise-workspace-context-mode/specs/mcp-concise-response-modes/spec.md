## Purpose

Provides opt-in bounded representations for the MCP tools whose full responses exceed the workspace-context
byte budget on a real workspace, so an agent can obtain a usable snapshot instead of an unreadable one — with a
stated omission rule and truncation the caller can always detect.

## ADDED Requirements

### Requirement: Concise mode is opt-in and verbose remains the default
`get_workspace_context` and `analyze_pipeline` SHALL each accept an optional `concise` parameter. When
`concise` is absent or false, every field the response previously carried SHALL retain its previous value, and
no entity or per-entity detail SHALL be omitted. The full response additionally carries the omission
enumeration required below, empty — an additive field, not a change to any existing one. Concise mode SHALL
never become the default.

#### Scenario: Concise absent returns the unchanged full response
- **WHEN** `get_workspace_context` is called with no `concise` parameter
- **THEN** every previously-existing field holds its previous value and nothing is omitted

#### Scenario: The full response carries an empty omission enumeration
- **WHEN** a response omits nothing
- **THEN** it carries the omission enumeration present and empty, rather than absent

#### Scenario: Concise requested returns the bounded response
- **WHEN** `get_workspace_context` is called with `concise: true`
- **THEN** the response is the bounded representation, not the full one

### Requirement: Concise workspace context omits depth, never breadth
Concise `get_workspace_context` SHALL retain every data source, pipeline, dashboard and Output entry that the
full response would have returned, and SHALL NOT reduce the number of entities. It SHALL instead omit
per-entity detail that is not required to bind an Output to a panel: per-step projected column lists on
pipeline steps, and per-column schema listings on data sources. For each omitted list the response SHALL carry
that list's element count in place of the list.

Each Output's own `schema` SHALL be retained in full, because an Output's schema is the grounding source for a
field mapping and omitting it would make the tool unusable for its primary purpose.

#### Scenario: All entities survive concise mode
- **WHEN** a workspace of 25 sources and 43 pipelines is fetched with `concise: true`
- **THEN** all 25 source entries and all 43 pipeline entries are present

#### Scenario: An omitted column list is replaced by its count
- **WHEN** a pipeline step whose full entry lists 60 projected columns is returned in concise mode
- **THEN** the step carries a count of 60 and no column list

#### Scenario: Output schemas survive concise mode
- **WHEN** an Output with a populated schema is returned in concise mode
- **THEN** that Output's schema is present in full

### Requirement: Concise mode brings a realistic workspace under budget
Concise `get_workspace_context` SHALL produce a response whose measured size is under the configured budget for
a workspace of at least 25 data sources and 43 pipelines carrying populated lane trees, per-step column
projections, and Output schemas and placements. The full response for that same workspace SHALL exceed the
budget, so that the bound is demonstrated in both directions.

#### Scenario: Concise fits and full does not
- **WHEN** the same realistic 25-source/43-pipeline workspace is measured in both modes
- **THEN** the concise response is under the budget and the full response is over it

### Requirement: Omission is always detectable by the caller
When concise mode omits anything, the response's truncation report SHALL record that it was applied, and SHALL
enumerate which kinds of detail were omitted. These fields SHALL always be present rather than absent — a
response that omitted nothing SHALL report an applied-false state and an empty enumeration, never a missing
field, so that an omitting response is never indistinguishable from a response with the field unset.

#### Scenario: A concise response reports what it omitted
- **WHEN** a concise response omits per-step column lists
- **THEN** its truncation report records that truncation was applied and names the omitted detail kinds

#### Scenario: A full response still reports an empty, present truncation state
- **WHEN** a full response omits nothing
- **THEN** its truncation report is present with an applied-false state and an empty omission enumeration

### Requirement: Concise analyze is reachable from the agent surface
The `analyze_pipeline` tool SHALL forward a requested concise mode to the pipeline analyze endpoint, so that
the endpoint's concise per-node projection is obtainable through the agent surface rather than only over HTTP.

#### Scenario: Concise analyze is requested through the tool
- **WHEN** `analyze_pipeline` is called with `concise: true`
- **THEN** the request reaches the analyze endpoint with concise mode requested and the concise per-node
  projection is returned

### Requirement: Tool descriptions state size behaviour
Both tools' descriptions SHALL state that a concise mode exists, what it omits, and that the full response may
exceed the budget on a large workspace, so that an agent can predict which mode it needs before calling.

#### Scenario: An agent can predict the mode it needs
- **WHEN** an agent reads either tool's description
- **THEN** the description states the concise mode's existence and its omission rule
