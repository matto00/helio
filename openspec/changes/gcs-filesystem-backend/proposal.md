## Why

Uploads written by Cloud Run are lost on every restart or scale event because `LocalFileSystem` writes to the container's ephemeral local disk. This causes 404s on preview and 422s on pipeline execution after any deploy — a P0 regression in production today.

## What Changes

- Add `GcsFileSystem` implementing the existing `FileSystem` trait, backed by `gs://helio-uploads-prod` via the GCS Java SDK.
- Add `HELIO_UPLOADS_BACKEND` (`local` | `gcs`, default `local`) and `HELIO_UPLOADS_BUCKET` env vars.
- `Main.scala` selects `GcsFileSystem` or `LocalFileSystem` based on `HELIO_UPLOADS_BACKEND`.
- Add `com.google.cloud:google-cloud-storage` to `build.sbt`.
- Document the two new env vars in `.env.example` and production deployment docs.
- No API changes; the `FileSystem` trait contract is unchanged.

## Capabilities

### New Capabilities
- `gcs-filesystem`: `GcsFileSystem` implementation of the `FileSystem` trait; upload-backend selection via env config.

### Modified Capabilities
- `filesystem-abstraction`: `LocalFileSystem` base-path resolution requirement updated — `HELIO_UPLOADS_ROOT`/`HELIO_UPLOADS_DIR` stays; companion selection logic moves into shared factory.
- `backend-env-config`: Two new env vars (`HELIO_UPLOADS_BACKEND`, `HELIO_UPLOADS_BUCKET`) added to the env-config spec.

## Impact

- **Backend**: new `GcsFileSystem.scala`; `Main.scala` wiring change; `build.sbt` dependency addition.
- **Infra**: GCS bucket and IAM binding already provisioned; Cloud Run service env vars need updating at deploy time.
- **No frontend changes.**
- **No schema changes.**

## Non-goals

- Migration of existing local-dev uploads to GCS.
- S3 / ADLS implementations (env-knob design keeps them possible later).
- Signed URL generation or direct client uploads.
