## ADDED Requirements

### Requirement: The runtime image stores the application jar once
The production backend image's runtime stage SHALL contain the application jar in exactly one image layer, already
owned by the runtime user, and SHALL NOT include a later layer that rewrites the jar only to change its ownership or
permissions. The runtime contract SHALL be unchanged by this: the same files under `/app`, `/app/helio-backend.jar` and
`/app/data` owned by the `helio` user and group, the same non-root `USER`, `ENTRYPOINT`, `HEALTHCHECK`, `EXPOSE` and
`WORKDIR`.

#### Scenario: Image history after a build
- **WHEN** the root `Dockerfile` is built through its final stage and its layer history is listed
- **THEN** the layer that copies the application jar is the only layer containing it, and no `RUN` layer re-stores it

#### Scenario: Ownership inside the image
- **WHEN** the built image's `/app/helio-backend.jar` and `/app/data` are inspected
- **THEN** both are owned by `helio:helio`, and the container runs as `helio`
