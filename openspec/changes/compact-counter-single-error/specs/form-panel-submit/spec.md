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

In the compact single-counter layout, a definite rejection's message SHALL be rendered and announced
exactly once: its text SHALL appear only in the form's always-mounted assertive region, the field SHALL
render no error text of its own for it, and the counter control's `aria-describedby` SHALL reference that
assertive region so the control's computed accessible description is the message. Exactly one element with
role `alert` within the panel SHALL contain the message. The assertive and polite regions SHALL remain
mounted with their roles whether empty or not. A form with more than one field is unaffected by this
paragraph: it keeps its form-level summary and each rejected control's own field error.

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

#### Scenario: A compact counter's rejection message is rendered and announced once
- **WHEN** the single counter of a compact counter form has its immediate-submit request rejected by the
  server with a message
- **THEN** the message text appears exactly once in the panel, inside the assertive (`alert`) region; no
  other element with role `alert` in the panel contains it; the field renders no error text; and the
  counter control is `aria-invalid="true"` with a computed accessible description equal to the message

#### Scenario: A repeated identical rejection is announced again
- **WHEN** a compact counter step is rejected with a message, and a later step is rejected with the same message
- **THEN** the assertive region is emptied when the later step starts and holds the message again once it is
  rejected, still in exactly one place

#### Scenario: A multi-field form keeps its summary and per-field errors
- **WHEN** a form with more than one field has a submit rejected with a field error for a rendered control
- **THEN** the assertive region carries the summary and that control still shows its own field error, as before

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
