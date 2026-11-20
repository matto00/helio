## ADDED Requirements

### Requirement: A viewer grantee gets no run entries on the desktop pipeline page

When the caller's role on a pipeline is `viewer`, the desktop pipeline detail page SHALL render no control that starts a run: no Run pipeline, Dry run or Save & run in the header, no Run pipeline in an Output sheet, and no Run now action on a save notice. "Run to update" stays gated by `costVerdict.canRun`. A viewer who has a client-only draft SHALL still be able to Discard it. The header SHALL show a "View only" indicator following the dashboard "View only" recipe (eye icon, muted mono extra-small text, no pill), visible and exposed to assistive technology. Owners and editors SHALL see their controls unchanged and no indicator. An owner SHALL never see run controls appear late, and a viewer SHALL never see them appear and then disappear, except after an initial analyze failure, where the controls are shown and the server stays the authority. If the caller's role cannot be determined because analyze failed, an editor SHALL still be offered the run controls (the server remains the authority).

#### Scenario: Viewer on desktop, light and dark
- **WHEN** a viewer grantee opens a shared pipeline on a desktop viewport in either theme
- **THEN** no Run pipeline or Dry run button is present and the header shows "View only"

#### Scenario: Viewer opens an Output sheet
- **WHEN** a viewer grantee opens an Output that has not been in a saved run
- **THEN** the sheet offers no Run pipeline button

#### Scenario: Editor on desktop
- **WHEN** an editor grantee opens the same pipeline
- **THEN** Run pipeline and Dry run are present and enabled and there is no "View only" indicator

#### Scenario: Grantee on a pipeline with roots they do not own
- **WHEN** an editor or viewer grantee opens a valid shared pipeline whose CSV root and compute step reference a source they do not own
- **THEN** the page shows neither "source type we don't yet recognize" nor "A step in this pipeline has a problem"
