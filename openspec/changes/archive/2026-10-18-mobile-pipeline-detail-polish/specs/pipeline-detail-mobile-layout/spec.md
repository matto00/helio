## ADDED Requirements

### Requirement: A step deep link opens the step sheet on a phone
On the phone layout, loading the pipeline page with a `step` URL search parameter that names an existing step (by id,
or by the render key of a created step) SHALL open that step's editor sheet once the steps have loaded. While the
sheet is open the `step` parameter SHALL name the open step; closing the sheet SHALL remove the parameter. The
parameter SHALL be written with history replacement, never adding history entries, and SHALL never clobber other
search parameters (such as `outputId`). A `step` value that names no step SHALL open no sheet and SHALL be removed.
The deep link is consumed once, at the page's first steps load: switching from the desktop layout to the phone layout
on the same page (a resize or rotation) SHALL NOT open a sheet. The desktop layout keeps selecting the named step and
opens no sheet; switching from phone to desktop with a sheet open selects that step.

#### Scenario: Phone deep link opens the sheet
- **WHEN** a pipeline with three steps is opened at 375px with `?step=<id of step 2>`
- **THEN** step 2's editor sheet is open once the page has loaded

#### Scenario: Closing the sheet clears the parameter
- **WHEN** the deep-linked sheet is closed with its close control
- **THEN** the sheet is closed and the URL has no `step` parameter, with other parameters unchanged

#### Scenario: Removing the open step clears the parameter
- **WHEN** the open step is removed from the sheet's menu
- **THEN** the sheet closes and the URL has no `step` parameter

#### Scenario: Desktop to phone switch opens no sheet
- **WHEN** a step is selected on the desktop layout and the viewport is then narrowed to 375px
- **THEN** no sheet opens

#### Scenario: Unknown step
- **WHEN** the phone page is opened with `?step=` naming no step
- **THEN** no sheet opens and the `step` parameter is removed

### Requirement: Escape on a popover inside the step sheet closes only the popover
While a popover opened from inside the open step sheet (the output schema panel) is open, pressing Escape SHALL close
that popover only, return focus to its trigger, and leave the sheet open. A second Escape SHALL then close the sheet
as before.

#### Scenario: Escape on the schema panel
- **WHEN** the output schema panel is open inside the step sheet and the user presses Escape
- **THEN** the panel closes, focus is on the panel's trigger, and the sheet is still open

### Requirement: Pipeline page hover fills apply only on hover-capable pointers
Hover-only fills and colour changes defined by the pipeline detail page's own styles (phone and desktop spine, the
step sheet's pipeline content, preview table, schema disclosure) SHALL apply only when the primary input can hover,
so that a touch tap never leaves a hover fill behind. Focus, expanded, selected and pressed states SHALL be
unaffected. Hover REVEALS of a row's drag grip or actions menu, together with the backing and row tones the compact
spine shows with a revealed menu, are not fills and SHALL keep working on touch devices exactly as before, so the step
menu stays reachable and the tapped row keeps its tone on a touch tablet in the compact spine.

#### Scenario: No sticky fill after a tap
- **WHEN** a step row is tapped on a touch device whose primary pointer cannot hover and the sheet is then closed
- **THEN** the step row has its rest background, not its hover background

#### Scenario: Compact spine menu on a touch tablet
- **WHEN** a compact spine row is tapped at 1024×800 on a touch device whose primary pointer cannot hover
- **THEN** that row's step actions menu is visible and can be opened, and the row's and menu backing's backgrounds are
  the same as before this change, in light and dark

#### Scenario: Desktop hover unchanged
- **WHEN** a mouse hovers a step row on a hover-capable device
- **THEN** the step row shows its hover fill as before

### Requirement: Spine copy is unambiguous and the last-run time is never clipped away
The source card SHALL name a source's kind exactly once: when the sample label's text already starts with the kind
label, the card SHALL omit its kind meta line; in every other label state (loading, unavailable, truncated) the meta
line stays. The phone header's last-run line SHALL keep the relative time fully visible
when the row count is long (an 8-digit count at 375px), hiding the whole row-count part instead (it is shown complete or not at all, never as a fragment); the full figures stay
in the line's title.

#### Scenario: Static named once
- **WHEN** a pipeline whose source is a static dataset is shown on the spine (phone or desktop)
- **THEN** the source card shows "Static" exactly once

#### Scenario: Static named once while loading or truncated
- **WHEN** a static source's sample is loading, or its sample is truncated
- **THEN** the source card still shows "Static" exactly once, on its meta line

#### Scenario: Long row count at 375px
- **WHEN** the last run wrote 12,345,678 rows and the phone page is shown at 375px
- **THEN** the relative time of the last run is fully visible in the header

#### Scenario: Long row count on desktop
- **WHEN** the same pipeline is shown at 1000px and 1280px
- **THEN** the relative time of the last run is fully visible in the header

#### Scenario: Last-run meta hidden rather than clipped on a narrow desktop page
- **WHEN** the desktop page container is 685px wide or less (about a 905-990px window with the context list open)
- **THEN** the header's last-run line is hidden rather than shown as a clipped fragment, and above that width it keeps room for the longest relative time

#### Scenario: A hidden row count gives its width back
- **WHEN** the last-run row count does not fit beside the relative time on a desktop page (for example 1280px wide with the context list open)
- **THEN** the line takes no more room than the time needs, so the pipeline name is not truncated beside blank space, and the count appears whenever there is room (for example at 1440px)

#### Scenario: Static source card label clears the name button on the phone
- **WHEN** the phone source card omits its kind meta line
- **THEN** the sample label sits far enough below the source name button that their 44px tap expanders do not overlap

### Requirement: An editor's phone sample refresh is covered end to end
An editor grantee on a shared pipeline SHALL be able to refresh a source's sample from the phone source card: one
click SHALL send exactly one pipeline-scoped sample request that succeeds, and the sample label SHALL still render
afterwards.

#### Scenario: Editor refreshes on a phone
- **WHEN** an editor grantee opens a shared pipeline at 375px and activates "Refresh sample of <source>"
- **THEN** exactly one sample request carrying the pipeline scope is sent and answered 200, and the label still shows
