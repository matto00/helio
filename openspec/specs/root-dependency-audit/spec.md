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
