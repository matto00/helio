## ADDED Requirements

### Requirement: The run engine re-fetches URL-backed CSV sources
When the pipeline engine reads a `csv` data source that carries a `sourceUrl`, it SHALL fetch that URL through the
same guarded fetch used at ingestion (https-only, address denylist, connection pinned to the validated address)
instead of reading the stored snapshot. A `csv` source with no `sourceUrl` SHALL read the stored snapshot exactly as
before. The fetch capability SHALL be supplied to the engine as an injectable seam so a run can be exercised in tests
without real network access, mirroring the existing REST connector override seam.

#### Scenario: A run over a URL-backed CSV reflects current upstream content
- **WHEN** a pipeline whose primary source is a URL-backed CSV is executed
- **THEN** the rows the engine produces come from a fresh fetch of `sourceUrl`, not from the stored snapshot

#### Scenario: A run over a snapshot-backed CSV is unchanged
- **WHEN** a pipeline whose primary source is an inline/upload-created CSV is executed
- **THEN** the engine reads the stored file and performs no fetch

#### Scenario: A failing fetch fails the run with a descriptive reason
- **WHEN** the engine's fetch of a URL-backed CSV fails the guard or the upstream returns non-2xx
- **THEN** the run fails and the failure names the data source and the reason, rather than silently producing zero rows
