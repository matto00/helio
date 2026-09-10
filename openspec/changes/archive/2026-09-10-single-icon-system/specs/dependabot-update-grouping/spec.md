## REMOVED Requirements

### Requirement: Co-versioned families arrive as a single pull request
**Reason**: `@fortawesome/*` is removed from `frontend/package.json` (HEL-443) — the `fortawesome`
Dependabot group and `DECLARED_FAMILIES` entry it names no longer exist.
**Migration**: Replaced by "Co-versioned families arrive as a single pull request (post-fortawesome)",
below, which is identical except the FontAwesome scenario is replaced by an `echarts` one.

## ADDED Requirements

### Requirement: Co-versioned families arrive as a single pull request (post-fortawesome)

Dependency packages that share a compile-time or runtime contract SHALL be declared as a named
Dependabot group so that an upgrade to any member arrives in the same pull request as the
corresponding upgrades to every other member.

A family qualifies as co-versioned when a version mismatch between its members can fail a build or
verification gate that each member would pass on its own. The declared families are recorded in the
change's design document, each with the contract that binds it.

#### Scenario: echarts family upgrades together

- **WHEN** Dependabot finds new versions for any of `echarts` or `echarts-for-react`
- **THEN** all available upgrades among those two packages are proposed in one pull request, not one
  pull request per package

#### Scenario: An unrelated package is not swept into a family group

- **WHEN** Dependabot finds a new version for a production dependency that belongs to no declared
  family, such as `axios`
- **THEN** that upgrade is proposed on its own and is not attached to any family group
