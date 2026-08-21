## ADDED Requirements

### Requirement: Each workspace create action is exposed as a reusable descriptor
Each of the workspace's create actions — dashboard, data source, pipeline, and panel — SHALL be exposed
by its owning feature as a reusable hook, rather than being written inline in each component that needs
it. Each hook SHALL return the same shape: a **descriptor field** carrying the action's label, icon and
handler, plus the action's own outcome state — whether it is in flight, and its failure message if it has
one. The descriptor field SHALL be in the shape the shared empty-state primitive already accepts for a
call to action, so that a consumer can pass **that field** directly without adapting it. That shape SHALL
be exported as a named type so consumers can annotate against it.

An action that cannot fail and is never in flight — one that only reveals a flow which owns its own
submission — SHALL report no failure and no in-flight state, rather than being given a different return
shape. One shape for every action is what lets a consumer treat them uniformly.

An action that **does** own a failure SHALL surface it through that state rather than discarding it. A
hook that swallows its rejection silently disables whatever inline surface was relying on it, which is the
silent-failure outcome the toast-emission capability's ordering rule exists to prevent.

A surface that renders an empty state for a section SHALL obtain that section's create action from its
feature's hook rather than re-deriving the flow itself, **where that surface's create affordance is the
flow the hook encodes**. This SHALL NOT be read as forbidding a surface from invoking a flow directly
where wiring the hook would be wrong: a navigation surface that can reach a section whose flow is mounted
elsewhere, or a surface offering a section's *other* create flow — for example a named-create form
alongside another surface's immediate quick-create — which the empty-state capability explicitly permits.

#### Scenario: An empty state consumes a create action without adapting it
- **WHEN** a section's empty state needs its create action
- **THEN** it obtains the hook's descriptor field and passes it to the empty-state primitive's
  call-to-action prop directly

#### Scenario: A create action that owns a failure surfaces it rather than discarding it
- **WHEN** a create action that performs its own request is invoked and the request is rejected
- **THEN** the hook reports that failure through its returned state, carrying the rejection's own message,
  so the consuming surface can render it inline

#### Scenario: Two surfaces invoking the same create action open the same flow
- **WHEN** the same create action is invoked from two surfaces that can both reach it
- **THEN** both open the identical creation flow, with no divergence in behavior between them

### Requirement: A create action's reach is bounded by where its flow is mounted, and that bound is recorded
A create action whose flow is a modal SHALL be usable from any surface **only when that modal is mounted
at the application shell**. Where the modal is mounted by a single page instead, the action SHALL be
documented as usable only from that page, and SHALL NOT be presented as globally invocable.

Setting a shared visibility flag that no mounted component reads is a defect, not a reach: it produces a
flow that silently opens later, on whatever route next mounts the modal. A create action SHALL therefore
be wired only where its flow is actually mounted, and this change SHALL introduce no
flag-set-with-nothing-mounted path.

Moving a flow's visibility flag from component-local state into shared state SHALL NOT be represented as
widening that flow's reach; it enables the descriptor, and nothing more.

A visibility flag held in shared state SHALL be cleared when the surface that mounts its flow unmounts.
Component-local state is destroyed on unmount; shared state is not, so a flag left set outlives its only
reader and re-opens the flow unbidden the next time that surface is entered — the same
opens-later-unasked defect as setting a flag nothing is mounted to read, arriving by a different route.

#### Scenario: A shell-mounted flow opens from any route
- **WHEN** a create action whose modal is mounted at the shell is invoked from an unrelated route
- **THEN** its creation flow opens in place, with no navigation required

#### Scenario: A page-mounted flow is only wired where it is mounted
- **WHEN** a create action's modal is mounted by a single page
- **THEN** that action is wired only on that page, and its documented reach says so

#### Scenario: An unmet precondition still blocks the action
- **WHEN** the panel create action is invoked with no dashboard selected
- **THEN** the action is unavailable, exactly as before its visibility flag moved into shared state

#### Scenario: A visibility flag does not survive its surface unmounting
- **WHEN** the surface that mounts a create flow's modal unmounts with that flow's visibility flag set
- **THEN** the flag is cleared, so re-entering that surface does not open the flow unbidden
