## Purpose

Keep every panel-kind enum in the JSON schemas under `schemas/` observed by `npm run check:schemas`, so a schema
carrying a panel-kind enum cannot fall behind the canonical panel-type set by sitting outside the guard's list.

## ADDED Requirements

### Requirement: Batch-create panel-kind enum is parity-checked

`npm run check:schemas` SHALL compare `schemas/panels/create-panels-batch-request.schema.json`'s
`properties.panels.items.properties.type.enum` against the canonical panel-type set parsed from
`PanelType.fromString`, and SHALL exit non-zero naming that schema when the sets differ.

#### Scenario: A kind is dropped from the batch-create enum

- **WHEN** `"form"` is removed from that enum and `node scripts/check-schema-drift.mjs` runs
- **THEN** it exits non-zero and its output names `create-panels-batch-request.schema.json` and `missing: form`

#### Scenario: A kind is added to PanelType.fromString only

- **WHEN** a new `case "<kind>" => Right(...)` arm is added to `PanelType.fromString` and no schema is updated
- **THEN** the check exits non-zero and names `create-panels-batch-request.schema.json` among the surfaces missing it

### Requirement: Every schema panel-kind enum is checked or explicitly exempted

The check SHALL scan every `.json` file under `schemas/` and treat any `enum` array holding at least two canonical
panel kinds as a panel-kind enum. Each such enum MUST be a parity-checked surface or be listed in
`PANEL_KIND_ENUM_EXEMPTIONS` (`scripts/lib/panelKindEnumCoverage.mjs`) with a non-empty reason; otherwise the check
SHALL exit non-zero naming the file and JSON path. An exemption with an empty reason, an exemption that matches no
detected enum, or an exemption for an enum that is also checked SHALL each fail the check.

#### Scenario: A new schema carries an unchecked panel-kind enum

- **WHEN** a `.json` file under `schemas/` has an enum containing two or more canonical panel kinds and it is neither
  a checked surface nor exempted
- **THEN** `node scripts/check-schema-drift.mjs` exits non-zero and names that file and JSON path

#### Scenario: Exemption table hygiene

- **WHEN** an exemption has a blank reason, matches no detected enum, or duplicates a checked surface
- **THEN** the coverage validation returns an error describing that exemption
