## MODIFIED Requirements

### Requirement: Delete DataSource shows bound-panel warning for related DataTypes

The Sources sidebar list SHALL warn about dependent pipelines while a source delete is pending
confirmation. Post-migration, companion DataTypes are never panel-bound (panels bind only to
pipeline-output DataTypes), so the warning is keyed on dependent pipelines instead of bound panels:
the sidebar (SidebarBody via SidebarItemList) SHALL ensure pipelines are fetched when the sources
section is active, and when one or more pipelines read from the source being deleted, an alert
reading "N pipeline(s) read(s) from this source and will stop working." SHALL be shown above the
Confirm/Cancel pair.

A pipeline SHALL be counted as reading from the source when **any** element of its `roots` array
has a `dataSourceId` equal to the source's id. The match SHALL NOT be keyed on the removed scalar
`sourceDataSourceId`, and SHALL NOT be keyed on the first root alone: a multi-root pipeline that
reads the source from a non-first root still stops working when the source is deleted, so keying
on the first root would under-count dependents and under-warn the user.

The user may proceed or cancel. The delete call remains `DELETE /api/data-sources/:id` and removes
the source from the list.

#### Scenario: Delete DataSource with a dependent pipeline warns user

- **WHEN** the user selects Delete for a source and at least one pipeline has a root whose
  `dataSourceId` matches the source's id
- **THEN** an alert naming the dependent pipeline count is displayed alongside the Confirm/Cancel pair

#### Scenario: Dependent match is not restricted to the first root

- **WHEN** the user selects Delete for a source that a multi-root pipeline reads from via a root
  other than its first
- **THEN** that pipeline is included in the dependent count and the warning is displayed

#### Scenario: Delete DataSource with no dependent pipelines shows no warning

- **WHEN** the user selects Delete for a source that no pipeline reads from
- **THEN** no dependency warning is shown, only the plain Confirm/Cancel pair

#### Scenario: Proceeding deletes the source

- **WHEN** the user confirms deletion (with or without a dependency warning shown)
- **THEN** `DELETE /api/data-sources/:id` is called and the source is removed from the list
