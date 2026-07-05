## MODIFIED Requirements

### Requirement: Delete DataSource shows bound-panel warning for related DataTypes

The Sources sidebar list SHALL warn about dependent pipelines while a source delete is pending
confirmation. Post-migration, companion DataTypes are never panel-bound (panels bind only to
pipeline-output DataTypes), so the warning is keyed on dependent pipelines instead of bound panels:
the sidebar (SidebarBody via SidebarItemList) SHALL ensure pipelines are fetched when the sources
section is active, and when one or more pipelines read from the source being deleted (matched by
`sourceDataSourceId`), an alert reading "N pipeline(s) read(s) from this source and will stop
working." SHALL be shown above the Confirm/Cancel pair. The user may proceed or cancel. The delete
call remains `DELETE /api/data-sources/:id` and removes the source from the list.

#### Scenario: Delete DataSource with a dependent pipeline warns user

- **WHEN** the user selects Delete for a source and at least one pipeline's `sourceDataSourceId`
  matches the source's id
- **THEN** an alert naming the dependent pipeline count is displayed alongside the Confirm/Cancel pair

#### Scenario: Delete DataSource with no dependent pipelines shows no warning

- **WHEN** the user selects Delete for a source that no pipeline reads from
- **THEN** no dependency warning is shown, only the plain Confirm/Cancel pair

#### Scenario: Proceeding deletes the source

- **WHEN** the user confirms deletion (with or without a dependency warning shown)
- **THEN** `DELETE /api/data-sources/:id` is called and the source is removed from the list
