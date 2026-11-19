# ask-ui Specification

## Purpose
Ask a question of a dashboard or an Output from the web app, read a cited answer, and pin it as an insight Output.

## Requirements

### Requirement: Ask surfaces
The web app SHALL offer an ask surface for the open dashboard, reached from the dashboard meta row and the command bar,
and one for an Output with a saved server row, inside the Output sheet. Each SHALL hold a labelled question field (1..2000 characters
after trimming, with submission disabled outside that range) and a submit control. It SHALL post `{question}` to
`POST /api/dashboards/:id/ask` or `POST /api/outputs/:id/ask` respectively, and nothing else. The ask surface SHALL NOT
offer a model choice, and SHALL NOT appear on a public or share-token view, in Output-sheet create mode, or for a pipeline-draft Output whose id
is a client id.

#### Scenario: Ask from the dashboard
- **WHEN** a signed-in beta user opens Ask on a dashboard they can read, types a question and submits
- **THEN** exactly one `POST /api/dashboards/:id/ask` with body `{question}` is sent, and a pending state is announced
  until it settles

#### Scenario: Ask from the Output sheet
- **WHEN** the user opens the sheet of a saved Output and asks from its ask section
- **THEN** exactly one `POST /api/outputs/:id/ask` is sent

#### Scenario: No ask for an unsaved or draft Output
- **WHEN** the Output sheet is open in create mode, or for an Output that exists only in a pipeline draft
- **THEN** no ask section is rendered

### Requirement: Answer card with citation chips
A `200` answer SHALL render in an answer card through HEL-1744's `InsightMarkdown` (sanitized markdown). Each `[cN]`
marker for a citation in the response SHALL render as HEL-1744's `CitationChip`, which opens the cited Output's
provenance. A marker for an id the response does not cite SHALL render as plain text. Cited Outputs SHALL be listed by
name. The card SHALL never show a model, token count or cost.

#### Scenario: Cited answer
- **WHEN** the response carries an answer with markers `[c1]` and `[c2]` and both citations
- **THEN** the card shows two chips with ordinals 1 and 2, and activating one opens the provenance popover of its
  cited Output, anchored at the chip, with Escape returning focus to the chip

### Requirement: Pin as insight
The answer card SHALL show a "Pin as insight" action if and only if the response's `pin` is non-null. Activating it
SHALL POST `pin.request` unchanged to `/api/pipelines/:pin.pipelineId/outputs`, never adding answer text. On success
from the dashboard surface, when the signed-in user owns the dashboard, the new Output SHALL be placed on that
dashboard as a panel. A successful pin SHALL be announced, the action SHALL not be repeatable for the same answer, and
after a successful create the client SHALL start one render of the new Output with trigger `pin`
(`POST /api/outputs/:id/insight/refresh` with `{"trigger":"pin"}`); a failed render request SHALL NOT fail or revert the
pin, and the new insight Output SHALL show the not-yet-rendered state until its first attempt is recorded, then the
insight panel state for that attempt (for example the failed state when no model is configured). On the Output sheet, while a
pipeline draft exists, the pin action SHALL be disabled with a visible reason.

#### Scenario: Viewer sees no pin
- **WHEN** the response's `pin` is `null`, as for a dashboard viewer without a pipeline edit grant
- **THEN** no pin action is rendered

#### Scenario: Pin disabled during a draft
- **WHEN** the Output sheet's pipeline has an open draft and the answer carries a pin
- **THEN** the pin action is disabled and states that the draft must be saved or discarded first

#### Scenario: Editor pins
- **WHEN** a dashboard owner who can edit the cited pipeline pins an answer
- **THEN** one insight Output is created from the server-built body, a panel bound to it is placed on the dashboard, and
  the panel shows the not-yet-rendered state until the pin render's first attempt is recorded

#### Scenario: Pin starts one render
- **WHEN** a pin's create succeeds
- **THEN** exactly one refresh request with `{"trigger":"pin"}` is sent for the new Output, and a failing refresh
  request still leaves the pin announced as successful

### Requirement: Quota, limit and error states
A free-tier user SHALL see an upsell linking to beta access instead of the question field, and a `403 TIER_FORBIDDEN`
response SHALL show the same upsell. `429 CHAT_LIMIT_REACHED` SHALL show the daily-limit message. `422
ASK_ANSWER_TRUNCATED` SHALL ask for a narrower question. Any other `422` SHALL show that no grounded answer could be
produced, without echoing server reason text. Any other failure, including any `5xx`
and a network error, SHALL show a generic error with a retry that re-sends the same question. Each state SHALL be
announced to assistive technology, and the question SHALL be kept.

#### Scenario: Free tier
- **WHEN** a free-tier user opens Ask
- **THEN** the upsell is shown and no ask request is sent

#### Scenario: Ungrounded
- **WHEN** the ask returns `422`
- **THEN** the card shows the not-grounded message and the question stays in the field

### Requirement: Keyboard and focus
Every ask control SHALL be reachable and operable by keyboard. Opening the dashboard ask drawer SHALL move focus to
the question field, and closing it SHALL return focus to the control that opened it, or to the overflow-menu trigger
when the opener was a menu item. When an answer or error arrives,
focus SHALL stay where it was, and the result SHALL be announced through a live region. Every control SHALL meet the
44 px touch-target floor on phone.

#### Scenario: Drawer focus return
- **WHEN** a keyboard user opens Ask from the dashboard meta row and then closes it with Escape
- **THEN** focus returns to the Ask control

### Requirement: Ask on a shared dashboard

The dashboard ask surface SHALL be offered on a dashboard the caller holds a named `viewer` or `editor` grant on, from
the same entries as on an owned dashboard (the dashboard meta row's Ask control or its kebab item, and the command
bar's kebab item). On a dashboard the caller does not own, the ask flow (opening the surface, asking, reading the answer
and opening a citation's provenance) SHALL NOT send any request to `/api/outputs/*` or `/api/pipelines/*`, except the
pin action's own requests when the server returned a non-null `pin` (the caller can edit the cited pipeline). A citation
chip there SHALL open provenance through `GET /api/dashboards/:id/panels/:panelId/provenance` for a panel on that
dashboard bound to the cited Output; when no loaded panel of that dashboard binds the cited Output, the chip SHALL render
as its plain ordinal with no provenance action. Cited Outputs SHALL be listed by name only, never as a link. The pin
action SHALL follow the response's `pin` unchanged (none when `pin` is `null`). A free-tier grantee SHALL see the
existing upsell in place of the question field, and no ask request SHALL be sent.

#### Scenario: Viewer grantee asks a shared dashboard

- **WHEN** a beta-tier user holding only a viewer grant on a dashboard (no pipeline grant) opens Ask on it and submits
  a question
- **THEN** exactly one `POST /api/dashboards/:id/ask` is sent, the answer card renders, no pin action is rendered, and
  no request to `/api/outputs/*` or `/api/pipelines/*` is sent

#### Scenario: Grantee opens a citation's provenance

- **WHEN** that viewer activates a citation chip in the answer
- **THEN** the provenance popover loads from `/api/dashboards/:id/panels/:panelId/provenance` of a panel bound to the
  cited Output, and `/api/outputs/:id/provenance` is not requested

#### Scenario: Editor grantee without a pipeline grant

- **WHEN** a beta-tier user holding an editor grant on the dashboard and no grant on the cited pipeline asks
- **THEN** the answer card renders with no pin action

#### Scenario: Free-tier grantee

- **WHEN** a free-tier user holding a viewer grant opens Ask on the shared dashboard
- **THEN** the upsell is shown in place of the question field and no ask request is sent

#### Scenario: Owner unchanged

- **WHEN** the dashboard's owner asks and opens a citation chip
- **THEN** the chip's provenance loads from `/api/outputs/:id/provenance` as before, and the pin action is shown when
  `pin` is non-null
