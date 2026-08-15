## MODIFIED Requirements

### Requirement: Bottom tab bar provides section navigation on phone
The frontend SHALL render a bottom tab bar (`shared/chrome/BottomNav`) below the 768px breakpoint
with exactly the six section destinations of the desktop sidebar (`/`, `/sources`, `/pipelines`,
`/registry`, `/metrics`, `/chat`), sourced from a single shared destination definition so desktop
and phone navigation cannot drift. Each destination SHALL show a Lucide icon and a label in the UI
face (Schibsted Grotesk), not mono.

#### Scenario: Tab bar visible on phone
- **WHEN** the app shell renders at a viewport narrower than 768px on any protected route
- **THEN** the bottom tab bar is visible with six tabs: Dashboards, Data Sources, Data Pipelines,
  Type Registry, Metrics, Chat

#### Scenario: Tab navigates and reflects active section
- **WHEN** the user taps a tab
- **THEN** the router navigates to that section and only that tab renders in the active state

#### Scenario: Hidden at desktop widths
- **WHEN** the viewport is 768px or wider
- **THEN** the bottom tab bar is not visible and the desktop sidebar behaves exactly as before

## ADDED Requirements

### Requirement: MobileNavSheet's section-picker stays in parity with the desktop sidebar for chat
The phone item-picker (`MobileNavSheet`, driven by `App.tsx`'s per-section switch statements) SHALL
have a `"chat"` arm covering conversation listing/selection, so a phone user's item-picker and a
desktop user's sidebar list always reflect the same conversations and the same selection action —
matching every other existing section's parity (sources/pipelines/registry/metrics).

#### Scenario: Selecting a conversation via MobileNavSheet matches desktop sidebar selection
- **WHEN** a phone-width user selects a conversation via `MobileNavSheet`
- **THEN** the same `selectedConversationId` Redux action fires as the desktop sidebar's
  `onSelect` would dispatch for the identical conversation

#### Scenario: The chat section's empty-picker message is present
- **WHEN** `MobileNavSheet` opens for the chat section with no conversations
- **THEN** a section-specific empty message is shown, not a blank sheet
