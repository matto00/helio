# mcp-pipeline-lane-tools Specification

## Purpose
Covers the MCP-facing view of a branching pipeline: building a multi-root, multi-lane graph with
rejoins in a single `create_pipeline` call, and reading a large graph back within an agent's result
budget rather than by paging through full per-node schema projections.

## Requirements

### Requirement: One create_pipeline call builds a multi-root, multi-lane graph with rejoins
`create_pipeline` SHALL build, in one transactional call, a pipeline with more than one root, more
than one lane, a `join`/`union`/`lookup` step rejoining two lanes via a `lane`-kind secondary input,
and Outputs bound at any node including the rejoin. Every intra-request reference — a step's
`parentStepId`, a parentless step's `rootClientId`, an Output's `nodeStepClientId`, and a rejoin's
`lane`-kind secondary input — SHALL resolve against a request-scoped `clientId` declared earlier in
the same call. Any failure SHALL roll back the whole call, creating nothing.

Verification of this requirement SHALL assert the graph the call produced — each root's id, each
step's parent and originating root, each rejoin's resolved second input, and each Output's node —
not merely that the call returned success.

#### Scenario: A two-root, two-lane pipeline with a join rejoin and three Outputs is built in one call
- **WHEN** `create_pipeline` is called with two roots, a lane under each, a `join` step whose
  `lane`-kind secondary input names the second lane's terminal step, and three Outputs
- **THEN** the pipeline exists with both roots in request order, each lane's parentless step bound to
  the root it named, the join resolving to the named node, and all three Outputs bound to the nodes
  they named

#### Scenario: Placed Outputs from that graph are readable through workspace context
- **WHEN** those three Outputs are placed via `place_outputs`
- **THEN** `get_workspace_context` reports that pipeline with both roots, the whole lane tree
  including the rejoin, and each Output at its own node

#### Scenario: A rejoin naming an unknown clientId creates nothing
- **WHEN** `create_pipeline`'s `join` step names a `lane`-kind secondary input `clientId` absent from
  the request
- **THEN** the call fails with an error naming the unresolved reference and no pipeline, root, step,
  or Output is created

### Requirement: A validation error names the request address that caused it
A validation failure in `create_pipeline` SHALL name the position in the request body that caused
it, addressing the request arrays as `roots[<i>]`, `steps[<i>]`, and `outputs[<i>]`, joined by
`" › "` when the address has more than one segment. This is a request address, distinct from and not
interchangeable with a node's runtime graph path.

#### Scenario: A bad step is addressed by its request position
- **WHEN** the fourth entry of `steps` carries a config that fails validation on a two-root request
- **THEN** the error names `steps[3]`

#### Scenario: A bad root is addressed by its request position
- **WHEN** the second entry of `roots` names an unreadable source
- **THEN** the error names `roots[1]`

### Requirement: analyze_pipeline offers a concise mode within a stated result budget
`analyze_pipeline` SHALL offer a concise mode returning one entry per node with that node's runtime
graph path, op kind, and validation error if any.

The "result cap" this mode exists to fit within SHALL be an explicit, named byte budget introduced
and asserted by this capability. No such cap previously existed anywhere in the codebase, so the
budget is defined here rather than referenced; a test SHALL assert the concise response for a
twelve-node graph over a forty-column source schema is within it, and that assertion SHALL be on the
measured serialized size, not on a proxy for it.

#### Scenario: Concise mode fits the stated budget on the reference graph
- **WHEN** `analyze_pipeline` is called in concise mode on a twelve-node, two-root pipeline over a
  forty-column source schema
- **THEN** the serialized result is within the stated byte budget and carries twelve step entries plus
  one entry per root, each with a path

#### Scenario: The full mode exceeds the budget on the same graph
- **WHEN** `analyze_pipeline` is called without concise mode on that same pipeline
- **THEN** the serialized result exceeds the stated budget, demonstrating the mode is load-bearing
  rather than decorative

#### Scenario: Concise mode is opt-in
- **WHEN** `analyze_pipeline` is called with no mode parameter
- **THEN** the full per-node projection is returned
