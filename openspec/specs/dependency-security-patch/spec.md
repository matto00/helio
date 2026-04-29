# dependency-security-patch Specification

## Purpose
Constrains `follow-redirects` to `>=1.16.0` via an npm overrides entry to prevent auth header leakage on cross-domain redirects.
## Requirements
### Requirement: follow-redirects version constraint
The project SHALL constrain `follow-redirects` to `>=1.16.0` via an npm `overrides` entry in `frontend/package.json` to prevent auth header leakage on cross-domain redirects.

#### Scenario: Dependency resolved to safe version
- **WHEN** `npm install` is run in the `frontend/` directory
- **THEN** the resolved version of `follow-redirects` is `>=1.16.0`

#### Scenario: Audit passes
- **WHEN** `npm audit` is run in the `frontend/` directory
- **THEN** no findings are reported for `follow-redirects`

