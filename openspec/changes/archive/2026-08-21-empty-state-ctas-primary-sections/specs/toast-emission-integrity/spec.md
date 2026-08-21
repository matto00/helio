## ADDED Requirements

### Requirement: A failure reported inline on every dispatch path SHALL NOT also emit a toast
A failure SHALL stop emitting a toast once **every** surface that can dispatch it reports it inline with
a persistent, error-intent, announced treatment carrying the failure's own message. Toast emission is
registered per thunk, not per call site, so a failure toast is all-or-nothing across every surface that
dispatches that thunk. Until every such surface conforms, the toast SHALL be retained, since a redundant
notification is a safer failure mode than a silent one.

Dashboard creation SHALL meet this bar: both surfaces that create a dashboard report the rejection inline
— one as an error banner, one as an error-intent empty state — so the rejection SHALL emit no toast, and
SHALL be reported exactly once on each path.

#### Scenario: A failed dashboard create emits no toast
- **WHEN** creating a dashboard is rejected, from either surface that can create one
- **THEN** no error toast is emitted

#### Scenario: A failed dashboard create is still reported, inline, exactly once
- **WHEN** creating a dashboard is rejected from a given surface
- **THEN** that surface renders exactly one persistent, announced, error-intent report carrying the
  rejection's own message
