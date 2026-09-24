## ADDED Requirements

### Requirement: A counter's immediate-submit control exposes a computed pending state while a request is in flight

While a `counter` field's immediate-submit request (`handleImmediateStep`) is in flight, the counter
control SHALL expose `aria-busy="true"` on its `role="spinbutton"` element, in addition to the
existing submit-button `aria-disabled` state. This state SHALL be asserted by its computed ARIA
value in tests, never by the mere presence of a loading element in the DOM.

#### Scenario: Pending state is exposed while the request is outstanding
- **WHEN** a counter's `+`/`-` control is activated and the resulting submit request has not yet
  resolved
- **THEN** the control's computed `aria-busy` value is `"true"`

#### Scenario: Pending state clears once the request settles
- **WHEN** the outstanding submit request resolves (success or failure)
- **THEN** the control's computed `aria-busy` value is no longer `"true"`

### Requirement: A counter's displayed value reconciles to the dataset's authoritative aggregate after a successful submit

After a `counter` field's immediate-submit request succeeds, and no other immediate-submit request
for that same field is still outstanding, the client SHALL fetch the field's current aggregate value
from the dataset (the authoritative sum of every row's `delta` for that `sourceField`) and replace the
locally-computed optimistic tally with it. This reconciliation is decoupled from any downstream
auto-run pipeline: it SHALL occur on the submit request's own success (or, when multiple requests were
concurrently in flight, once the last of them settles), regardless of whether a downstream pipeline
exists for the bound dataset, or whether the auto-run cost gate would deny one. A rejected or failed
submit request is NOT a trigger for this reconciliation — it is handled instead by the existing
rollback behavior below.

#### Scenario: Value reconciles after a successful submit with no downstream pipeline
- **WHEN** a counter submit succeeds and the bound dataset has no downstream pipeline at all
- **THEN** the displayed value is replaced by the dataset's own current aggregate, without waiting
  on any pipeline run

#### Scenario: Value reconciles after a successful submit even when the auto-run gate denies
- **WHEN** a counter submit succeeds and every downstream pipeline for the bound dataset is denied
  by the auto-run cost gate
- **THEN** the displayed value is still replaced by the dataset's own current aggregate, without
  spinning in a pending state indefinitely

### Requirement: Rapid immediate-submit activations accumulate optimistically without regressing to a stale value

While one or more counter submit requests are in flight, each new activation's optimistic delta SHALL
accumulate on top of the current displayed value, and no aggregate reconciliation SHALL be fetched
until every request from the burst has settled (the previous requirement's "no other request still
outstanding" condition) — regardless of the order in which the individual requests' responses actually
arrive. Because no reconciliation is ever fetched while any sibling request is still outstanding, the
displayed value SHALL never visibly decrease during a burst: it only ever advances optimistically
(client-side accumulation) until the one reconciliation for the whole burst lands, at which point it
holds the true, already-larger-or-equal aggregate. This guarantee SHALL also hold across the
reconciliation fetch's own round trip: if a new immediate-submit request is activated after a
reconciliation fetch has been issued but before that fetch's response arrives, the arriving fetch
response SHALL NOT overwrite the displayed value with a result that predates the new request's own
optimistic delta — a fetch whose triggering condition no longer holds by the time it resolves SHALL be
discarded rather than applied, and the new request's own eventual settlement SHALL drive a fresh,
up-to-date reconciliation instead. This applies equally when the intervening request settles (succeeds
or fails) without itself emptying the pending set — its outcome still SHALL invalidate any
already-in-flight reconciliation fetch dispatched before it, even though that settlement alone would
not have triggered a new fetch.

#### Scenario: Ten rapid increments accumulate
- **WHEN** a user activates a counter's `+` control ten times in quick succession, each by its
  configured step
- **THEN** the displayed value reflects all ten increments accumulated, without visually reverting to
  an intermediate value at any point

#### Scenario: No reconciliation is fetched until the whole burst settles
- **WHEN** two immediate-submit requests are concurrently in flight for the same counter
- **THEN** no aggregate fetch occurs while either request is still outstanding, regardless of which one
  settles first

#### Scenario: A new activation during a reconciliation fetch's own round trip is not discarded
- **WHEN** a counter's pending map empties and a reconciliation fetch is dispatched, then a new
  immediate-submit request is activated before that fetch's response arrives
- **THEN** once the fetch resolves, the displayed value is not overwritten with the stale
  pre-activation result, and still reflects the new activation's own optimistic delta

#### Scenario: A sibling's success that doesn't empty the pending set still invalidates a stale fetch
- **WHEN** a reconciliation fetch is dispatched, then a second and third request fire, the second
  succeeds while the third is still outstanding (so the pending set does not empty), and the third then
  fails (emptying the pending set without dispatching a new fetch), before the original fetch resolves
- **THEN** the original fetch's stale result is discarded on resolution, and the displayed value still
  reflects the second request's own committed contribution

#### Scenario: Reconciliation is correct even when responses arrive out of request order
- **WHEN** two immediate-submit requests are concurrently in flight, the second request's underlying
  write commits before the first's, and the first request's response nonetheless arrives at the client
  first
- **THEN** the displayed value only reconciles once both requests have settled, and the reconciled
  value correctly reflects both writes with no visible backward movement at any point

### Requirement: A counter's optimistic rollback is scoped to its own submit-request failure only

A `counter` field's optimistic value SHALL be rolled back, with a visible, announced error, only when
its own immediate-submit request is rejected by the server or fails at the transport level. A
downstream pipeline run later reported as `failed`, or a debounced auto-run silently denied by the
rate/concurrency guard or the cost gate, SHALL NOT roll back the optimistic value — the write itself
already persisted in both of those cases, and reverting it would misrepresent state that is actually
true. Because multiple immediate-submit requests may be concurrently in flight (see the accumulation
requirement above), a rejected request's rollback SHALL subtract only that request's own delta from
the currently displayed value, never restore an earlier snapshot — an earlier snapshot may no longer
reflect sibling clicks that have since succeeded or are still pending.

#### Scenario: A rejected submit rolls back with a visible error
- **WHEN** a counter's immediate-submit request is rejected by the server and no other request is
  concurrently in flight
- **THEN** the optimistic value is reduced by exactly that click's own delta and the assertive region
  announces the failure

#### Scenario: A rollback while a sibling click is still in flight subtracts only its own delta
- **WHEN** two immediate-submit requests are in flight and the first is rejected by the server while
  the second is still pending
- **THEN** the displayed value is reduced by only the first click's own delta, and the second click's
  own optimistic delta remains reflected in the display

#### Scenario: A downstream run failure does not roll back an already-persisted write
- **WHEN** a counter's immediate-submit request itself succeeded, and a downstream pipeline run it
  triggered later reports `failed` over the run-status stream
- **THEN** the counter's displayed value is not rolled back on account of that downstream failure
