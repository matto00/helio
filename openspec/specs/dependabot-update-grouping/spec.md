# dependabot-update-grouping Specification

## Purpose
Ensures dependency packages that share a compile-time or runtime contract are upgraded together in a single Dependabot pull request, and that the grouping is enforced by a check rather than maintained by convention.

## Requirements

### Requirement: Co-versioned families arrive as a single pull request

Dependency packages that share a compile-time or runtime contract SHALL be declared as a named Dependabot group so that an upgrade to any member arrives in the same pull request as the corresponding upgrades to every other member.

A family qualifies as co-versioned when a version mismatch between its members can fail a build or verification gate that each member would pass on its own. The declared families are recorded in the change's design document, each with the contract that binds it.

#### Scenario: FontAwesome family upgrades together

- **WHEN** Dependabot finds new versions for any of `@fortawesome/fontawesome-svg-core`, `@fortawesome/free-brands-svg-icons`, `@fortawesome/free-solid-svg-icons`, or `@fortawesome/react-fontawesome`
- **THEN** all available upgrades among those four packages are proposed in one pull request, not one pull request per package

#### Scenario: An unrelated package is not swept into a family group

- **WHEN** Dependabot finds a new version for a production dependency that belongs to no declared family, such as `axios`
- **THEN** that upgrade is proposed on its own and is not attached to any family group

### Requirement: Group assignment is unambiguous under first-match semantics

Dependabot assigns each dependency to the first group whose criteria it matches, in the order the groups are declared. The configuration SHALL therefore declare specific pattern-based groups before any broader catch-all group, so that a dependency named by a specific family group is never captured by a catch-all that also matches it.

#### Scenario: A dev-typed family member resolves to its family group

- **WHEN** a package is named by a pattern-based family group and would also match a broader `dependency-type`-based group in the same update configuration
- **THEN** the package resolves to the pattern-based family group

### Requirement: Grouping is mechanically enforced

The repository SHALL provide a validation check that reads the dependency manifests and the Dependabot configuration, applies Dependabot's first-match group-assignment semantics, and fails when a declared co-versioned family does not resolve to exactly one group.

The check SHALL fail — not merely warn — when a declared family member is ungrouped, is split across two groups, or is absent from the manifest it is declared against. The check SHALL run as part of the commit gate chain and as part of the `frontend` continuous-integration job.

#### Scenario: Configuration that splits a family is rejected

- **WHEN** the validation check runs against a Dependabot configuration in which a declared co-versioned family's members do not all resolve to the same group
- **THEN** the check exits non-zero and names the offending family and the groups its members resolved to

#### Scenario: Configuration that groups every family is accepted

- **WHEN** the validation check runs against a Dependabot configuration in which every declared co-versioned family resolves to exactly one group
- **THEN** the check exits zero

#### Scenario: A family declared against a package absent from the manifest is rejected

- **WHEN** the validation check runs and a declared family names a package that is not present in the manifest for that update configuration's directory
- **THEN** the check exits non-zero, so that the declaration cannot silently drift out of step with the manifest
