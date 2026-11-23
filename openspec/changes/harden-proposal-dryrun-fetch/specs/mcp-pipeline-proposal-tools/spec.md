## ADDED Requirements

### Requirement: propose_pipeline's description matches the dry run
helio-mcp's `propose_pipeline` tool description SHALL state that propose runs apply's pre-write checks as a dry run
(writing nothing), including SQL read-only checks and one live, source-fetch-rate-limited schema fetch per inline rest
or sql root, and SHALL NOT claim that any of those checks happen only at apply time.

#### Scenario: Description no longer claims apply-only SQL validation
- **WHEN** the registered `propose_pipeline` tool's description is read
- **THEN** it does not contain "never re-validated here", and it mentions the dry run and the live schema fetch
