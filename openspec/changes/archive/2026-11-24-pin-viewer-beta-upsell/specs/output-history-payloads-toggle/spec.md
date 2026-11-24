## MODIFIED Requirements

### Requirement: Unavailable tier shows a disabled toggle with an upsell
When the Output's `historyPayloadsAvailable` is false, the switch SHALL be rendered disabled (not hidden), with the
note "Free stores run summaries only" and a "Request Beta access" link to the Beta access section of Settings. The link
SHALL open in a new browser tab, leaving the Output editor and any unsaved edits in the original tab untouched, and its
accessible name SHALL state that it opens in a new tab. The note SHALL use the same type size and colour token as the
help text above it. Saving SHALL NOT change the stored `historyPayloads` value. The note and the link SHALL be shown to
every user who can open the Output sheet, whatever their role on the pipeline: the pipeline owner, an editor grantee
and a viewer grantee (whose sheet is read-only) all see them. The link SHALL stay a live link in a read-only sheet.

#### Scenario: Free-tier pipeline owner
- **WHEN** an Output on a free-owned pipeline is opened in the editor
- **THEN** the switch is visible and disabled, the note and the link are shown, and following the link opens Settings
  in a new tab with the "Beta access" heading scrolled into view

#### Scenario: Unsaved edits survive the upsell link
- **WHEN** the user edits the Output's name without saving and then clicks "Request Beta access"
- **THEN** the original tab still shows the editor open with the edited name

#### Scenario: Note matches help text size
- **WHEN** the disabled state is rendered
- **THEN** the note's computed font size equals the help text's

#### Scenario: Viewer's own tier is irrelevant
- **WHEN** a beta-tier user edits their own Output on a free-owned shared pipeline
- **THEN** the switch is disabled with the free-tier note, because availability follows the pipeline owner

#### Scenario: Viewer grantee sees the upsell
- **WHEN** a viewer grantee opens a saved non-insight Output on a free-owned shared pipeline
- **THEN** the read-only sheet's History card shows the note and the "Request Beta access (opens in a new tab)" link,
  and the link is enabled and points to the Beta access section of Settings, in light and dark themes

#### Scenario: Editor grantee sees the upsell
- **WHEN** an editor grantee opens a saved non-insight Output on a free-owned shared pipeline
- **THEN** the History card shows the note and the same link
