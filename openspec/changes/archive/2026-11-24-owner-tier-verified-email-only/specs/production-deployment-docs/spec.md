## ADDED Requirements

### Requirement: Owner allowlist is a Secret Manager secret, never a literal deploy flag
The owner-email allowlist (`HELIO_OWNER_EMAILS`) SHALL be injected into the backend service from the
Secret Manager secret `helio-owner-emails` by both deploy paths (`.github/workflows/cd-backend.yml`
via `--update-secrets`, `infra/deploy-backend.sh` via `--set-secrets`). Neither deploy path's
environment-variable flag (`--update-env-vars` / `--set-env-vars`) SHALL contain `HELIO_OWNER_EMAILS`
or any email address. A CI check SHALL fail when either does.

#### Scenario: Deploy configs carry no literal address
- **WHEN** the CI deploy-config guard runs on the repository
- **THEN** it passes, and both deploy paths map `HELIO_OWNER_EMAILS` to `helio-owner-emails:latest`

#### Scenario: A literal address reappears in an env-vars flag
- **WHEN** an email address or a `HELIO_OWNER_EMAILS=` entry is added to either deploy path's
  env-vars flag
- **THEN** the CI deploy-config guard fails and names the file

### Requirement: Workflow files carry no personal email address
No tracked file under `.github/workflows/` and no `gcloud run deploy` invocation in
`infra/deploy-backend.sh` SHALL contain an email address other than a reserved example-domain
address (`example.com`, `example.test`, `example.org`) or an address on the guard's explicit
allowlist of non-personal addresses. A CI check SHALL fail when one appears, and SHALL NOT embed the
value it is guarding against.

#### Scenario: A personal address appears in a workflow file
- **WHEN** an email address on a non-example, non-allowlisted domain is added anywhere in a workflow
  file, including a comment
- **THEN** the CI deploy-config guard fails and names the file

#### Scenario: Example and allowlisted addresses pass
- **WHEN** a workflow file contains only `owner@example.com`-style addresses or allowlisted
  non-personal addresses
- **THEN** the guard passes
