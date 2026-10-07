# ci-security-job-reporting Specification

## Purpose
Keeps the CI `security` job's dependency audits independently visible and bounded in time, so one failing audit
cannot hide another audit's findings and a hung SBOM step fails fast instead of holding a runner.

## Requirements

### Requirement: Every audit step in the security job reports independently
In the CI `security` job, each audit step SHALL run whenever its own setup prerequisites succeeded and the run was
not cancelled. No audit, and no setup step an audit depends on, SHALL be skipped merely because a step that is not among that
audit's prerequisites failed. Each audit SHALL run even if an earlier audit step in the same job failed. The audit steps are the frontend root audit,
the frontend/ audit, the helio-mcp audit, and the backend SBOM scan chain. The job's conclusion SHALL remain
`failure` whenever any of its steps failed.

#### Scenario: An earlier audit fails and a later audit still runs
- **WHEN** "Frontend audit (frontend/)" exits non-zero
- **THEN** "helio-mcp audit (helio-mcp/)" still executes and its result appears in the job log
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

### Requirement: The backend SBOM step is time-bounded
"Generate backend SBOM" SHALL declare a step-level timeout. The bound SHALL be several times its measured typical
duration, and small enough that the job's remaining steps can still finish inside the job-level timeout after a hung
SBOM step is killed.

#### Scenario: The SBOM step hangs
- **WHEN** "Generate backend SBOM" stops making progress
- **THEN** the step fails at its declared timeout, well before the job timeout
- **AND** the npm audit steps still run and report
- **AND** the `security` job's conclusion is `failure`

### Requirement: The osv-scanner steps are time-bounded
"Install osv-scanner" (the binary download) and "Scan backend SBOM (osv-scanner)" SHALL each declare a step-level
`timeout-minutes` of two to three times their measured typical duration (rounded up to whole minutes), small enough
that the security job's remaining steps can still run inside the job-level timeout after either step is killed.

#### Scenario: The osv-scanner download stalls
- **WHEN** the osv-scanner download stops making progress
- **THEN** "Install osv-scanner" fails at its declared timeout, well before the job timeout
- **AND** the scan step is skipped rather than run against a missing binary
- **AND** the npm audit steps still run and report, and the `security` job's conclusion is `failure`

#### Scenario: The scan stalls
- **WHEN** "Scan backend SBOM (osv-scanner)" stops making progress
- **THEN** it fails at its declared timeout and the CVSS threshold step is skipped, never treated as a clean scan
