## MODIFIED Requirements

_Companion DataTypes are retired (HEL-903 decision 4/11); a source's schema now lives directly on `data_sources.inferred_schema`, written by `upsertInferredSchema` in place of the old `upsertSourceDataType`/second-upsert path. Scenario titles are preserved verbatim from the live spec even where they still say "DataType" (they describe the same test case) — only the body text below each is updated to the new mechanism._

### Requirement: A URL-backed CSV source re-fetches on refresh
`POST /api/data-sources/:id/refresh` SHALL re-fetch the stored `sourceUrl` when one is present, overwrite the stored
snapshot with the fetched bytes, and re-infer the linked inferred schema's schema. A CSV source with no `sourceUrl` SHALL
continue to re-read the stored file exactly as before.

#### Scenario: Refresh reflects upstream changes without re-upload
- **WHEN** the upstream CSV content changes and refresh is called on a URL-backed CSV source
- **THEN** the stored snapshot and the linked inferred schema schema reflect the NEW upstream content

#### Scenario: Inline-created CSV refresh is unchanged
- **WHEN** refresh is called on a CSV source created from inline content
- **THEN** the stored file is re-read and no outbound HTTP request is made
