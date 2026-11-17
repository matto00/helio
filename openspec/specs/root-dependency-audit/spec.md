# root-dependency-audit Specification

## Purpose
Keeps the root npm dependency tree free of known moderate-or-higher advisories and gated in CI, so a new advisory
fails the build instead of passing silently below the threshold.

## Requirements

### Requirement: CI audits the root lockfile at moderate severity
The CI `security` job SHALL run `audit-ci` against the root `package-lock.json` using the root `.audit-ci.jsonc`,
which SHALL fail on any advisory of moderate severity or higher that is not allowlisted.

#### Scenario: Unallowlisted moderate advisory fails CI
- **WHEN** the root `package-lock.json` resolves a package version with an unallowlisted moderate advisory
- **THEN** the "Frontend audit (root)" step in the `security` job exits non-zero

#### Scenario: Clean root lockfile passes CI
- **WHEN** the root `package-lock.json` has no unallowlisted advisories of moderate severity or higher
- **THEN** the "Frontend audit (root)" step exits zero

### Requirement: root allowlist entries are justified and scoped
Every `allowlist` entry in the root `.audit-ci.jsonc` SHALL be a path-scoped advisory id accompanied by a comment
naming the ticket, the reason no patched or overridable version is usable, the dependency path, and a review-by date.

#### Scenario: Advisory fixable by a version change
- **WHEN** an advisory affecting the root tree can be cleared by a lockfile update or an npm override
- **THEN** the version is changed and no allowlist entry is added for it

### Requirement: root lockfile carries no sprintf-js advisory
The root lockfile SHALL NOT resolve any package affected by GHSA-hp3w-g68c-fv3c.

#### Scenario: Audit after install
- **WHEN** `npm audit` is run at the repo root against the committed lockfile
- **THEN** it reports zero vulnerabilities of moderate severity, and every high-or-critical finding is covered by a
  path-scoped allowlist entry in the root `.audit-ci.jsonc`

### Requirement: root picomatch advisory is allowlisted on dev-tool paths only
The root `.audit-ci.jsonc` SHALL allowlist GHSA-fc5q-39xc-vjpf only through path-scoped entries whose scopes match
the dev/build-tool dependency paths reported for the root lockfile, never a bare advisory id or a package-wide
wildcard, each with a comment naming HEL-1751, the reason, the paths and a review-by date.

#### Scenario: Dev-tool paths pass
- **WHEN** `npx audit-ci --config .audit-ci.jsonc` runs at the repo root against the committed lockfile
- **THEN** it exits zero

#### Scenario: Same advisory via a non-allowlisted path fails
- **WHEN** GHSA-fc5q-39xc-vjpf is reported through a dependency path not matched by any allowlist scope
- **THEN** audit-ci reports it as a vulnerable path and exits non-zero
