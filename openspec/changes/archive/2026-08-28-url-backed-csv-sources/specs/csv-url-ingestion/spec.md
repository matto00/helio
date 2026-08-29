## ADDED Requirements

### Requirement: A CSV source can be created from an HTTPS URL
The create surface SHALL accept a JSON `csv` create request carrying `config.url`, as an alternative to the existing
multipart file upload. When it is supplied the server SHALL fetch the URL, infer the schema from the fetched bytes,
store the bytes at the fixed `csv/<id>.csv` path, and persist `sourceUrl` in the source's config so it can be re-read
later. The existing multipart upload path SHALL be unchanged.

Mutual exclusion between a URL and inline `content` is NOT enforced here: a single HTTP request is either multipart or
JSON and can never carry both, and no `content` field exists on the backend CSV surface. It is enforced at the MCP
tool layer, where both arguments genuinely coexist (see `mcp-data-source-tools`).

#### Scenario: URL-created CSV source stores both path and sourceUrl
- **WHEN** a `csv` source is created with `sourceUrl` set to a reachable HTTPS URL serving CSV text
- **THEN** the response is 201 and the stored config carries BOTH `path` and `sourceUrl` set to the supplied URL
- **AND** the inferred schema matches the fetched CSV's header row

#### Scenario: The multipart upload path is unaffected
- **WHEN** a `csv` source is created by multipart file upload
- **THEN** it behaves exactly as before, storing a config with no `sourceUrl`

#### Scenario: An unreachable or non-2xx URL is reported, not silently stored
- **WHEN** a `csv` source is created with an HTTPS URL whose upstream returns a non-2xx status
- **THEN** the response is a 502-class error carrying the upstream status
- **AND** no data source row and no stored file are left behind

### Requirement: CSV URL ingestion is https-only
CSV URL ingestion SHALL reject any scheme other than `https`, including `http`, and SHALL do so BEFORE any network
request is issued. This restriction is enforced at the CSV call site; the shared `ContentSourceSupport` guard, which
also serves text/PDF/image and permits both `http` and `https`, SHALL NOT be modified. The rejection message SHALL
name the offending scheme and state that `https` is required, so a caller can reach a correct conclusion without
guessing.

#### Scenario: An http:// URL is rejected before any request is issued
- **WHEN** a `csv` source is created with an `http://` URL
- **THEN** the response is 400, the message names `http` and states that https is required
- **AND** no outbound HTTP request is made

#### Scenario: A non-http(s) scheme is rejected
- **WHEN** a `csv` source is created with a `file://`, `ftp://`, or `gopher://` URL
- **THEN** the response is 400 and the message names the offending scheme and states that https is required

#### Scenario: The shared guard still accepts http for other connectors
- **WHEN** a `text` source is created with an `http://` URL
- **THEN** it is accepted exactly as before this change

### Requirement: CSV URL ingestion rejects internal and link-local addresses
CSV URL ingestion SHALL reuse `ContentSourceSupport`'s address denylist rather than reimplementing one, rejecting a
URL whose host resolves to a loopback, link-local (including the `169.254.0.0/16` cloud-metadata range), RFC1918
private, IPv6 site-local, IPv6 unique-local, any-local, or multicast address. The connection SHALL be pinned to the
already-validated address so a rebinding DNS answer cannot redirect the fetch.

#### Scenario: Each blocked address class is rejected
- **WHEN** a `csv` source is created with an HTTPS URL whose host resolves to a loopback address
- **THEN** the response is an error stating the host resolves to a disallowed address
- **AND** the same holds independently for link-local `169.254.169.254`, an RFC1918 address, an IPv6 unique-local
  address, an any-local address, and a multicast address, each asserted as its own case rather than one representative

#### Scenario: A redirect to an internal address is not followed
- **WHEN** an HTTPS URL responds with a 3xx redirect pointing at an internal address
- **THEN** the fetch fails rather than following the redirect, and no internal content is returned

### Requirement: A URL-backed CSV source re-fetches on refresh
`POST /api/data-sources/:id/refresh` SHALL re-fetch the stored `sourceUrl` when one is present, overwrite the stored
snapshot with the fetched bytes, and re-infer the linked DataType's schema. A CSV source with no `sourceUrl` SHALL
continue to re-read the stored file exactly as before.

#### Scenario: Refresh reflects upstream changes without re-upload
- **WHEN** the upstream CSV content changes and refresh is called on a URL-backed CSV source
- **THEN** the stored snapshot and the linked DataType schema reflect the NEW upstream content

#### Scenario: Inline-created CSV refresh is unchanged
- **WHEN** refresh is called on a CSV source created from inline content
- **THEN** the stored file is re-read and no outbound HTTP request is made

### Requirement: A URL-backed CSV source re-fetches during a scheduled pipeline run
The pipeline engine's CSV source read SHALL re-fetch `sourceUrl` when present rather than reading the stored
snapshot, so a scheduled run reflects upstream changes. This is the load-bearing path: a fix confined to the manual
refresh entry point does NOT satisfy this requirement, because a scheduled run never calls it.

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

### Requirement: URL-backed CSV ingestion enforces the CSV size limit
The configured CSV maximum size SHALL be enforced on every URL-backed path — create, manual refresh, and the
run-time fetch during a pipeline run — not only at the multipart route layer. Without this a URL-backed CSV would be
bounded only by the shared guard's 100 MiB transport cap while a byte-identical uploaded CSV is capped at the CSV
limit, including on unattended scheduled runs.

#### Scenario: An over-limit body is rejected on every URL path
- **WHEN** a fetched CSV body exceeds the configured CSV maximum size
- **THEN** on create and on manual refresh it is rejected with a 413-class error naming the limit
- **AND** during a pipeline run the run fails with an error naming the data source and the limit (the run path has
  no HTTP response, so no status code is asserted there)

#### Scenario: A body within the limit is accepted
- **WHEN** a fetched CSV body is under the configured maximum
- **THEN** ingestion proceeds normally

### Requirement: An obviously-non-CSV body is rejected
A fetched body whose first byte, after skipping a leading UTF-8 byte-order mark and any leading ASCII whitespace, is
`<` SHALL be rejected with an error stating the URL returned
HTML/XML rather than CSV, and naming the URL. Schema inference has no failure path of its own, so without this gate
an HTML interstitial, login page, or rate-limit notice returned with HTTP 200 — the most likely failure mode for a
public-dataset URL — is silently accepted as a CSV source with a garbage one-column schema, and then refreshed into
that garbage on every scheduled run.

#### Scenario: An HTML page served with HTTP 200 is rejected
- **WHEN** a URL returns an HTML document with status 200
- **THEN** ingestion fails with an error naming the URL and stating HTML/XML was returned rather than CSV
- **AND** this holds on create, on manual refresh, and during a pipeline run

#### Scenario: A BOM-prefixed HTML body is also rejected
- **WHEN** a URL returns an HTML document prefixed with a UTF-8 byte-order mark
- **THEN** it is rejected identically — the byte-order mark does not count as whitespace and must not be allowed to
  smuggle the body past the check

#### Scenario: A normal CSV body is unaffected
- **WHEN** a URL returns ordinary CSV text
- **THEN** ingestion proceeds normally
