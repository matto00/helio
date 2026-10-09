# ci-base-image-pulls Specification

## Purpose
Defines where CI pulls third-party container images from (a public Docker Hub mirror, so shared runner IPs never hit the anonymous pull limit), that the deploy build keeps its Docker Hub base references, and that a failed pull fails CI loudly.

## Requirements

### Requirement: CI pulls Docker Hub library images through a public mirror
The CI workflow SHALL obtain every Docker Hub library image it uses — the production image build's base images and the
e2e database service image — from the `mirror.gcr.io` public mirror, without authenticating to any registry and without
any repository secret.

#### Scenario: docker-image job resolves its base images
- **WHEN** the CI image-build job builds the root `Dockerfile`
- **THEN** both base images are resolved from `mirror.gcr.io/library/...` and no request for them goes to `registry-1.docker.io`

#### Scenario: e2e shards start their database service
- **WHEN** any e2e shard starts its PostgreSQL service container
- **THEN** the image is pulled from `mirror.gcr.io/library/postgres` with the same tag as before

### Requirement: The deploy build keeps today's base image references
Building the root `Dockerfile` without build arguments SHALL resolve the same fully-qualified base image references as
before this change (`docker.io/library/eclipse-temurin:21-jdk-jammy` and `docker.io/library/eclipse-temurin:21-jre-alpine`),
and the deploy workflow SHALL NOT be changed.

#### Scenario: CD builds the release image
- **WHEN** `cd-backend.yml` runs `docker build` with no build arguments
- **THEN** the builder and runtime stages resolve from Docker Hub with the same tags, so the release image's base digests are those Docker Hub serves for those tags

### Requirement: A failed mirror pull fails CI loudly
A failed pull from the mirror SHALL fail the job that needed it, with no silent fallback to another registry and no
skipped job, so the required aggregate check fails.

#### Scenario: mirror unavailable or rate limited
- **WHEN** the image-build job or an e2e shard cannot pull its image from the mirror
- **THEN** that job concludes `failure` and `ci-complete` concludes `failure`
