## ADDED Requirements

### Requirement: Analyze offers a concise per-node mode
Analyze SHALL offer a concise mode, selected by an explicit request parameter and never the default,
whose response is a flat array with one entry per node in the pipeline, each carrying that node's
runtime graph path, its op kind, and its validation error if it has one. The concise entry SHALL NOT
carry projected schemas, sample rows, or step configs — omitting them is the whole point of the mode.

The runtime graph path SHALL be the ordered list of ids from the node's originating root to the node
inclusive, joined by `" > "`, with the root rendered as `root:<rootId>`. A node reachable from more
than one root SHALL be addressed by the path through its lowest-positioned originating root, so the
rendering is deterministic.

A node with no validation error SHALL omit the error field rather than carry an empty or null value.

#### Scenario: Concise mode returns one entry per node with its path
- **WHEN** analyze is requested in concise mode for a pipeline with two roots and four steps
- **THEN** the response carries six entries, one per node including each root, each with a path, and
  each step entry with its op kind

#### Scenario: A node's path names its own root
- **WHEN** analyze is requested in concise mode for a pipeline whose second root carries a lane
- **THEN** that lane's nodes carry paths beginning `root:<the second root's id>`, not the first root's

#### Scenario: A rejoin node reachable from two roots takes the lowest-positioned root's path
- **WHEN** a `join` node's parent lane descends from the second root and its `lane`-kind secondary
  input descends from the first
- **THEN** that node's path begins with the first root's id

#### Scenario: A validation error is reported against its node's path
- **WHEN** one step in a lane has a config that fails structural validation
- **THEN** that node's concise entry carries the validation error and no other node's entry does

#### Scenario: Concise mode is materially smaller than the full response
- **WHEN** analyze is requested in both modes for a pipeline of twelve nodes over a forty-column
  source schema
- **THEN** the concise response is smaller than the full response by a margin that holds because
  concise mode carries no projected schemas, and it fits within the MCP result cap while the full
  response does not

#### Scenario: The default response is unchanged
- **WHEN** analyze is requested without the concise parameter
- **THEN** the response is the full per-node projection, byte-identical to what it returned before
  concise mode existed
