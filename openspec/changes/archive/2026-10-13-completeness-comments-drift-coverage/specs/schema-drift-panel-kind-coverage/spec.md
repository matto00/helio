## MODIFIED Requirements

### Requirement: Every schema panel-kind enum is checked or explicitly exempted

The check SHALL scan every `.json` file under `schemas/` and treat as a panel-kind enum both (a) any `enum` array
holding at least two canonical panel kinds and (b) any panel-kind const group: the string `const` values found at the
same relative JSON path inside the branches of one `oneOf`, `anyOf` or `allOf` array, when together they hold at least
two canonical panel kinds. Each such enum or const group MUST be a parity-checked surface or be listed in
`PANEL_KIND_ENUM_EXEMPTIONS` (`scripts/lib/panelKindEnumCoverage.mjs`) with a non-empty reason; otherwise the check
SHALL exit non-zero naming the file and JSON path. An exemption with an empty reason, an exemption that matches no
detected enum or const group, or an exemption for one that is also checked SHALL each fail the check.

#### Scenario: A new schema carries an unchecked panel-kind enum

- **WHEN** a `.json` file under `schemas/` has an enum containing two or more canonical panel kinds and it is neither
  a checked surface nor exempted
- **THEN** `node scripts/check-schema-drift.mjs` exits non-zero and names that file and JSON path

#### Scenario: A new schema carries an unchecked panel-kind const group

- **WHEN** a `.json` file under `schemas/` has a `oneOf`, `anyOf` or `allOf` whose branches carry two or more canonical
  panel kinds as `const` values at the same relative path, and that group is neither a checked surface nor exempted
- **THEN** `node scripts/check-schema-drift.mjs` exits non-zero and names that file and the group's JSON path

#### Scenario: Exemption table hygiene

- **WHEN** an exemption has a blank reason, matches no detected enum or const group, or duplicates a checked surface
- **THEN** the coverage validation returns an error describing that exemption

## ADDED Requirements

### Requirement: Existing panel-kind const groups are parity-checked

`npm run check:schemas` SHALL compare the set of `const` values at `oneOf.*.properties.type.const` in
`schemas/panels/panel.schema.json`, and at `allOf.*.if.properties.type.const` in
`schemas/panels/create-panel-request.schema.json`, against the canonical panel-type set, and SHALL exit non-zero naming
the schema when a set differs.

#### Scenario: A panel kind's oneOf branch is removed

- **WHEN** the `oneOf` branch whose `properties.type.const` is `"form"` is removed from `panel.schema.json`
- **THEN** `node scripts/check-schema-drift.mjs` exits non-zero and its output names `panel.schema.json` and
  `missing: form`

### Requirement: Coverage keys do not depend on the path separator

Coverage matching SHALL treat a schema file path written with `\` separators as equal to the same path written with
`/`, so a detected enum or const group on Windows matches its checked surface or exemption.

#### Scenario: Windows-style detected path

- **WHEN** the coverage validation receives a detected entry for `panels\panel.schema.json` and a checked surface for
  `panels/panel.schema.json` at the same JSON path
- **THEN** it returns no error for that entry
