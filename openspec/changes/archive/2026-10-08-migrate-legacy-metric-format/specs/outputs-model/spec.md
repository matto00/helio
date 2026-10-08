## ADDED Requirements

### Requirement: Migration V118 maps legacy object-valued metric formats to string formats

Migration V118 SHALL rewrite every metric or collection Output whose `config.format` is a JSON object (the V75
`{unit, decimals, prefix, suffix}` shape copied by V94) so that `format` becomes one of the string formats the readers
accept: `integer` when `decimals` is 0; `currency` when the trimmed `prefix` is exactly `$` and `decimals` is absent or
2; otherwise `number`. On metric Outputs only, the remaining non-empty text among prefix (unless consumed by
`currency`), unit and suffix, in that order and joined by single spaces, SHALL be written to `unit` when `unit` is
absent or JSON null; a non-null `unit` SHALL never be overwritten. Collection Outputs SHALL keep only the mapped
`format`. Every rewritten Output SHALL be recorded in `hel1410_migrated_output_formats` with its original `format`, its
prior `unit`, the values written, and the list of approximations made. String-valued formats and other kinds SHALL be
left unchanged, and every rewritten config SHALL pass the Output config validation for its kind.

#### Scenario: Real legacy object is mapped with its text moved to unit
- **WHEN** a metric Output's config holds `"format": {"unit": "pts", "prefix": "~", "suffix": "/10", "decimals": 2}`
  and no `unit`
- **THEN** after V118 it holds `"format": "number"` and `"unit": "~ pts /10"`, and the audit row lists the
  approximations made

#### Scenario: Dollar prefix becomes currency
- **WHEN** a metric Output holds `"format": {"prefix": "$", "decimals": 2}`
- **THEN** after V118 it holds `"format": "currency"` and no `unit` is written

#### Scenario: Zero decimals becomes integer
- **WHEN** a metric Output holds `"format": {"decimals": 0, "suffix": "%"}` and `"unit": null`
- **THEN** after V118 it holds `"format": "integer"` and `"unit": "%"`

#### Scenario: Non-null live unit is never overwritten
- **WHEN** a metric Output holds `"unit": "kg"` and `"format": {"unit": "lb"}`
- **THEN** after V118 `unit` is still `"kg"`, `format` is `"number"`, and the audit row records the text was shadowed

#### Scenario: Collection keeps only the mapped format
- **WHEN** a collection Output holds `"format": {"unit": "pts", "decimals": 0}`
- **THEN** after V118 it holds `"format": "integer"`, no `unit`, and the audit row records the dropped text

#### Scenario: Re-running changes nothing
- **WHEN** the V118 statements run a second time on already-migrated data
- **THEN** no Output config and no audit row changes
