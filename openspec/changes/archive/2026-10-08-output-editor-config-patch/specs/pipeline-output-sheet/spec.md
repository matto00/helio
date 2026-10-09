## ADDED Requirements

### Requirement: Edit-mode Save preserves untouched stored config and sends explicit clears

When saving an existing Output, the Output editor sheet SHALL send in `config` only the top-level keys whose value the user changed in the sheet relative to the state it opened with, and SHALL omit `config` entirely when nothing changed. Every stored config key the user did not change SHALL be omitted from the request, so that the server's shallow config merge preserves it byte-for-byte. A field the user cleared SHALL be sent as an explicit `null` rather than omitted. A chart or metric `fieldMapping`, whenever sent, SHALL NOT contain an `annotation`, `label` or `unit` slot that the editor's current state does not bind to a field, and a save of an Output whose stored `fieldMapping` contains such a stale slot SHALL send the repaired `fieldMapping`. Creating a new Output SHALL continue to send the full config for its kind, including defaults.

#### Scenario: Collection layout is not overwritten
- **WHEN** a collection Output stored with `layout: "list"` is opened in the editor and saved after changing only its format
- **THEN** the PATCH request's `config` does not contain `layout`, and the stored `layout` remains `"list"`

#### Scenario: Timeline sort is not overwritten
- **WHEN** a timeline Output stored with `sort: "desc"` is opened and saved after changing only its field mapping
- **THEN** the PATCH request's `config` does not contain `sort`, and the stored `sort` remains `"desc"`

#### Scenario: Untouched save sends no config
- **WHEN** any existing, non-damaged Output (no stale `fieldMapping` slot, see below) is opened and saved without changing any config control (for a table, whether Save is clicked before or after the node's columns have loaded)
- **THEN** the PATCH request carries no `config`, and every stored config key is unchanged afterwards

#### Scenario: Metric label and unit literal cleared by switching to a field binding
- **WHEN** a metric Output stored with literal `label` and `unit` has both switched to field mode, bound to fields, and is saved
- **THEN** the PATCH request sends `label: null` and `unit: null` with the bindings in `fieldMapping`, and the stored literals no longer render

#### Scenario: Table column order reset to natural
- **WHEN** a table Output stored with a `columnOrder` has every column made visible in natural order and is saved
- **THEN** the PATCH request sends `columnOrder: null`, and the table renders the same as an Output with no stored `columnOrder`

#### Scenario: Hidden columns stay hidden
- **WHEN** a table Output stored with `columnOrder: ["b","a"]` over fields `a,b,c` has `a` moved above `b` and is saved
- **THEN** the PATCH request sends `columnOrder: ["a","b"]` (not `null`), and column `c` stays hidden

#### Scenario: Removed chart annotation field does not survive
- **WHEN** a chart Output stored with `fieldMapping.annotation` has its annotation binding removed or switched to a literal and is saved
- **THEN** the PATCH request's `fieldMapping` contains no `annotation` key, and every other stored `fieldMapping` key is unchanged

#### Scenario: Already-damaged fieldMapping is repaired on save
- **WHEN** a chart Output stored with a literal `annotation` and a stale `fieldMapping.annotation` (or a metric with a literal `label` and a stale `fieldMapping.label`) is opened and saved without other changes
- **THEN** the PATCH request sends `fieldMapping` without the stale slot and no other config key, except that for a metric the paired `aggregation` is sent with it so the metric stays bound

#### Scenario: Aggregated metric stays bound
- **WHEN** a metric Output stored as `{fieldMapping:{value:"amt"}, aggregation:{agg:"sum"}}` is opened and saved untouched, or saved after binding only its label to a field
- **THEN** an untouched save sends no `config`; the label-only edit sends `fieldMapping` (still containing `value: "amt"`) together with `aggregation`, and the stored metric remains bound to `amt` with `sum`

#### Scenario: Create still writes defaults
- **WHEN** a new collection or timeline Output is created from the sheet
- **THEN** the create request's `config` includes `layout: "grid"` (collection) or `sort: "asc"` (timeline) as today
