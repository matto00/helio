## REMOVED Requirements

### Requirement: Minimal response root-selector (jsonPath)

**Reason**: Its selection-failure behaviour — zero rows plus a server-side log only — is the silent empty
success this change exists to remove. The requirement itself names HEL-599 as the owner of the curated error
envelope that replaces it, so this is the anticipated hand-off rather than a reversal. Superseded by
"Response root-selector with curated selection errors" below, which retains the selection semantics verbatim.

**Migration**: None for existing sources. A `rootSelector` that matches the response behaves exactly as
before, and an unset `rootSelector` remains byte-identical to pre-selector behaviour. Only the
already-broken case changes: a selector that does not match now reports a curated `fetchError` instead of
appearing to succeed with zero rows.

## ADDED Requirements

### Requirement: Response root-selector with curated selection errors
A `rest_api` source MAY declare `rootSelector`: a dot-separated path of object-key segments
(e.g. `data.items`) locating the array or object within the response body that `toRows` should
operate on. When `rootSelector` is unset, `toRows` behavior is byte-identical to the pre-existing
behavior (top-level `JsArray` → one row per element; top-level `JsObject` → one row; anything
else → one row). When set, the same array/object/other classification is applied to the value
found at the end of the path walk instead of the response root.

A path segment that does not exist, or that requires descending into a non-object value, SHALL
produce a curated fetch error naming the selector and the failing segment, surfaced through the
`fetch-error-envelope` capability's `fetchError` field. It SHALL NOT produce a 500, and it SHALL
NOT produce a silent empty success — a caller that supplied a selector which did not match the
response is told so rather than receiving zero rows indistinguishable from a genuinely empty
result. The curated message SHALL NOT include the response body or any credential material. The
failure SHALL also be logged server-side naming the source and the failing segment.

Rows located by the selector SHALL be materialised through the shared traversal defined by the
`nested-json-flattening` capability, so a selected row containing nested objects carries dotted
columns matching its inferred schema.

#### Scenario: Row array nested under a single key
- **WHEN** a source's `rootSelector` is `data` and the response body is `{"data": [{"a": 1}]}`
- **THEN** `toRows` produces one row, `{"a": 1}`

#### Scenario: Row array nested two levels deep
- **WHEN** a source's `rootSelector` is `results.items` and the response body is
  `{"results": {"items": [{"a": 1}, {"a": 2}]}}`
- **THEN** `toRows` produces two rows

#### Scenario: Unset selector reproduces today's behavior exactly
- **WHEN** a source has no `rootSelector` and the response body is a top-level JSON array
- **THEN** `toRows` produces the same rows it would have before this requirement existed

#### Scenario: Selector pointing at a missing key yields a curated error rather than zero rows
- **WHEN** a source's `rootSelector` is `missing.path` and the response body has no top-level
  `missing` key
- **THEN** the source's `fetchError` carries a curated message naming the selector and the failing
  segment, no rows are reported as a successful empty result, and no 500 is returned

#### Scenario: Selector descending through a non-object is a curated error
- **WHEN** a source's `rootSelector` is `data.items` and the response body is `{"data": 5}`
- **THEN** the source's `fetchError` carries a curated message naming the failing segment

#### Scenario: Curated selector error leaks no response content
- **WHEN** a selector failure produces a `fetchError`
- **THEN** the message contains neither the response body nor any credential or header value

#### Scenario: Selected rows carry dotted columns for nested objects
- **WHEN** a source's `rootSelector` is `data` and the response body is
  `{"data": [{"id": 1, "stats": {"pts": 33.7}}]}`
- **THEN** the materialised row has columns `id` and `stats.pts`, and no column `stats`
