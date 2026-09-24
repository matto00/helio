## MODIFIED Requirements

### Requirement: A counter's optimistic rollback is scoped to its own submit-request failure only

A `counter` field's optimistic value SHALL be rolled back, with a visible, announced, field-associated
error (`aria-invalid="true"` and `aria-describedby` pointing at the error text), only when its own
immediate-submit request receives a **definite rejection** — a response from the server, of any status
code, including a 4xx or 5xx with a body. A downstream pipeline run later reported as `failed`, or a
debounced auto-run silently denied by the rate/concurrency guard or the cost gate, SHALL NOT roll back
the optimistic value — the write itself already persisted in both of those cases, and reverting it
would misrepresent state that is actually true. An **indeterminate** outcome (no response received at
all — a network error, a timeout, or an aborted request) is NOT a rollback trigger; it is handled
instead by the reconciliation requirement below, unaffected by whether the burst it belongs to also
happens to quiesce on this rollback. Because multiple immediate-submit requests may be concurrently in
flight (see the accumulation requirement above), a rejected request's rollback SHALL subtract only that
request's own delta from the currently displayed value, never restore an earlier snapshot — an earlier
snapshot may no longer reflect sibling clicks that have since succeeded or are still pending. A
field-associated error set by a definite rejection SHALL be cleared on the next successful
immediate-submit settle for that field (mirroring the whole-form submit path's existing
clear-on-success behavior) — it SHALL NOT persist once a later request for the same field has
succeeded. This same field-associated error SHALL NOT be cleared by that same rejected settle's own
subsequent reconciliation (the following requirement) reading back and applying the dataset's
aggregate value — reconciling the displayed TOTAL is independent of, and SHALL NOT clear, this
requirement's field-level error/invalid state; only a later request's own success clears it.

#### Scenario: A rejected submit's own trailing reconciliation does not clear its error
- **WHEN** a counter's immediate-submit request is rejected by the server, no other request is
  concurrently in flight, and the resulting quiesced reconciliation fetch (the following requirement)
  itself succeeds
- **THEN** the counter control's computed `aria-invalid` is still `"true"` and `aria-describedby` still
  resolves to the error text after that reconciliation fetch resolves

#### Scenario: A rejected submit rolls back with a visible error
- **WHEN** a counter's immediate-submit request is rejected by the server (a response with any status
  code) and no other request is concurrently in flight
- **THEN** the optimistic value is reduced by exactly that click's own delta, the counter control's
  computed `aria-invalid` is `"true"`, its computed `aria-describedby` resolves to the error text, and
  the assertive region announces the failure

#### Scenario: A rollback while a sibling click is still in flight subtracts only its own delta
- **WHEN** two immediate-submit requests are in flight and the first is rejected by the server while
  the second is still pending
- **THEN** the displayed value is reduced by only the first click's own delta, and the second click's
  own optimistic delta remains reflected in the display

#### Scenario: A downstream run failure does not roll back an already-persisted write
- **WHEN** a counter's immediate-submit request itself succeeded, and a downstream pipeline run it
  triggered later reports `failed` over the run-status stream
- **THEN** the counter's displayed value is not rolled back on account of that downstream failure

#### Scenario: A network failure with no response is never a rollback trigger
- **WHEN** a counter's immediate-submit request fails with no response at all (network error, timeout,
  or abort)
- **THEN** the optimistic value is NOT reduced on account of that failure alone

#### Scenario: A field-associated rejection error clears on the next successful click
- **WHEN** a counter's immediate-submit request is rejected by the server, marking the control invalid,
  and a later immediate-submit request for the same field succeeds
- **THEN** the control's computed `aria-invalid` is no longer `"true"` once that later success settles

### Requirement: A counter's displayed value reconciles to the dataset's authoritative aggregate after a successful submit

Once every request in a `counter` field's current pending burst has settled — a success, a definite
rejection, or an indeterminate failure, in any mix and in any order — the client SHALL fetch the
field's current aggregate value from the dataset (the authoritative sum of every row's `delta` for that
`sourceField`) and reconcile the displayed value against it, subject to the same generation/pending-set
staleness guards that prevent a stale fetch from overwriting a newer optimistic delta. This
reconciliation is decoupled from any downstream auto-run pipeline: it SHALL occur once the burst
quiesces regardless of whether a downstream pipeline exists for the bound dataset, or whether the
auto-run cost gate would deny one. This reconciliation is NOT conditional on which particular settle is
the one that empties the pending set: a burst that happens to quiesce on a definite-rejection settle
SHALL still trigger the fetch, exactly like a burst that quiesces on a success or an indeterminate
settle — so an earlier sibling's indeterminate outcome within the same burst is never left uncorrected
merely because a later sibling's own settle (of any kind) was the one that emptied the set. A definite
rejection's own field-level error/rollback (previous requirement) is unaffected by this reconciliation
— the two are independent: the rollback corrects the OPTIMISTIC delta immediately on that settle, while
this reconciliation corrects the DISPLAYED TOTAL once the whole burst quiesces, for every settle kind
alike; applying the reconciled total SHALL NOT clear any field-associated error the triggering (or any
other) settle in the burst has set — value-reconciliation and error-state are applied through separate
mechanisms so that one can never incidentally clear the other. Only when the settle that ultimately
empties the pending set was itself an **indeterminate** failure (no response), and the resulting
reconciliation fetch also fails, SHALL the optimistic value be left as-is (never silently discarded)
and the assertive region announce that the current value could not be confirmed, distinctly from a
definite-rejection error. A reconciliation fetch's own failure when triggered by a **success** or a
**definite-rejection** settle SHALL NOT produce this (or any other) new announcement — a successful
settle's own trailing fetch failure remains silent exactly as it is today (nothing was ever in doubt:
the write succeeded and the optimistic value already reflects it), and a definite-rejection settle's
own trailing fetch failure SHALL NOT overwrite or supersede that rejection's own already-announced
error text.

#### Scenario: Value reconciles after a successful submit with no downstream pipeline
- **WHEN** a counter submit succeeds and the bound dataset has no downstream pipeline at all
- **THEN** the displayed value is replaced by the dataset's own current aggregate, without waiting
  on any pipeline run

#### Scenario: Value reconciles after a successful submit even when the auto-run gate denies
- **WHEN** a counter submit succeeds and every downstream pipeline for the bound dataset is denied
  by the auto-run cost gate
- **THEN** the displayed value is still replaced by the dataset's own current aggregate, without
  spinning in a pending state indefinitely

#### Scenario: A lost acknowledgement after a committed write reconciles to the true total
- **WHEN** a counter's immediate-submit request commits on the server but the client observes a
  network failure with no response, and no other request is concurrently in flight
- **THEN** the client fetches the dataset's aggregate and the displayed value ends at the persisted
  total, not rolled back by the failed click's own delta

#### Scenario: Reconciliation is deferred until the whole burst quiesces
- **WHEN** one immediate-submit request fails with no response while a sibling request is still
  outstanding
- **THEN** no aggregate fetch occurs until the sibling also settles, exactly like the existing
  successful-settle quiesce behavior

#### Scenario: A burst that quiesces on a definite-rejection settle still reconciles an earlier sibling's indeterminate outcome
- **WHEN** an indeterminate (no-response) request settles first while a sibling request is still
  outstanding, and that sibling later settles with a definite rejection — the definite-rejection settle
  is the one that empties the pending set
- **THEN** the reconciliation fetch still fires on that settle, and the displayed value ends reflecting
  the dataset's true aggregate rather than leaving the earlier indeterminate write's outcome
  uncorrected

#### Scenario: A failed reconciliation fetch announces an unconfirmed state without discarding the value
- **WHEN** the settle that empties the pending set is itself an indeterminate (no-response) failure,
  triggering a reconciliation fetch, and that fetch itself fails
- **THEN** the displayed optimistic value is left unchanged and the assertive region announces that the
  current value could not be confirmed

#### Scenario: A reconciliation fetch failure triggered by a success settle stays silent
- **WHEN** the settle that empties the pending set is itself a success, triggering a reconciliation
  fetch, and that fetch itself fails
- **THEN** no "couldn't confirm" announcement is made and the already-correct optimistic value is left
  as displayed, exactly as before this change

#### Scenario: A reconciliation fetch failure triggered by a definite-rejection settle does not overwrite the rejection's own error
- **WHEN** the settle that empties the pending set is itself a definite rejection, triggering a
  reconciliation fetch, and that fetch itself fails
- **THEN** no "couldn't confirm" announcement is made, and the assertive region still shows the
  definite rejection's own error text, not overwritten by anything related to the failed fetch

#### Scenario: A stale reconciliation fetch triggered by any settle kind is discarded like any other
- **WHEN** a quiesce-triggered reconciliation fetch (fired from any settle kind — success, definite
  rejection, or indeterminate) is still in flight when a new immediate-submit request is activated
- **THEN** the arriving fetch response is discarded rather than overwriting the display, per the
  existing generation-guard behavior, and the new request's own eventual settlement drives a fresh
  reconciliation
