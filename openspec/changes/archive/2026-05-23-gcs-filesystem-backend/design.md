## Context

The backend uses a `FileSystem` trait (introduced HEL-41, hardened HEL-269) to abstract file I/O. The single implementation — `LocalFileSystem` — writes to a host-local directory resolved from `HELIO_UPLOADS_ROOT`. On Cloud Run every revision gets an ephemeral container; any file written to the local disk is gone the next request if the container recycles, causing 404 preview and 422 pipeline-exec errors in production.

The GCS bucket (`gs://helio-uploads-prod`, us-west1) and IAM binding for `helio-backend-sa` are already provisioned. Application Default Credentials (ADC) are available on Cloud Run automatically via the runtime service account; local developers opt-in via `gcloud auth application-default login`.

## Goals / Non-Goals

**Goals:**
- Add `GcsFileSystem` implementing `FileSystem` using the GCS Java SDK.
- Select backend at startup via `HELIO_UPLOADS_BACKEND` (`local` | `gcs`).
- Require `HELIO_UPLOADS_BUCKET` when `HELIO_UPLOADS_BACKEND=gcs`.
- No code change at any call site (trait boundary is preserved).

**Non-Goals:**
- Signed URLs or direct client uploads.
- S3 / ADLS implementations (env-knob design leaves this open).
- Migration of existing local-dev upload files to GCS.

## Decisions

**D1 — GCS Java SDK via `com.google.cloud:google-cloud-storage`**
The existing dep `com.google.cloud.sql:postgres-socket-factory` already pulls in `com.google.auth` transitives; adding `google-cloud-storage` (BOM-managed) is safe. The SDK wraps ADC automatically — no credentials management needed in code.

**D2 — Dual-knob config (`HELIO_UPLOADS_BACKEND` + `HELIO_UPLOADS_BUCKET`) rather than a single URL**
A future swap to S3 or ADLS requires only adding a new branch and env vars; no existing call sites change. `HELIO_UPLOADS_ROOT` for local FS and `HELIO_UPLOADS_BUCKET` for GCS follow the same pattern as the database URL vs individual DB params already in `backend-env-config`.

**D3 — `GcsFileSystem` companion `fromEnv()` mirrors `LocalFileSystem.fromEnv()`**
`Main.scala` switches on `HELIO_UPLOADS_BACKEND` and calls the appropriate `fromEnv()`. All selection logic stays in one place; call sites inject `FileSystem` by trait.

**D4 — `list(prefix)` returns object names relative to the bucket root**
Callers (pipeline engine, CSV connector) use relative paths consistently across both implementations. GCS object names are already flat strings — the relative key is the full object name.

**D5 — Fail-fast on startup if `HELIO_UPLOADS_BACKEND=gcs` but `HELIO_UPLOADS_BUCKET` is absent**
Mirrors the `requireEnv` pattern already in `Main.scala`. Prevents silent misconfiguration on Cloud Run.

## Risks / Trade-offs

[GCS SDK transitive conflicts with Spark Jackson overrides] → Mitigation: `dependencyOverrides` in `build.sbt` already pins Jackson 2.15.4; BOM import covers the rest. Verify with `sbt dependencyTree` after adding dep.

[Cold-start latency for first GCS call] → Mitigation: ADC initialisation is lazy in the SDK; first upload pays the token-exchange cost. Acceptable for upload path; not in hot query path.

[GCS `list()` pagination] → Mitigation: GCS returns up to 1000 objects per page. Current usage is per-datasource scoped; no datasource will have thousands of objects. Add pagination TODO comment for future.

## Migration Plan

1. Merge and deploy new image with `HELIO_UPLOADS_BACKEND` unset → falls back to `local` (no change in behaviour).
2. Set `HELIO_UPLOADS_BACKEND=gcs` and `HELIO_UPLOADS_BUCKET=helio-uploads-prod` in Cloud Run service env and redeploy.
3. Existing uploads on ephemeral disk are already gone after any prior restart — no migration needed.
4. **Rollback**: remove `HELIO_UPLOADS_BACKEND` from Cloud Run env vars and redeploy. Falls back to `local`.

## Planner Notes

- Self-approved: pure additive backend change; no API surface change; no schema change; no frontend changes.
- Ticket context confirms bucket + IAM already provisioned — no infra escalation needed.
- `google-cloud-storage` version pinned to 2.40.1 (latest stable at planning time); BOM ensures transitive alignment.
