# dependency-security (delta)

Note: infra-only change — this delta exists to make the version floors testable for evaluation;
the change is archived with `--skip-specs` (no canonical spec merge), per proposal.md.

## ADDED Requirements

### Requirement: npm lockfiles carry no scoped Dependabot-flagged vulnerable versions

Every installed instance of a package flagged by the 35 scoped Dependabot alerts SHALL be at or beyond that
advisory's first-patched version in the owning lockfile: frontend — `axios >= 1.18.0`, `react-router >= 7.18.2`,
`postcss >= 8.5.23`, `fast-uri >= 3.1.5`, `brace-expansion >= 1.1.16` (1.x) / `>= 2.1.2` (2.x),
`js-yaml >= 3.15.1` (3.x), `sharp >= 0.35.0`; helio-mcp — `hono >= 4.12.34`, `ip-address >= 10.3.1`,
`fast-uri >= 3.1.5`, `@hono/node-server >= 1.19.15`; root — `js-yaml >= 3.15.1` (3.x) / `>= 4.3.1` (4.x).

#### Scenario: Lockfile version floors hold for every installed instance

- **WHEN** each of the three lockfiles is inspected (`npm ls <pkg>` / lockfile grep) for every flagged package
- **THEN** every installed instance of that package resolves at or beyond the required first-patched version,
  with no vulnerable duplicate at another tree position

### Requirement: Runtime-critical frontend upgrades preserve request and routing behavior

The frontend SHALL exhibit no functional regression in axios-based HTTP calls or react-router navigation after
the upgrades, verified in the running app rather than by unit tests alone.

#### Scenario: axios request paths behave unchanged

- **WHEN** the app is exercised live (login, dashboard list GET, dashboard create/duplicate POST, appearance PATCH,
  plus one error-path request)
- **THEN** all requests succeed/fail exactly as before the bump, interceptor behavior is unchanged, and the browser
  console shows no new errors

#### Scenario: react-router navigation behaves unchanged

- **WHEN** navigating between dashboards via links, loading a dashboard route by direct URL, and using browser
  back/forward
- **THEN** routes resolve as before the bump with no console errors
