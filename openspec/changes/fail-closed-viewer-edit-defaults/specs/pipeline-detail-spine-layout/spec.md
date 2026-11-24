## ADDED Requirements

### Requirement: A pipeline-page component not told the caller's role offers no edit control

Every pipeline detail page UI component that takes the caller's edit, run or ownership permission as an optional input
SHALL treat an omitted input as "may not edit", "may not run" and "not the owner": it SHALL render no control that
edits, adds, removes, reorders, duplicates, disables, schedules or runs anything, SHALL offer no owner-only option,
SHALL show any configuration it renders as disabled, and SHALL show the viewer variant of any role-dependent copy. Every
production caller SHALL pass the permission explicitly, so an owner and an editor keep every control and a viewer
keeps none.

#### Scenario: A component rendered without its role input shows no edit or run control

- **WHEN** a pipeline-page component that accepts `canEdit`, `canRun`, `isOwner` or `readOnly` is rendered without that
  input
- **THEN** it renders no edit, add, remove, reorder, duplicate, disable, schedule or run control and no owner-only option
- **AND** any configuration field it renders is disabled
- **AND** any role-dependent copy it renders is the viewer variant

#### Scenario: Owners and editors keep their controls

- **WHEN** an owner or an editor grantee opens the pipeline detail page
- **THEN** every edit and run control they had before this change is still offered

### Requirement: The viewer read-only scan covers elements a disabled fieldset does not disable

The viewer read-only end-to-end scan SHALL report every visible element a viewer can activate, including links and
`<summary>` elements, whether or not they sit inside a disabled `<fieldset>`. It SHALL skip an element only when the
browser itself reports it disabled. A navigational link a viewer may use SHALL be accepted only by its exact accessible
name in the scan's allow-list.

#### Scenario: An enabled link or summary inside a viewer's disabled fieldset is reported

- **WHEN** an enabled link and a `<summary>` element sit inside a disabled fieldset on the viewer's pipeline page
- **THEN** the scan reports both

#### Scenario: A disabled form control inside a disabled fieldset is not reported

- **WHEN** an input sits inside a disabled fieldset (and outside its first legend)
- **THEN** the scan does not report it
