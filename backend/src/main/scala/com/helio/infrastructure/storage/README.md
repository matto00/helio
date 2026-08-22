# Storage

Blob/file storage abstraction: the `FileSystem` trait plus its two
implementations, `LocalFileSystem` (dev, `HELIO_UPLOADS_ROOT`) and
`GcsFileSystem` (prod, `HELIO_UPLOADS_BACKEND=gcs`).

Not a domain — this is structural infrastructure shared by every upload
path (image uploads, PDF/CSV ingestion). Does NOT hold: the repositories
that persist metadata ABOUT stored blobs (`ImageUploadRepository` is in
`persistence/sources/`; `BinaryRefRepository` is in `persistence/pipelines/`),
or upload-handling service/route logic (`services/sources/`,
`api/routes/sources/`).
