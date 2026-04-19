## ADDED Requirements

### Requirement: Static source config shape is persisted in config JSONB
The `data_sources.config` JSONB column SHALL store `{ "columns": [{ "name": string, "type": string }], "rows": [[...]] }` for sources with `source_type = "static"`. The `DataSourceRepository.update` method SHALL be used to replace this config on refresh.

#### Scenario: Static config is round-tripped through the repository
- **WHEN** a `DataSource` with `sourceType = Static` and a `config` containing `columns` and `rows` is inserted
- **THEN** `DataSourceRepository.findById` returns the same `config` JSON value unchanged

#### Scenario: Config is replaced on update
- **WHEN** `DataSourceRepository.update` is called with a modified `config` for an existing static source
- **THEN** `findById` returns the source with the updated `config`
