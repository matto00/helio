## MODIFIED Requirements

### Requirement: History view is opened per Output from the Outputs tab
Each Output card in a pipeline's Outputs tab SHALL offer a "History" action with an accessible name naming the Output, distinct from opening the Output's editor. Activating it SHALL open a History view for that one Output, which fetches `GET /api/outputs/:id/history` and lists that Output's retained points newest first. The pipeline's run-history modal SHALL be unchanged except that its trigger labels come from the same shared trigger-source label helper, so an `auto-run` run reads "Auto-run". Closing the History view by any path (Escape, the Close button, or a backdrop click) SHALL return keyboard focus to the "History" action that opened it, never to the page body.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop each OUTPUTS card in the spine has a quiet menu whose "History" item (accessible name "History for <name>") opens the same History view, distinct from opening the Output's editor.

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

#### Scenario: Desktop history from the card menu
- **WHEN** the user opens an Output card's menu on desktop and chooses "History for <name>"
- **THEN** the History view for that Output opens, not its editor
