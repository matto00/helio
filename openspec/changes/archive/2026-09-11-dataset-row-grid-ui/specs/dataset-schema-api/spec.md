## Purpose

Exposes a dataset source's declared field schema (name/type/required/default) over the API so
downstream UIs can render typed columns and editors without inferring shape from row data.

## ADDED Requirements

### Requirement: Declared schema route for dataset sources
The system SHALL expose `GET /api/data-sources/:id/schema` for a `dataset`-kind data source,
returning its declared fields (`name`, `type`, `required`, `default`) as stored in
`dataset_schema`.

#### Scenario: Dataset source with a declared schema
- **WHEN** an authenticated owner requests the schema of a dataset source they own
- **THEN** the response is `200` with the declared field list, each field carrying its
  `name`, `type`, `required` flag, and optional `default` value

#### Scenario: Source is not a dataset kind
- **WHEN** the requested source exists but is not `dataset`-kind (e.g. `csv`, `rest`)
- **THEN** the response is `400` naming the source's actual kind, not a 500 or a silently
  empty schema

#### Scenario: Source not found or not owned
- **WHEN** the source id does not exist, or exists but is not owned by the caller
- **THEN** the response is `404`, matching the existing HEL-1002 not-found convention
  (indistinguishable from a genuinely nonexistent id)

#### Scenario: Existing source GET response is unaffected
- **WHEN** a client calls the existing `GET /api/data-sources/:id`
- **THEN** the response shape is unchanged — no new required field, no altered existing field
