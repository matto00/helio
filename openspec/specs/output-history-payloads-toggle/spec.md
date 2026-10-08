# output-history-payloads-toggle Specification

## Purpose
Lets a pipeline's Output be opted into keeping each run's full rows from the Output editor, with caps, tier rules and
retention stated at the point of choice.

## Requirements

### Requirement: Output editor offers a keep-rows toggle
The Output editor SHALL show, for an existing Output, a History section containing a switch labelled
"Keep each run's rows", reflecting `config.historyPayloads === true`. When the Output carries `historyPayloadLimits`,
its help text SHALL read: "Stores the full rows of every run from the next run on, so History can show what changed. A
run over {maxRows} rows or {maxBytes} keeps only its summary. Beta keeps the last {beta runs} for {beta age}; Owner
keeps {owner runs} for {owner age}." with every figure taken from `historyPayloadLimits` (rows grouped with thousands
separators, bytes shown in the largest whole binary unit, runs and days with correct singular/plural; a tier whose
runs or age is zero reads "keeps no rows"), followed by the sentence "Turning this off stops storing rows; rows already
kept expire on the normal schedule." When `historyPayloadLimits` is absent, the help text SHALL omit the figures rather
than state values the server did not report. The editor SHALL NOT hold the figures as constants. When the user
changes the switch, Saving SHALL persist that state as `config.historyPayloads` (true or false). When the user has not
changed it, Saving SHALL leave the stored `historyPayloads` value (absent, null, true or false) untouched.

#### Scenario: Enabling and saving
- **WHEN** the owner of an Output on a beta-owned pipeline turns the switch on and saves
- **THEN** the PATCH body's `config.historyPayloads` is `true`, and reopening the editor shows the switch on

#### Scenario: Saving other edits preserves the setting
- **WHEN** an Output with `historyPayloads: true` is edited in some other field and saved
- **THEN** `config.historyPayloads` remains `true`

#### Scenario: Unchanged switch on a never-set Output
- **WHEN** an Output whose config has no `historyPayloads` key is saved with the switch untouched
- **THEN** its stored config still has no `historyPayloads` key

#### Scenario: Default figures
- **WHEN** the Output's `historyPayloadLimits` holds the defaults (1000 rows, 1048576 bytes, beta 10 runs / 7 days, owner 30 runs / 30 days)
- **THEN** the help text reads "A run over 1,000 rows or 1 MiB keeps only its summary. Beta keeps the last 10 runs for 7 days; Owner keeps 30 runs for 30 days."

#### Scenario: Overridden figures
- **WHEN** the Output's `historyPayloadLimits` reports 500 rows, 2097152 bytes, beta 1 run / 1 day
- **THEN** the help text says "500 rows or 2 MiB" and "Beta keeps the last 1 run for 1 day", and no default figure appears

### Requirement: Unavailable tier shows a disabled toggle with an upsell
When the Output's `historyPayloadsAvailable` is false, the switch SHALL be rendered disabled (not hidden), with the
note "Free stores run summaries only" and a "Request Beta access" link to the Beta access section of Settings. The link
SHALL open in a new browser tab, leaving the Output editor and any unsaved edits in the original tab untouched, and its
accessible name SHALL state that it opens in a new tab. The note SHALL use the same type size and colour token as the
help text above it. Saving SHALL NOT change the stored `historyPayloads` value.

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

### Requirement: Toggle is legible in both themes
The History section SHALL use the shared design-system switch and tokens, and SHALL be legible with visible focus in
both light and dark themes.

#### Scenario: Theme check
- **WHEN** the editor is viewed in light and in dark theme, enabled and disabled
- **THEN** the label, help text, note, link and switch state are all legible, and the disabled state is distinguishable
