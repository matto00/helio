## MODIFIED Requirements

### Requirement: A URL-backed CSV source re-fetches during a scheduled pipeline run
The pipeline engine's CSV source read SHALL re-fetch `sourceUrl` when present rather than reading the stored
snapshot, so a scheduled run reflects upstream changes. This is the load-bearing path: a fix confined to the manual
refresh entry point does NOT satisfy this requirement, because a scheduled run never calls it. The re-fetch SHALL be
reached through the shared cross-kind run-path fetch described by `url-backed-source-run-refresh`, so that CSV and
the other URL-backed kinds cannot diverge; CSV's own https-only restriction, its size limit and its non-CSV body
gate SHALL continue to apply unchanged on that shared path.

#### Scenario: A scheduled fire picks up changed upstream content
- **WHEN** a pipeline over a URL-backed CSV source is executed through the scheduled-run path after the upstream
  content changed
- **THEN** the run's output rows reflect the NEW upstream content
- **AND** this is verified by driving an actual run through the engine path, not by asserting that the manual
  refresh method was called

#### Scenario: A snapshot-backed CSV run still reads the stored file
- **WHEN** a pipeline over an inline-created CSV source is run
- **THEN** the stored file is read and no outbound HTTP request is made

#### Scenario: The engine applies the same https-only and address restrictions
- **WHEN** a run reads a URL-backed CSV whose URL would now be rejected by the guard
- **THEN** the run fails with that guard's error rather than fetching it

#### Scenario: CSV keeps its own policy on the shared cross-kind path
- **WHEN** the CSV run-path re-fetch is performed through the shared entry point used by `text`, `pdf` and `image`
- **THEN** the https-only pre-check, the CSV size limit and the non-CSV body gate are all still applied to CSV
- **AND** none of them is imposed on the other kinds, whose existing scheme policy is unchanged
