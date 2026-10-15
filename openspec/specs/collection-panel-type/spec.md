# collection-panel-type Specification

## Purpose
Defines the `collection` Output kind, rendered inside an `output` panel (there is no `collection` panel kind): the keys its `config` accepts (`fieldMapping`, `layout`, `format`, `conditionalFormats`) and how unknown keys are handled.

## Requirements

### Requirement: A collection Output's config is fieldMapping, layout, format and conditionalFormats
`collection` is an Output kind: an `output` panel bound to a collection-kind Output renders it, and no `collection`
panel kind exists. A collection Output's `config` SHALL accept exactly the keys every Output kind accepts
(`fieldMapping`, `compare`, `historyPayloads`) plus `layout`, `format` and `conditionalFormats`. Its `fieldMapping`
slots are `value` (required), `label` and `unit` (optional), the same slots as a metric Output. A write that introduces
any other top-level config key SHALL be rejected with 400, naming the key. A stored `layout` other than `"list"` is
read as `"grid"`.

#### Scenario: A collection Output accepts its own keys
- **WHEN** a collection-kind Output is written with `config: { fieldMapping: { value: "total" }, layout: "list", format: "currency" }`
- **THEN** the write is accepted

#### Scenario: A pre-remodel panel config key is rejected
- **WHEN** a write introduces `baseType` or `itemOptions` on a collection Output's `config`
- **THEN** the write is rejected with 400 naming the unknown key

#### Scenario: An unrecognised stored layout renders as grid
- **WHEN** a collection Output's stored `config.layout` is any value other than `"list"`
- **THEN** the collection renders in the grid layout
