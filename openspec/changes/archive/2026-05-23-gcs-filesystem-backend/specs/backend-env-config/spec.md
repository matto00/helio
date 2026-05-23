## ADDED Requirements

### Requirement: HELIO_UPLOADS_BACKEND selects the storage implementation
The server SHALL read `HELIO_UPLOADS_BACKEND` at startup to select the `FileSystem` implementation. Accepted values are `local` and `gcs`. If absent or empty, the default SHALL be `local`. If an unrecognised value is supplied, the server SHALL log an error and terminate.

#### Scenario: HELIO_UPLOADS_BACKEND=local selects LocalFileSystem
- **WHEN** `HELIO_UPLOADS_BACKEND=local` is set
- **THEN** the server constructs and injects `LocalFileSystem`

#### Scenario: HELIO_UPLOADS_BACKEND absent defaults to local
- **WHEN** `HELIO_UPLOADS_BACKEND` is not set
- **THEN** the server constructs and injects `LocalFileSystem`

#### Scenario: HELIO_UPLOADS_BACKEND=gcs selects GcsFileSystem
- **WHEN** `HELIO_UPLOADS_BACKEND=gcs` is set
- **THEN** the server constructs and injects `GcsFileSystem`

#### Scenario: Unknown HELIO_UPLOADS_BACKEND value causes startup failure
- **WHEN** `HELIO_UPLOADS_BACKEND=s3` (or any unrecognised value) is set
- **THEN** the server logs an error identifying the bad value and exits before binding the HTTP port

### Requirement: HELIO_UPLOADS_BUCKET specifies the GCS bucket name
The server SHALL read `HELIO_UPLOADS_BUCKET` when `HELIO_UPLOADS_BACKEND=gcs`. If the variable is absent or empty when GCS backend is selected, the server SHALL log an error and terminate.

#### Scenario: HELIO_UPLOADS_BUCKET used to configure GcsFileSystem
- **WHEN** `HELIO_UPLOADS_BACKEND=gcs` and `HELIO_UPLOADS_BUCKET=helio-uploads-prod` are set
- **THEN** `GcsFileSystem` stores and retrieves objects from the `helio-uploads-prod` bucket

#### Scenario: Missing HELIO_UPLOADS_BUCKET with GCS backend causes startup failure
- **WHEN** `HELIO_UPLOADS_BACKEND=gcs` is set but `HELIO_UPLOADS_BUCKET` is absent
- **THEN** the server logs an error indicating `HELIO_UPLOADS_BUCKET` is required for the GCS backend and exits

#### Scenario: HELIO_UPLOADS_BUCKET ignored when backend is local
- **WHEN** `HELIO_UPLOADS_BACKEND=local` and `HELIO_UPLOADS_BUCKET` is absent
- **THEN** the server starts normally using `LocalFileSystem`
