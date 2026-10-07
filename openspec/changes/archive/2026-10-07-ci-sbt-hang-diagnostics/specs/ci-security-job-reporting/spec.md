## ADDED Requirements

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
