# HEL-125: Replace LocalFileSystem with GCS-backed FileSystem for Cloud Run

## Title
Replace LocalFileSystem with GCS-backed FileSystem for Cloud Run

## Description
The backend currently uses `LocalFileSystem` which writes uploads to the container's local disk (`./data/uploads`). On Cloud Run this data is lost on every restart or scale event. Replace it with a `GcsFileSystem` implementation backed by a Cloud Storage bucket.

## What "done" looks like
- A GCS bucket created for Helio uploads (`gs://helio-uploads-prod` in us-west1, Standard, uniform access, public-access-prevention enforced — already provisioned)
- `GcsFileSystem` class implementing the existing `FileSystem` trait using the GCS Java SDK
- `LocalFileSystem` still used in local dev (selected via env var)
- Cloud Run wired to use `GcsFileSystem` via dual-knob env config:
  - `HELIO_UPLOADS_BACKEND` = `local` | `gcs` (default `local`)
  - `HELIO_UPLOADS_BUCKET` = `helio-uploads-prod` (required when backend=gcs)
- Cloud Run runtime service account (`helio-backend-sa@helio-493120.iam.gserviceaccount.com`) has `roles/storage.objectAdmin` on the bucket (already bound)
- Uploads and reads work end-to-end in production
- Local dev defaults to local FS (HELIO_UPLOADS_ROOT, already exists from HEL-269)

## Implementation notes
- The `FileSystem` trait is already abstracted (HEL-41) — only need to add `GcsFileSystem` and update the wiring in `Main.scala`
- Use `com.google.cloud.google-cloud-storage` Java SDK
- Cloud Run authenticates via the runtime service account's ADC — no explicit credentials needed
- Keep `LocalFileSystem` as the default for local dev to avoid requiring GCS locally
- Local dev auth: user will run `gcloud auth application-default login` for ADC when testing with GCS locally

## Acceptance criteria
- Upload CSV → restart Cloud Run revision (or deploy new) → preview + pipeline exec still work without re-uploading
- Production 404 on `/api/data-sources/:id/preview?limit=25` after deploy is resolved (file was on ephemeral disk)
- Production 422 on pipeline exec against CSV source is resolved (same root cause)

## GCP setup (already done)
- Bucket: `gs://helio-uploads-prod` (us-west1, Standard, uniform access, public-access-prevention enforced)
- IAM: `helio-backend-sa@helio-493120.iam.gserviceaccount.com` has `roles/storage.objectAdmin` on the bucket

## Design decisions
- Dual-knob config keeps ability to swap backends (may migrate to S3/ADLS later)
- HELIO_UPLOADS_BACKEND: `local` | `gcs` (default: `local`)
- HELIO_UPLOADS_BUCKET: bucket name (required when HELIO_UPLOADS_BACKEND=gcs)
- Production Cloud Run env: HELIO_UPLOADS_BACKEND=gcs, HELIO_UPLOADS_BUCKET=helio-uploads-prod

## Existing groundwork
- HEL-41 introduced the FileSystem trait (LocalFileSystem implementation)
- HEL-269 made LocalFileSystem path resolution deterministic via HELIO_UPLOADS_ROOT
- HEL-246 (image upload) will depend on the same abstraction
