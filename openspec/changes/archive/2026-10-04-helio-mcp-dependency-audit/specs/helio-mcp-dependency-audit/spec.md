## Purpose

Keeps helio-mcp's standalone npm dependency tree free of known advisories and gated in CI, so a new advisory fails
the build instead of surfacing only as a Dependabot alert.

## ADDED Requirements

### Requirement: CI audits the helio-mcp lockfile at moderate severity
The CI `security` job SHALL run `audit-ci` against `helio-mcp/package-lock.json` using `helio-mcp/.audit-ci.jsonc`,
which SHALL fail on any advisory of moderate severity or higher that is not allowlisted.

#### Scenario: Vulnerable helio-mcp lockfile fails CI
- **WHEN** `helio-mcp/package-lock.json` resolves a package version with an unallowlisted moderate advisory
- **THEN** the helio-mcp audit step in the `security` job exits non-zero

#### Scenario: Clean helio-mcp lockfile passes CI
- **WHEN** `helio-mcp/package-lock.json` has no unallowlisted advisories of moderate severity or higher
- **THEN** the helio-mcp audit step exits zero

### Requirement: helio-mcp allowlist entries are justified and scoped
Every `allowlist` entry in `helio-mcp/.audit-ci.jsonc` SHALL be a path-scoped advisory id accompanied by a comment
naming the ticket, the reason no patched version is usable, and a review-by date, and SHALL be added only when no
patched version of the affected package exists.

#### Scenario: Patched version available
- **WHEN** an advisory affecting helio-mcp has a published patched version
- **THEN** the lockfile is updated to that version and no allowlist entry is added for it
