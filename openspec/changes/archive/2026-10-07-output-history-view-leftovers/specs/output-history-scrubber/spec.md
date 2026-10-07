## MODIFIED Requirements

### Requirement: History view is opened per Output from the Outputs tab
Each Output card in a pipeline's Outputs tab SHALL offer a "History" action with an accessible name naming the Output, distinct from opening the Output's editor. Activating it SHALL open a History view for that one Output, which fetches `GET /api/outputs/:id/history` and lists that Output's retained points newest first. The pipeline's run-history modal SHALL be unchanged except that its trigger labels come from the same shared trigger-source label helper, so an `auto-run` run reads "Auto-run". Closing the History view by any path (Escape, the Close button, or a backdrop click) SHALL return keyboard focus to the "History" action that opened it, never to the page body.

#### Scenario: Opening history
- **WHEN** the user activates "History" on an Output card
- **THEN** a History view for that Output opens and requests `/api/outputs/<id>/history`, and the Output editor does not open

#### Scenario: No history yet
- **WHEN** the history response has zero points
- **THEN** the view renders an EmptyState stating no runs have been recorded for this Output yet

#### Scenario: Fetch failure
- **WHEN** the history request fails
- **THEN** the view renders a visible intent-error message and no point list

#### Scenario: Escape returns focus to the History action
- **WHEN** the user opens the History view from an Output card's "History" action and presses Escape
- **THEN** the view closes and that "History" action has keyboard focus

### Requirement: Scrubbing selects a point and shows its summary
The History view SHALL provide a keyboard-operable scrubber over the returned points (newest selected by default; arrow keys move older/newer; each point's accessible name contains its localized capture time). A point's accessible name SHALL never read identically to the accessible name of either adjacent point: when a point shares its minute with an adjacent point its capture time SHALL include seconds; when it shares its second, milliseconds; and when its capture instant is identical to the millisecond with an adjacent point, its name SHALL carry a suffix that tells them apart. The selected point SHALL show its capture time, its trigger source as a human label (`manual`→Manual, `scheduled`→Scheduled, `external`→External, `auto-run`→Auto-run, any other value shown as its sentence-cased raw text, never empty or "undefined"), its row count, and, from its stored summary: the headline metric value when present, and the per-numeric-column count/sum/min/max when present. Summary display SHALL NOT require a payload.

#### Scenario: Default selection
- **WHEN** the view opens with 3 points
- **THEN** the newest point is selected and its row count and capture time are shown

#### Scenario: Keyboard scrubbing
- **WHEN** the scrubber has focus and the user presses ArrowLeft (older)
- **THEN** the next-older point becomes selected and its summary replaces the previous one

#### Scenario: Same-minute points have distinct names
- **WHEN** two adjacent points were captured at 2026-10-05T14:02:05Z and 2026-10-05T14:02:55Z and the user scrubs from one to the other
- **THEN** the scrubber's accessible value differs between the two and includes seconds

#### Scenario: Same-second points have distinct names
- **WHEN** two adjacent points were captured at 2026-10-05T14:02:05.742Z and 2026-10-05T14:02:05.318Z
- **THEN** the scrubber's accessible value for each includes milliseconds and the two differ
