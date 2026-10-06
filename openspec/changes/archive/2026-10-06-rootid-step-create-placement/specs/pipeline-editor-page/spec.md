## MODIFIED Requirements

### Requirement: Steps can be inserted between existing steps in the editor

The pipeline editor SHALL offer an "insert step here" affordance in each gap of the step list —
before the first step card and between each adjacent pair (appending after the last step remains
the existing add-step row). The affordance SHALL:

- Open the add-step palette carrying that gap's insert context; selecting a step creates it at that
  gap, directly after the persisted step that precedes the gap (or first, for the gap before the first
  step)
- Reflect the inserted step immediately at the chosen position (optimistic), reconciling with the
  persisted step on success; on failure, keep the local step and surface a visible error (the
  editor's existing add-step failure convention)
- Leave the existing append flow unchanged
- Trigger the editor's existing analyze refresh (and thereby per-step validation/preview updates)
  after the insert settles

After a trunk create succeeds — whether the step was created immediately or as a deferred draft
once its config became complete — the editor SHALL bring every step the create touched in line with
the server in the same update that replaces the local placeholder: the created step takes its
persisted fields, and every step the server reports as reparented shows the created step as its
parent. That update SHALL keep every local-only step (one not yet persisted, including another draft
or another create still in flight), SHALL NOT change any step the create did not touch, SHALL keep a
draft's stable render key so its open card stays open, and SHALL NOT replace any step's local config.
The created step SHALL appear exactly once, and no step SHALL leave the rendered lane while it settles.

An insert's placement SHALL be anchored on the persisted step that precedes the chosen gap (local-only
steps are not counted), identified by that step and never by a list index, so it does not go stale
while the insert waits for its create or while other inserts complete. If that step no longer exists
when the create is sent, the step SHALL be appended at the trunk's end rather than rejected. A step
the server created SHALL appear on screen even if another update replaced the step list while its
create was in flight, unless the user removed it.

#### Scenario: Insert before the first step

- **WHEN** the user activates the insert affordance above the first step card and picks an op
- **THEN** the new step appears first, the previously-first step moves to second, and the order
  persists across reload

#### Scenario: Insert between two steps

- **WHEN** the user activates the insert affordance between step cards A and B and picks an op
- **THEN** the new step appears between A and B, later steps shift down by one, and the order
  persists across reload

#### Scenario: Append is unchanged

- **WHEN** the user adds a step via the existing bottom add-step control
- **THEN** the step is appended at the end exactly as before, and it is still at the end after
  reload

#### Scenario: Analyze refreshes after an insert

- **WHEN** a step is inserted between existing steps
- **THEN** the pipeline re-analyzes without manual action and downstream steps' schemas/validation
  reflect the new upstream step

#### Scenario: A draft created at an insert position resyncs reparented steps

- **WHEN** a draft step inserted between A and B becomes complete and its create succeeds, and the
  server reparents B under the created step
- **THEN** without a reload, B's local parent is the created step, matching the server

#### Scenario: The post-create update keeps local-only steps

- **WHEN** a trunk create succeeds while another draft step exists only locally (never sent, or its
  create still in flight)
- **THEN** that other draft step is still on screen with its config, and its own later create still
  replaces it in place

#### Scenario: The post-create update keeps an open card open

- **WHEN** a draft's create succeeds
- **THEN** the created step's card stays expanded and keeps any edit made while the create was in
  flight

#### Scenario: An immediately-created step appears exactly once without hiding other steps

- **WHEN** the user inserts a step whose kind is created immediately, before the first step or
  between two steps, and the create succeeds
- **THEN** exactly one card for that step is on screen, every other step of the lane stays rendered
  with any open card still open, and steps the server reparented show their persisted parent

#### Scenario: Overlapping creates neither duplicate nor drop a step

- **WHEN** the user starts a second insert at the same gap while the first insert's create is still
  in flight
- **THEN** each created step appears exactly once, each open card stays open, and every step shows the
  parent the server persisted (the step order matches the server's)

#### Scenario: A draft completed after its trunk shrank is still created

- **WHEN** a draft is inserted between the second and third steps, the second step is then deleted,
  and the draft's config is completed
- **THEN** the draft is created (appended at the trunk's end when its anchor is gone, otherwise
  directly after its anchor) and no create is rejected for an out-of-range position

#### Scenario: Inserts at different gaps land where each was chosen

- **WHEN** the trunk is A, B, C, the user inserts X between A and B, and while X's create is in flight
  inserts Y between B and C
- **THEN** after both creates complete, in either response order, the server and the screen both show
  A, X, B, Y, C

#### Scenario: A created step is not lost to a concurrent list refresh

- **WHEN** an insert's create is in flight and another action (for example duplicating a step)
  replaces the step list before the create completes
- **THEN** once the create completes, the created step is on screen exactly once and the steps it
  reparented show it as their parent
