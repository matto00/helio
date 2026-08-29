## ADDED Requirements

### Requirement: create_csv_data_source accepts and documents a sourceUrl
The MCP `create_csv_data_source` tool SHALL accept an optional `sourceUrl` argument alongside the existing inline
`content`, forward it to the backend, and describe both inputs accurately in its tool description and input schema —
including that `sourceUrl` must be `https`, that it is mutually exclusive with `content`, and that only a URL-backed
source can refresh on a schedule. The description SHALL NOT advertise an input the tool does not accept; in
particular it SHALL NOT describe a caller-supplied filesystem `path`, which is not accepted.

The tool SHALL make `content` optional and require EXACTLY ONE of `content` / `sourceUrl`. Supplying neither or both
SHALL fail in the tool before any HTTP call, with a message naming both arguments and stating they are mutually
exclusive. `content` SHALL continue to post `multipart/form-data` unchanged; `sourceUrl` SHALL post JSON to the
same endpoint.

#### Scenario: The tool forwards sourceUrl as a JSON create
- **WHEN** `create_csv_data_source` is called with `sourceUrl`
- **THEN** it sends a JSON create request carrying that URL, not a multipart upload

#### Scenario: Inline content still posts multipart
- **WHEN** `create_csv_data_source` is called with `content`
- **THEN** it posts `multipart/form-data` exactly as before

#### Scenario: Neither or both arguments fails before any HTTP call
- **WHEN** `create_csv_data_source` is called with neither `content` nor `sourceUrl`, or with both
- **THEN** it fails with a message naming both arguments and stating they are mutually exclusive
- **AND** no HTTP request is issued

#### Scenario: The description matches the real surface
- **WHEN** the tool's description and input schema are read
- **THEN** they name `content` and `sourceUrl` as the accepted, mutually exclusive inputs, state the https-only rule,
  and describe no caller-supplied filesystem path
