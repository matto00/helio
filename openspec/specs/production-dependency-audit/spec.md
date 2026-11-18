# production-dependency-audit Specification

## Purpose
Ensures a production npm dependency with a known moderate-or-higher advisory always fails CI, independently of any
audit-ci allowlist, so a dev-only allowlist entry can never hide a production advisory.

## Requirements

### Requirement: CI audits production dependencies of every npm tree with no allowlist
The CI `security` job SHALL audit the production (non-dev) dependencies of the root, `frontend/` and `helio-mcp/`
committed lockfiles at moderate severity. These audits SHALL NOT read any `.audit-ci.jsonc` file and SHALL NOT
accept any allowlist, suppression or exception: any moderate-or-higher advisory reachable from a production
dependency SHALL fail its step.

#### Scenario: Production dependency with an advisory allowlisted for dev paths
- **WHEN** a lockfile resolves a production dependency affected by an advisory that the tree's `.audit-ci.jsonc`
  allowlists on dev-only paths (e.g. a production `micromatch@4.0.8` against GHSA-fc5q-39xc-vjpf at the root)
- **THEN** the existing audit-ci step for that tree passes
- **AND** that tree's production-only audit step exits non-zero

#### Scenario: Dev-only advisory
- **WHEN** an advisory is reachable only through dev dependencies
- **THEN** the production-only audit step for that tree exits zero

#### Scenario: Clean production tree
- **WHEN** a tree's production dependencies have no advisory of moderate severity or higher
- **THEN** that tree's production-only audit step exits zero

#### Scenario: Audit cannot complete
- **WHEN** the production-only audit cannot reach the advisory database or otherwise errors
- **THEN** the step exits non-zero rather than passing

### Requirement: Unpatched production advisories allow no in-repo exception
A production advisory with no patched release SHALL NOT be suppressed in the repository by any allowlist, config
entry or `continue-on-error`. Resolving one SHALL require an owner decision recorded in a separate ticket (remove or
replace the dependency, or an owner-approved change to this gate made in that ticket).

#### Scenario: Unpatched production advisory appears
- **WHEN** a production dependency gains a moderate-or-higher advisory with no patched release
- **THEN** the production-only audit step stays red until the dependency is removed or replaced, or the owner
  approves a gate change in a separate ticket
