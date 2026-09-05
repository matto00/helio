# url-backed-source-run-refresh Specification

## Purpose
Guarantees that a pipeline run reads live upstream content for any source that was created from a URL, rather than
the byte snapshot captured when the source was created, so a scheduled pipeline never silently processes stale data.

## Requirements

### Requirement: A URL-backed source re-fetches on every pipeline run
The pipeline engine's source-load dispatch SHALL, for every source kind that stores an optional `sourceUrl`
(`csv`, `text`, `pdf`, `image`), re-fetch that URL when it is present and derive the run's rows from the fetched
bytes, rather than reading the stored file. This SHALL apply to every run path the dispatch serves — scheduled
runs, manual runs, and step preview — not only scheduled runs.

#### Scenario: A URL-backed text source sees changed upstream content
- **WHEN** a `text` source with a `sourceUrl` is run, the upstream content changes, and the pipeline is run again
- **THEN** the second run's rows carry the new content, and differ from the first run's rows

#### Scenario: A URL-backed PDF source sees changed upstream content
- **WHEN** a `pdf` source with a `sourceUrl` is run twice with differing upstream bytes between the runs
- **THEN** the second run's rows are derived from the second set of bytes

#### Scenario: A URL-backed image source sees changed upstream content
- **WHEN** an `image` source with a `sourceUrl` is run twice with differing upstream bytes between the runs
- **THEN** the second run's row is derived from the second set of bytes, including its derived dimensions and MIME type

#### Scenario: A manual run re-fetches too
- **WHEN** a URL-backed `text`, `pdf` or `image` source is run manually rather than on a schedule
- **THEN** the run re-fetches, on the same code path as a scheduled run

### Requirement: An upload-created source still reads its stored file
A source whose `sourceUrl` is absent SHALL continue to read its stored file on a pipeline run, with unchanged
behaviour including its missing-`path` and missing-file error messages. No network request SHALL be made for such
a source.

#### Scenario: An uploaded text source is unaffected
- **WHEN** a `text` source created by file upload (no `sourceUrl`) is run
- **THEN** its stored file is read and no fetch is attempted

#### Scenario: An uploaded source with an empty path still fails the same way
- **WHEN** a `text`, `pdf` or `image` source has no `sourceUrl` and an empty `path`
- **THEN** the run fails with the pre-existing missing-`path` message for that kind

### Requirement: Run-path re-fetch is one shared path across kinds
The re-fetch SHALL be reached through a single shared entry point that every URL-backed kind uses, rather than a
per-kind copy of the fetch logic. Per-kind policy that already differs — the size limit applied to each kind, the
https-only restriction and non-CSV body gate that apply to `csv` only — SHALL be expressed as parameters of that
shared path, and SHALL match what the manual-refresh path applies for the same kind.

#### Scenario: Text, PDF and image URL fetches keep their existing scheme policy
- **WHEN** a `text`, `pdf` or `image` source's `sourceUrl` uses `http`
- **THEN** the run-path fetch applies the same scheme policy the manual-refresh path applies for that kind, and does
  not impose the CSV-only https-only restriction

#### Scenario: Each kind's size limit is enforced on the run path
- **WHEN** a URL-backed source's upstream content exceeds that kind's configured maximum size
- **THEN** the run fails with a size error rather than loading the oversized content

### Requirement: A re-fetched image source's stored bytes are replaced atomically
An `image` row references its bytes indirectly, by `storageKey`, rather than carrying them inline. So when an
`image` source re-fetches on a run, the fetched bytes SHALL be written to the source's stored path before the row
is built, or the rendered image would stay stale while its derived `width`/`height`/`mimeType`/`sizeBytes` reported
fresh values. That write SHALL be atomic from a concurrent reader's point of view: the bytes are staged in a temp
file in the SAME directory as the target and then moved into place with an atomic move, and the temp file is
removed if the write fails. A reader SHALL never observe a partially-written file.

#### Scenario: The stored image bytes reflect the newest fetch
- **WHEN** a URL-backed `image` source is run after its upstream bytes changed
- **THEN** the bytes readable at the row's `storageKey` are the newly fetched bytes, not the previous ones

#### Scenario: A concurrent reader never sees a partial file
- **WHEN** the stored file is being replaced during a run
- **THEN** any read of that path returns either the complete old content or the complete new content

#### Scenario: A failed write leaves no temp file behind
- **WHEN** writing the replacement bytes fails
- **THEN** no temp file is left in the uploads tree

### Requirement: A failed run-path fetch fails the run loudly
When a run-path re-fetch fails, the run SHALL fail with an error naming the source and the underlying reason. It
SHALL NOT silently fall back to the stored snapshot, because that fallback is indistinguishable to the operator
from a successful fresh run and reintroduces the silent staleness this capability exists to remove.

#### Scenario: Upstream is unreachable
- **WHEN** a URL-backed source's upstream host cannot be reached during a run
- **THEN** the run fails with an error identifying the source, and does not serve the stored bytes
