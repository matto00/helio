# palette-recent-navigation Specification

## Purpose
Makes the command palette's empty-query state useful by offering the user the resources they most recently
visited, so returning to recent work is a single keystroke rather than a search or a navigation.

## Requirements

### Requirement: The empty-query palette offers recent resources
When the command palette is opened with no query, it SHALL present the user's most recently visited
resources, most recent first, grouped under their own section, **ordered ahead of — and in addition to —
the content the palette already presents on an empty query**. Presenting recents SHALL NOT remove or
suppress any section the palette already presented. When no history exists, the palette SHALL present its
existing default content exactly as it does today.

#### Scenario: Recents are offered on an empty query, alongside existing content
- **WHEN** the user opens the palette with an empty query and has visited resources before
- **THEN** those resources are listed, most recently visited first, under their own section, ahead of the
  sections the palette already presented — and every one of those sections is still present

#### Scenario: Empty history leaves the existing presentation untouched
- **WHEN** the user opens the palette with an empty query and has no recorded history
- **THEN** the palette presents its existing default content exactly as it does today, and nothing fails

#### Scenario: Typing a query leaves recents behind
- **WHEN** the user types a query
- **THEN** the palette returns to its normal filtered results

### Requirement: Selecting a recent resource returns the user to it
Selecting a recent entry SHALL take the user to that resource, for every kind of resource the history
records, including kinds whose location is not expressed in the address bar.

#### Scenario: Each recorded kind can be returned to
- **WHEN** the user selects a recent dashboard, a recent data source, or a recent data pipeline
- **THEN** the application opens that resource, in each case

#### Scenario: A resource without an address is still reachable
- **WHEN** the user selects a recent resource whose selection is not represented in the address bar
- **THEN** the application still opens that specific resource rather than a generic landing view

### Requirement: Recent resources end with the session
The recent-resource history SHALL NOT survive the end of a session. When the user signs out, or the
client is signed out because the server rejected the session, the recorded history SHALL be discarded
from the browser, so the next person to sign in on that browser is never offered the previous user's
recent resources.

#### Scenario: A different user signing in on the same tab sees no inherited recents
- **WHEN** user A visits resources, signs out, and user B signs in on the same tab without reloading
- **THEN** B's empty-query palette offers none of A's resources, and A's history is no longer stored in the browser

#### Scenario: A rejected session clears recents too
- **WHEN** the server rejects the current session and the client signs the user out
- **THEN** the recorded history is discarded exactly as on an explicit sign-out
