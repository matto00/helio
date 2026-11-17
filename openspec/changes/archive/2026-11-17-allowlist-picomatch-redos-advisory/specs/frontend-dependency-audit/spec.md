## ADDED Requirements

### Requirement: frontend picomatch advisory is allowlisted on dev-tool paths only
`frontend/.audit-ci.jsonc` SHALL allowlist GHSA-fc5q-39xc-vjpf only through path-scoped entries whose scopes match
the dev/build-tool dependency paths reported for the frontend/ lockfile, never a bare advisory id or a package-wide
wildcard, each with a comment naming HEL-1751, the reason, the paths and a review-by date.

#### Scenario: Dev-tool paths pass
- **WHEN** `npx audit-ci --config .audit-ci.jsonc` runs in `frontend/` against the committed lockfile
- **THEN** it exits zero

#### Scenario: Same advisory via a non-allowlisted path fails
- **WHEN** GHSA-fc5q-39xc-vjpf is reported through a dependency path not matched by any allowlist scope
- **THEN** audit-ci reports it as a vulnerable path and exits non-zero

## MODIFIED Requirements

### Requirement: frontend lockfile carries no sprintf-js advisory
The frontend/ lockfile SHALL NOT resolve any package affected by GHSA-hp3w-g68c-fv3c.

#### Scenario: Audit after install
- **WHEN** `npm audit` is run in `frontend/` against the committed lockfile
- **THEN** it reports zero vulnerabilities of moderate severity, and every high-or-critical finding is covered by a
  path-scoped allowlist entry in `frontend/.audit-ci.jsonc`
