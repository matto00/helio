## ADDED Requirements

### Requirement: A viewer grantee gets no run pills on the phone pipeline page

When the caller's role on a pipeline is `viewer`, the phone pipeline detail page SHALL render no Dry run, Run pipeline or Save & run pill. A viewer with a client-only draft SHALL keep the Discard pill and the draft status. With no draft, the floating action bar SHALL leave no empty reserved space in the tab body. The phone header SHALL show the "View only" indicator. Owners and editors SHALL see the pills unchanged.

#### Scenario: Viewer on phone, light and dark
- **WHEN** a viewer grantee opens a shared pipeline on a phone viewport in either theme
- **THEN** no Dry run or Run pipeline pill is present and the header shows "View only"

#### Scenario: Editor on phone
- **WHEN** an editor grantee opens the same pipeline on a phone viewport
- **THEN** the Dry run and Run pipeline pills are present and enabled
