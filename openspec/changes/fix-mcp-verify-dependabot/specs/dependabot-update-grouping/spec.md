## ADDED Requirements

### Requirement: helio-mcp receives grouped automatic update pull requests

The Dependabot configuration SHALL include an npm update configuration for the `helio-mcp` package on the same
weekly cadence and labelling as the other npm configurations, with `@modelcontextprotocol/sdk` and its peer `zod`
declared as one co-versioned family group ahead of the development-dependency catch-all, and the grouping validation
check SHALL cover that family.

#### Scenario: SDK and zod upgrade together

- **WHEN** Dependabot finds new versions for `@modelcontextprotocol/sdk` or `zod` in `helio-mcp`
- **THEN** the available upgrades are proposed in one pull request

#### Scenario: Grouping check covers helio-mcp

- **WHEN** the grouping validation check runs and a `helio-mcp` production dependency belongs to no declared family
  or independent entry
- **THEN** the check exits non-zero naming the dependency
