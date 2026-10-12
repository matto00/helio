## ADDED Requirements

### Requirement: File-backed data source creation leaves no row or stored file behind on failure
Creating a csv, text, pdf or image data source, by upload or by URL, SHALL leave no data source row and no stored file
created by that request when any step after the file write fails (the row insert or the inferred-schema write), and
SHALL surface the original failure unchanged. The cleanup SHALL remove only the stored object this request wrote and the
row this request inserted; it SHALL NOT remove any other object or row. A cleanup failure SHALL be logged and SHALL NOT
replace the original failure. A successful create SHALL be unchanged.

#### Scenario: Schema write fails after a CSV upload insert
- **WHEN** `POST /api/data-sources` uploads a CSV and the inferred-schema write fails after the row insert
- **THEN** the response is the same error status as before this change
- **THEN** the count of `data_sources` rows owned by the caller is unchanged from before the request
- **THEN** no stored file exists at the path the request wrote

#### Scenario: Row insert fails after the file was written
- **WHEN** a csv, text, pdf or image create (upload or URL) writes its file and the row insert then fails
- **THEN** no stored file exists at the path the request wrote, and the caller's `data_sources` count is unchanged

#### Scenario: Schema write fails for each other file-backed kind
- **WHEN** a csv URL, text, pdf or image create (upload or URL) fails at the inferred-schema write
- **THEN** the caller's `data_sources` count is unchanged and no stored file exists at the path the request wrote

#### Scenario: Cleanup never touches another object
- **WHEN** a create fails after its file write while other stored files and rows of the same user exist
- **THEN** those other files and rows still exist afterwards

#### Scenario: Cleanup works on the GCS storage backend
- **WHEN** storage is the GCS backend and a create fails after its file write
- **THEN** a delete is issued for exactly the object path the request created, in the configured bucket

#### Scenario: A failing cleanup does not mask the original error
- **WHEN** a create fails after its file write and the cleanup's own delete also fails
- **THEN** the original failure is surfaced unchanged
