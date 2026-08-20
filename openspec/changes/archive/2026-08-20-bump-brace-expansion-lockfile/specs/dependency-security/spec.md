# dependency-security (delta)

Note: infra-only change — this delta exists to make the version floor testable for evaluation;
the change is archived with `--skip-specs` (no canonical spec merge), per proposal.md, matching
the precedent set by HEL-688's own `dependency-security` delta.

## ADDED Requirements

### Requirement: npm lockfiles carry no vulnerable brace-expansion version

Every installed instance of `brace-expansion` in the root lockfile SHALL be at or beyond the
first-patched version for both GHSA-mh99-v99m-4gvg and GHSA-rgw5-rvv9-x895, and the same SHALL
hold for `frontend/` and `helio-mcp/` if they are independently affected.

#### Scenario: Lockfile version floor holds for every installed instance

- **WHEN** each lockfile is inspected (`npm ls brace-expansion` / lockfile grep) for the
  `brace-expansion` package
- **THEN** every installed instance resolves at or beyond the required first-patched version, with
  no vulnerable duplicate at another tree position

### Requirement: Root npm audit reports zero findings for this advisory pair

`npm audit` at the repo root SHALL report no findings for GHSA-mh99-v99m-4gvg or GHSA-rgw5-rvv9-x895
after the bump.

#### Scenario: Root audit is clean for this advisory pair

- **WHEN** `npm audit` is run at the repo root
- **THEN** neither GHSA-mh99-v99m-4gvg nor GHSA-rgw5-rvv9-x895 appears in the report

### Requirement: Test and lint suites stay green after the bump

Root `npm test` and lint SHALL continue to pass after the `brace-expansion` version bump, with no
functional regression introduced.

#### Scenario: Root test suite passes

- **WHEN** `npm test` is run at the repo root after the bump
- **THEN** the suite passes with no new failures attributable to the bump

#### Scenario: Root lint passes

- **WHEN** lint is run at the repo root after the bump
- **THEN** lint reports no new errors or warnings attributable to the bump
