## Why

A CSV data source can only be created from inline `content`, stored once as a `csv/<uuid>.csv` snapshot. There is
nothing to re-read, so a CSV-backed dashboard cannot refresh on a schedule at all — refreshing means an agent
re-uploading the entire CSV text every cycle. This is issue #7 of the Sleeper field report and leaf 6 of HEL-857.
CSV is the only content kind left behind: `text`/`pdf`/`image` already accept a URL and re-fetch it on refresh.

## What Changes

- `csv` sources accept an optional HTTPS `sourceUrl` at creation, alongside (and mutually exclusive with) inline
  `content`. Inline `content` keeps working unchanged; stored snapshots and existing rows are untouched.
- Refresh of a URL-backed CSV re-fetches the URL and overwrites the stored snapshot, mirroring `refreshText`.
- **The scheduled path is fixed, not just the refresh path.** `InProcessPipelineEngine.loadRowsWithStats`'s
  `case c: CsvSource` currently always reads the stored file; a URL-backed CSV re-fetches there so a scheduled
  pipeline run reflects upstream changes. Without this, AC3 fails no matter how correct `refreshCsv` is.
- URL validation reuses `ContentSourceSupport.fetchUrl` (scheme/host/address denylist plus connection pinning to the
  already-validated `InetAddress`, which defeats DNS rebinding). **https-only** is enforced at the CSV call site; the
  shared guard is not tightened, so existing text/pdf/image callers are unaffected.
- The MCP `create_csv_data_source` tool description and input schema state the accepted inputs accurately.

## Capabilities

### New Capabilities

- `csv-url-ingestion`: creating a `csv` source from an HTTPS URL, the https-only rejection rules, and re-fetch on
  both manual refresh and scheduled pipeline runs.

### Modified Capabilities

- `csv-upload-connector`: the create surface gains a mutually-exclusive `sourceUrl` alternative to inline `content`.
- `pipeline-run-execution`: a URL-backed CSV source re-fetches its URL during a run instead of reading the snapshot.
- `mcp-data-source-tools`: `create_csv_data_source` accepts and documents `sourceUrl`.

## Impact

`domain/model/DataSource.scala` (`CsvSourceConfig` gains `sourceUrl`), `DataSourceService` (create + `refreshCsv`),
`InProcessPipelineEngine` + `PipelineRunService` (fetch seam threading), `DataSourceRepository` (config JSON
encode/decode, absent-field safe), `api/protocols` + routes, `helio-mcp` tool schema/description. No Flyway
migration: source config is stored as JSON and `sourceUrl` is optional/absent-tolerant, exactly as text/pdf/image did.

## Non-goals

- **No caller-supplied filesystem path.** Explicit coordinator override of the ticket's original wording: an MCP
  caller cannot see the server's uploads root, so it has no legitimate use from the API surface and would add a
  path-traversal surface for nothing.
- **The REST connector's missing egress guard is out of scope** — filed separately as HEL-879.
- Not changing the shared `ContentSourceSupport` guard's accepted schemes, and not fixing the same scheduled-path
  staleness for text/pdf/image (reported as a finding instead).
- No auth/credentials on the fetched URL, and no row cap for CSV (HEL-861 concerns REST; noted, not conflated).
