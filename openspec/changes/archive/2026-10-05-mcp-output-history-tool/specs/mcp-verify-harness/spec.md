## ADDED Requirements

### Requirement: Harness proves a 30-value history read in one call

The verify harness SHALL add a metric Output with a `config.compare` to its own fixture pipeline using a payload built
by a pure builder that the drift guard also exercises. It SHALL then complete 30 real (non-dry) runs of that pipeline,
waiting out any 429 `Retry-After` before retrying, within a bounded total time. It SHALL read the Output's history
with one `get_output_history` call at `limit: 30` and fail non-zero unless that one call returns 30 points and 30
numeric sparkline values. Every fixture SHALL be removed by exact id as before, and history rows go with their Output.

#### Scenario: History payloads pass the drift guard

- **WHEN** the drift guard drives the add-metric-Output and `get_output_history` payloads through the real registered
  tools with a stub API
- **THEN** both reach their HelioApi method, so neither payload fails input-schema validation

#### Scenario: Live run shows 30 values

- **WHEN** `npm run verify` runs against a live backend
- **THEN** its output records one `get_output_history` call returning 30 values
- **AND** fewer than 30 is a non-zero exit naming the count observed
