## ADDED Requirements

### Requirement: A full submit is completable keyboard-only across the assembled panel

An assembled form panel containing a mix of field types (including `file` and `counter` controls)
SHALL support a complete submit — filling every field and activating the submit control — using only
the keyboard, verified against a running instance of the app (never jsdom). Tab order across the
assembled panel SHALL follow authored field order, including the file field and any counter field,
with no field skipped or trapping focus.

#### Scenario: Full keyboard-only submit succeeds
- **WHEN** a user tabs through every field of an assembled form panel (including a file field and a
  counter field), enters valid values via the keyboard, and activates the submit control with Enter
  or Space
- **THEN** the submission completes successfully, verified against the running app

### Requirement: Focus is managed on submit, on success, and after a server-side rejection

Activating submit SHALL move focus predictably: while a submission is in flight, focus SHALL remain
on or return to the submit control (never lost to the document body); on success, focus SHALL move to
a location that communicates success to a keyboard/AT user; on a **server-side** rejection (not only a
client-blocked one), focus SHALL move to the first invalid/rejected field or to the error summary,
verified against the running app rather than inferred from a client-only code path.

#### Scenario: Focus moves to the first invalid field after a server-side rejection
- **WHEN** a keyboard-only submit is rejected by the server (not blocked client-side)
- **THEN** focus moves to the first field associated with the rejection, or to the error summary,
  measured against the running app

### Requirement: The panel has a computed role and accessible name inside the dashboard grid

The form panel, as placed in the dashboard grid, SHALL expose a computed role and accessible name
identifying it as a form panel to assistive technology. This SHALL be asserted via the computed
accessibility tree of a running instance — never via attribute presence alone.

#### Scenario: Panel role and name are computed, not merely present
- **WHEN** a form panel is placed in a dashboard grid
- **THEN** querying the running app's computed accessibility tree returns a role and accessible name
  for the panel, not just a DOM attribute check limited to presence

### Requirement: An asynchronously-arriving submit error is measured for live-region announcement

Whether an asynchronously-arriving submit error is actually announced to assistive technology SHALL be
measured by asserting computed live-region text change in a running browser, never inferred from a
regression test's mutation count alone. When measurement is inconclusive (e.g. no real AT available in
the harness), the ticket's evidence SHALL state this explicitly rather than asserting the announcement
succeeded.

#### Scenario: Live-region text change is measured, not inferred
- **WHEN** a submit error arrives asynchronously
- **THEN** the evidence records the computed live-region text before and after, and states explicitly
  whether real-AT announcement was verified or is unmeasurable in the harness
