# palette-assistant-handoff Specification

## Purpose
Let the command palette hand a typed question to the Assistant, and give the palette a visible "Search, jump, or ask" entry point in the dashboard tab bar.

## Requirements

### Requirement: Free text offers "Ask the assistant"

While the palette's query has non-whitespace text, the palette SHALL offer an action titled `Ask the assistant: "<text>"` as the last result group, regardless of other matches. Choosing it SHALL close the palette, open the Assistant in a new conversation, and send the text as that conversation's first message exactly once. A user whose tier cannot use the Assistant SHALL land on the Assistant's existing request-access state and nothing is sent. The palette's "open in a new tab" mode SHALL NOT offer the action.

#### Scenario: Ask hands off

- **WHEN** the user types "why did revenue dip" in the palette and chooses the ask action
- **THEN** the Assistant page shows a new conversation whose first user message is "why did revenue dip", and exactly one converse request was sent

#### Scenario: Offered alongside matches

- **WHEN** the user types a dashboard's name
- **THEN** the dashboard result and the ask action are both offered, with the ask action last

### Requirement: The "Search, jump, or ask" box

The dashboard tab bar SHALL contain a button showing "Search, jump, or ask" and the platform's palette shortcut (`⌘K` on macOS, `Ctrl+K` elsewhere) that opens the palette; its accessible name SHALL include "Search, jump, or ask" and it SHALL expose the shortcut via `aria-keyshortcuts`. `Cmd/Ctrl+K` SHALL continue to open the palette from any authenticated route.

#### Scenario: Box opens the palette

- **WHEN** the user clicks the box
- **THEN** the palette opens with focus in its search field
