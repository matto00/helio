# ci-production-image-build Specification

## Purpose
Ensures every pull request and main push proves the production backend container image still builds, so a break that
only the deploy path exercises fails CI instead of a release.

## Requirements

### Requirement: CI builds the production backend image
The CI workflow SHALL build the repository's root `Dockerfile` through its final stage on every pull request targeting
`main` and every push to `main`, using the same build context as the deploy workflow, without authenticating to or
pushing to any container registry.

#### Scenario: PR that breaks only the image build
- **WHEN** a pull request removes the `COPY backend/project/*.scala backend/project/` line from the `Dockerfile`
- **THEN** the image-build job fails at the dependency-resolution step and the PR's CI run does not pass

#### Scenario: PR with a buildable image
- **WHEN** a pull request leaves the image buildable
- **THEN** the image-build job succeeds and nothing is pushed to any registry

### Requirement: The required aggregate check gates on the image build
The `ci-complete` check SHALL depend on the image-build job and SHALL fail whenever that job fails or is cancelled.

#### Scenario: image build fails
- **WHEN** the image-build job concludes `failure`
- **THEN** `ci-complete` concludes `failure`

#### Scenario: image build succeeds
- **WHEN** the image-build job and every other required job succeed
- **THEN** `ci-complete` concludes `success`

### Requirement: The image build does not consume the Actions cache budget
The image-build job SHALL NOT save any GitHub Actions cache entry, and SHALL NOT alter any existing cache key, path or
restore/save behaviour of other CI jobs.

#### Scenario: PR run with the image build
- **WHEN** a pull request's CI run completes
- **THEN** no Actions cache entry created by the image-build job exists for that PR's ref
