## Purpose

Renders a stored insight on a dashboard panel as sanitized markdown with citation chips that lead to the cited
data's provenance, with a clear state for every render outcome, and never shows cost, model or token counts.

## ADDED Requirements

### Requirement: Insight panel renders the stored render
A panel bound to an `insight` Output SHALL read the insight through the authenticated Output insight read on an
authenticated dashboard, and through the public panel insight read on a public or share-token dashboard. When a render
exists, the panel SHALL show its markdown. The panel SHALL NOT request a model render. The panel footer SHALL show the
render's time as its updated time, and SHALL show no updated time when there is no render. The panel's refresh action
and the completion of a run of the insight's pipeline SHALL re-fetch the insight.

#### Scenario: Two cited sentences
- **WHEN** an insight Output has an `ok` render of two sentences, each ending in a known citation marker
- **THEN** the panel shows both sentences, each with one citation chip, and the footer shows the render time

#### Scenario: Run completion refreshes
- **WHEN** a run of the insight's pipeline completes while the dashboard is open
- **THEN** the panel fetches the insight again

### Requirement: Insight markdown is sanitized
The insight renderer SHALL NOT render raw HTML, images or links of any kind. Link and image syntax SHALL render as
plain text, raw HTML SHALL render as nothing or as escaped text, and the only interactive elements inside the rendered
markdown SHALL be citation chips. A `[cN]` marker SHALL become a chip only when `cN` is a citation of that render, and
SHALL otherwise render as plain text.

#### Scenario: Hostile markdown
- **WHEN** a render's markdown contains a `<script>` tag, an `<img onerror>` tag, a markdown link, an autolink, a
  reference-style link definition and an image
- **THEN** the panel contains no `script`, `img`, `a` or `iframe` element from that markdown and no element with an
  inline event handler

#### Scenario: Unknown marker
- **WHEN** the markdown contains `[c9]` and the render has no citation `c9`
- **THEN** `[c9]` is shown as plain text and no chip is rendered for it

### Requirement: Citation chips open provenance
Each citation chip SHALL be a button with an accessible name naming the cited field and value. Activating it by click,
tap, Enter or Space SHALL open a provenance popover anchored at the chip and move focus into the popover; closing the
popover SHALL return focus to the chip. On an authenticated dashboard the popover SHALL show the cited Output's
provenance. On a public or share-token dashboard it SHALL show the provenance of the panel on that dashboard bound to
the cited Output, and when no such panel exists it SHALL show the insight panel's own provenance.

#### Scenario: Chip opens the cited Output's popover
- **WHEN** a user activates a chip in a real browser
- **THEN** the popover is displayed (computed `visibility` is `visible` and it has a non-zero box) and
  `document.activeElement` is inside it

#### Scenario: Public fallback
- **WHEN** on a public board a chip cites an Output that is not placed on that board
- **THEN** the popover shows the insight panel's own provenance

### Requirement: Insight panel states
The panel SHALL show exactly one of these states, each following the DESIGN.md state patterns:
- not yet rendered: no render and no attempt (`role="status"`);
- rendering: a refresh the user started is pending;
- failed: the newest attempt failed; the previous render stays visible with a note, or a failed message when there is
  no render;
- unchanged: the newest attempt was skipped as unchanged; the render stays visible with a quiet note;
- quota reached: the newest attempt was skipped for quota or budget and the signed-in user owns the insight's
  pipeline; the render stays visible with a note;
- not updated: the newest attempt was skipped for quota or budget and the signed-in user does not own the insight's
  pipeline, or the newest attempt has a status the client does not know; the render stays visible with a neutral note
  naming no reason;
- upsell: the signed-in user owns the insight's pipeline, has the `free` tier and there is no render.

Ownership is the pipeline's owner, never the user who created the Output.

A public or share-token viewer SHALL see only the render or the not-yet-rendered state.

#### Scenario: Failed keeps the previous render
- **WHEN** an insight has an `ok` render and a newer `failed` attempt
- **THEN** the previous render is shown with a note that the last update failed

#### Scenario: Viewer never sees quota
- **WHEN** a user who does not own the insight's pipeline (including the Output's creator, if an editor) views an
  insight whose newest attempt is `skipped_quota`
- **THEN** the panel shows the neutral not-updated note and no quota or plan wording

#### Scenario: Free-tier owner
- **WHEN** a free-tier pipeline owner views an insight on their pipeline that has no render
- **THEN** the upsell state is shown with a link to beta access

### Requirement: Insight panel fetches no rows
A panel bound to an `insight` Output SHALL NOT request the Output's rows once the Output's kind is known to the client, which includes a warm remount and the completion of a run of its pipeline (the kind outlives the invalidated metadata). A cold first load cannot know the kind before the Output's metadata arrives, and waiting for it would delay every other panel's rows, so it SHALL make exactly one rows request per insight panel, whose result is ignored.

#### Scenario: Cold first load
- **WHEN** a dashboard with an insight panel loads with nothing held about its Output
- **THEN** exactly one rows request is made for that Output, and the panel shows the insight (never a rows state)

#### Scenario: Run completion and warm remount
- **WHEN** a run of the insight's pipeline completes while its panel is mounted, or the panel is remounted while its Output is retained
- **THEN** no rows request is made for that Output

### Requirement: Cost, model and tokens are never displayed
No insight surface in this change SHALL display cost, model id or token counts, whatever fields the response carries.

#### Scenario: Populated response
- **WHEN** the authenticated read returns a render with `model`, every token count and `costMicros` populated
- **THEN** none of those values, nor the words "cost" or "tokens", appear in the panel or its popovers

#### Scenario: Public viewer
- **WHEN** a public viewer opens a board with an insight whose stored row has cost, model and tokens
- **THEN** the page and the public insight response contain no cost, model or token value
