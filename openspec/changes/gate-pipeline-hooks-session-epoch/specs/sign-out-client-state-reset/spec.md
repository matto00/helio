## MODIFIED Requirements

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
