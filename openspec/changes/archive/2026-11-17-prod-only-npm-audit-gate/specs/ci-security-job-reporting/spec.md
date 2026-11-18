## MODIFIED Requirements

### Requirement: Every audit step in the security job reports independently
In the CI `security` job, each audit step SHALL run whenever its own setup prerequisites succeeded and the run was
not cancelled. No audit, and no setup step an audit depends on, SHALL be skipped merely because a step that is not among that
audit's prerequisites failed. Each audit SHALL run even if an earlier audit step in the same job failed. The audit steps are the frontend root audit,
the frontend/ audit, the helio-mcp audit, the three production-only audits (root, frontend/, helio-mcp/), and the
backend SBOM scan chain. The job's conclusion SHALL remain `failure` whenever any of its steps failed.

#### Scenario: An earlier audit fails and a later audit still runs
- **WHEN** "Frontend audit (frontend/)" exits non-zero
- **THEN** "helio-mcp audit (helio-mcp/)" still executes and its result appears in the job log
- **AND** the `security` job's conclusion is `failure`

#### Scenario: An allowlisted audit fails and the production-only audits still run
- **WHEN** any audit-ci step exits non-zero
- **THEN** every production-only audit step still executes and its result appears in the job log
- **AND** the `security` job's conclusion is `failure`

#### Scenario: All audits pass
- **WHEN** every audit step exits zero
- **THEN** the `security` job's conclusion is `success`

#### Scenario: An npm install fails but the backend scan's prerequisites succeed
- **WHEN** `npm ci` or `npm --prefix frontend ci` fails while the java and sbt setup steps succeed
- **THEN** the backend SBOM generation and osv-scanner/CVSS steps still run and report

#### Scenario: A java or sbt setup step fails but the npm path's prerequisites succeed
- **WHEN** the java setup, sbt setup or sbt cache step fails while the node setup and both npm installs succeed
- **THEN** the root, frontend/ and helio-mcp npm audits still run and report
- **AND** the `security` job's conclusion is `failure`

#### Scenario: The root npm install fails but the frontend install succeeds
- **WHEN** root `npm ci` fails while the node setup and `npm --prefix frontend ci` succeed
- **THEN** "Frontend audit (frontend/)" still runs and reports
- **AND** the `security` job's conclusion is `failure`

#### Scenario: A setup prerequisite fails
- **WHEN** an audit's own dependency-install step fails
- **THEN** that audit step is skipped rather than run against a missing install, and the job's conclusion is
  `failure`
