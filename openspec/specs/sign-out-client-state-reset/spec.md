# sign-out-client-state-reset Specification

## Purpose
Defines what the web client must discard when a session ends without a page reload, what it must keep, and
how new per-user client state is prevented from escaping that reset, so one user's data is never shown to
the next user of the same browser tab.

## Requirements

### Requirement: Ending a session discards every piece of per-user client state
When a session ends in the web client, by an explicit sign-out or by the client signing the user out after
the server rejects the session, the client SHALL discard all data it holds that was loaded for or derived
from that user: application state, in-memory caches, and per-user browser storage. Nothing discarded this
way SHALL be shown to, or used to make requests for, the next user who signs in on the same tab without a
page reload.

#### Scenario: User B sees none of user A's data after a same-tab switch
- **WHEN** user A signs in, opens a dashboard, its panel history and its provenance, then signs out, and user B signs in on the same tab without reloading
- **THEN** no dashboard, panel, row, history, provenance, insight, assistant, token or recent-visit data of A's is shown to B

#### Scenario: No request after the switch carries the previous user's resource ids
- **WHEN** user B signs in on the same tab after user A signed out
- **THEN** no request the client sends during B's session names a dashboard, panel, Output or pipeline id that belongs to A

#### Scenario: The rejected-session sign-out discards the same state
- **WHEN** a request is rejected because the session is no longer valid and the client signs the user out
- **THEN** the same per-user state is discarded as on an explicit sign-out

### Requirement: A load started before sign-out cannot repopulate state after it
A load of per-user data that was started during a session and finishes after that session ended SHALL NOT
write its result into application state or any cache. On the pipeline page, the continuation of such a load or
action SHALL NOT start follow-on work (a further request, or a state update) that carries the ended session's
pipeline, step or Output ids.

#### Scenario: A late response for the previous user is dropped
- **WHEN** a request for user A's data is in flight, A signs out, and the response arrives afterwards
- **THEN** the response is not stored and is never shown to the next user

#### Scenario: A late pipeline-page response does not start follow-on work with the previous user's ids
- **WHEN** user A, on a pipeline page, opens it, retries its steps load, adds an aggregate-tail Output,
  creates an Output, duplicates or removes a step, adds or removes a source, runs or dry-runs the pipeline, saves or
  reloads a draft, or loads truncated run history; the action awaits a response; A signs out; and the response arrives afterwards
- **THEN** no further request carrying A's pipeline, step or Output id is issued and no state update for A's
  pipeline is dispatched

#### Scenario: Pipeline-page draft create, shape apply, run end and undo stop after sign-out
- **WHEN** user A, on a pipeline page, completes a draft AI step's config (its create is in flight and A edits
  again), applies a shape, has a live run whose status stream ends, or undoes a save; the work awaits a response or
  stream event; A signs out; and the response or terminal event arrives afterwards
- **THEN** no further request carrying A's pipeline, step or Output id is issued (no edit flush, no next shape step or
  Output create, no pipeline reload) and no action for A's pipeline (Output preview, run-history refresh, step or
  Output replacement, pipeline fetch, toast) is dispatched

#### Scenario: A failed aggregate-tail Output in the same session still rolls back
- **WHEN** user A adds an Output as an aggregate tail, the aggregate step is created, the Output create fails, and A
  is still signed in
- **THEN** the orphaned aggregate step is deleted on the server and removed from the page, and the add reports a
  failure

### Requirement: Device preferences survive sign-out
Browser storage that records a preference of the device rather than data of a user SHALL be kept across
sign-out. Every browser storage key that the sign-out reset keeps SHALL be listed by name with the reason
it is kept.

#### Scenario: Device preferences are kept
- **WHEN** the user signs out
- **THEN** browser-stored device preferences are unchanged, and every key left behind is one the keep list names with a reason

### Requirement: New per-user client state cannot be added without joining the reset
The client's automated checks SHALL fail when a new in-memory cache or browser storage key is introduced
that neither joins the sign-out reset nor is listed as kept with a reason.

#### Scenario: An unregistered cache fails the checks
- **WHEN** a developer adds a module-level cache or a browser storage key without registering a reset or listing it as kept
- **THEN** the client's test suite fails and names the unregistered cache or key
