## ADDED Requirements

### Requirement: Migration V117 repairs V94/HEL-877 dead Output config keys

Migration V117 SHALL remove from every `outputs.config` `metricLabel`, `metricUnit`, `chartAnnotation`, `columnWidths`,
`tableDensity`, `collectionOptions`, `timelineOptions`, `legend`, `tooltip`, `seriesColors` and `axisLabels`. It SHALL
also remove `format`, `columnOrder` and `chartOptions` from any Output whose kind does not accept that key. A dead key with a
live equivalent SHALL be renamed to that live key only when the kind accepts it, the dead value (or its nested `layout`/
`sort`) is non-null and has the shape the live key's reader accepts (a string for `label`/`unit`/`annotation`;
`"grid"`/`"list"`; `"asc"`/`"desc"`), and the live key is absent or JSON null. Otherwise the dead key SHALL be dropped. A
non-null live key SHALL never be overwritten. Every key the migration changes SHALL be recorded, with its prior value,
in `hel1387_dropped_output_config_keys`.

#### Scenario: Dead metric label is renamed
- **WHEN** a metric Output's config holds `"metricLabel": "Revenue"` and no `label`
- **THEN** after V117 its config holds `"label": "Revenue"` and no `metricLabel`

#### Scenario: Null live key is filled
- **WHEN** a chart Output's config holds `"annotation": null` and `"chartAnnotation": "Q3 dip"`
- **THEN** after V117 its config holds `"annotation": "Q3 dip"` and no `chartAnnotation`

#### Scenario: Non-null live key is never overwritten
- **WHEN** a collection Output holds `"layout": "grid"` and `"collectionOptions": {"layout": "list"}`
- **THEN** after V117 `layout` is still `"grid"`, `collectionOptions` is gone, and the audit table records it

#### Scenario: Wrongly-shaped dead value is dropped, not renamed
- **WHEN** a collection Output holds `"collectionOptions": {"layout": "tile"}` and no `layout`
- **THEN** after V117 it has no `layout` and no `collectionOptions`, and the audit table records `invalid-value`

#### Scenario: Re-running changes nothing
- **WHEN** the V117 statements run a second time on already-migrated data
- **THEN** no Output config and no audit row changes
