## ADDED Requirements

### Requirement: get_output_provenance MCP tool
helio-mcp SHALL expose `get_output_provenance(outputId)` returning the authenticated provenance response unchanged, with tool copy that states the backend's actual status codes as probed against a running backend.

#### Scenario: Agent reads provenance
- **WHEN** an agent calls `get_output_provenance` with a readable Output id
- **THEN** it receives sources, pipeline, node path, last run and assertion counts

#### Scenario: Unreadable Output
- **WHEN** the Output does not exist or is not readable
- **THEN** the tool surfaces the backend's 404 as an error
