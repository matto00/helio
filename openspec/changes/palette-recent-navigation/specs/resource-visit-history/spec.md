## Purpose
Records which resources a user has visited and in what order, so that surfaces which want to offer "return to
where you were" have a durable, trustworthy history to read, and so that history survives reloads without
accumulating references to resources that no longer exist.

## ADDED Requirements

### Requirement: A visit is recorded however the user arrives
The application SHALL record a visit whenever a user arrives at a dashboard, a data source, or a data
pipeline, regardless of how they arrived — including selecting it from a list, following a direct link,
using browser history navigation, and running a command from the palette. Recording SHALL NOT depend on the
user having used any particular entry point.

#### Scenario: Every arrival path records
- **WHEN** a user arrives at a resource by selecting it from a list, by direct URL, by browser back or
  forward, or by running a palette command
- **THEN** a visit is recorded in every one of those cases

#### Scenario: Re-visiting moves a resource to most recent
- **WHEN** a user visits a resource they have visited before
- **THEN** it becomes the most recent entry rather than being duplicated

### Requirement: History persists, is bounded, and degrades safely
Visit history SHALL survive a page reload, SHALL be bounded to a fixed maximum number of entries with the
least recent discarded first, and SHALL tolerate its stored form being absent, unreadable, malformed, or
unwritable without failing the surfaces that read it.

#### Scenario: History survives a reload
- **WHEN** a user visits resources and reloads the application
- **THEN** the previously recorded history is still available

#### Scenario: Unreadable or malformed storage yields an empty history
- **WHEN** the stored history is absent, malformed, or cannot be read
- **THEN** the history reads as empty and no surface fails

#### Scenario: Storage that cannot be written does not break navigation
- **WHEN** the history cannot be persisted
- **THEN** the user's navigation still succeeds and the application does not fail

#### Scenario: History is bounded
- **WHEN** more resources are visited than the maximum retained
- **THEN** the least recently visited entries are discarded and the most recent are kept

### Requirement: Stale entries are forgotten, but only against known-good knowledge
History SHALL drop entries for resources that no longer exist. It SHALL NOT drop an entry merely because the
application does not yet know whether that resource exists — in particular, while the collection that would
confirm it is still loading. Showing a stale entry is preferable to discarding a valid one.

#### Scenario: A deleted resource is forgotten
- **WHEN** a recorded resource has been deleted and the collection confirming this is loaded
- **THEN** its entry no longer appears

#### Scenario: An unloaded collection does not cause forgetting
- **WHEN** the collection that would confirm a recorded resource's existence has not finished loading
- **THEN** that entry is retained rather than discarded
