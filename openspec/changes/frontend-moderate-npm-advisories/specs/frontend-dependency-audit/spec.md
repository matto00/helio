## Purpose

Keeps the frontend/ npm dependency tree free of known moderate-or-higher advisories and gated in CI, so a new advisory
fails the build instead of passing silently below the threshold.

## ADDED Requirements

### Requirement: CI audits the frontend lockfile at moderate severity
The CI `security` job SHALL run `audit-ci` against `frontend/package-lock.json` using `frontend/.audit-ci.jsonc`,
which SHALL fail on any advisory of moderate severity or higher that is not allowlisted.

#### Scenario: Unallowlisted moderate advisory fails CI
- **WHEN** `frontend/package-lock.json` resolves a package version with an unallowlisted moderate advisory
- **THEN** the "Frontend audit (frontend/)" step in the `security` job exits non-zero

#### Scenario: Clean frontend lockfile passes CI
- **WHEN** `frontend/package-lock.json` has no unallowlisted advisories of moderate severity or higher
- **THEN** the "Frontend audit (frontend/)" step exits zero

### Requirement: frontend allowlist entries are justified and scoped
Every `allowlist` entry in `frontend/.audit-ci.jsonc` SHALL be a path-scoped advisory id accompanied by a comment
naming the ticket, the reason no patched or overridable version is usable, the dependency path, and a review-by date.

#### Scenario: Advisory fixable by a version change
- **WHEN** an advisory affecting frontend/ can be cleared by a lockfile update or an npm override
- **THEN** the version is changed and no allowlist entry is added for it

### Requirement: frontend lockfile carries no sprintf-js advisory
The frontend/ lockfile SHALL NOT resolve any package affected by GHSA-hp3w-g68c-fv3c.

#### Scenario: Audit after install
- **WHEN** `npm audit` is run in `frontend/` against the committed lockfile
- **THEN** it reports zero vulnerabilities of moderate severity or higher
