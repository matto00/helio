## RENAMED Requirements

- FROM: `### Requirement: Only a caller who can see the panel and owns its source may submit`
- TO: `### Requirement: Only a caller with owner or editor access to the panel's dashboard may submit`

## MODIFIED Requirements

### Requirement: A submit appends exactly one row to the panel's bound source through a panel-scoped API

The system SHALL expose `POST /api/panels/:id/submit` accepting `{"values": {"<sourceField>": <value>}}` for a
`form` panel. A successful submit SHALL append exactly one row to the source the panel is bound to and SHALL respond
`201 Created` with that row's identity: `id` and `updatedAt` always, and `seq` only when the submitter is the form's
owner (a non-owner submitter's response carries no `seq` key). The write target SHALL be the panel's persisted
binding only: the request SHALL NOT be able to name a source, and a request body carrying any key other than
`values` SHALL be rejected with `400`. Fields the form does not configure SHALL be written as absent, so the dataset's
declared default (or declared requirement) applies.

#### Scenario: One row lands on the bound source only
- **WHEN** a valid submit is made for a panel bound to source A while source B also exists
- **THEN** source A has exactly one more row and source B is unchanged

#### Scenario: A request cannot redirect the write
- **WHEN** the request body is `{"values": {...}, "dataSourceId": "<other source>"}`
- **THEN** the response is `400` and no source is modified

#### Scenario: Unconfigured declared field takes its default
- **WHEN** the dataset declares `status` with a default and the form has no `status` field
- **THEN** the appended row holds the declared default for `status`

#### Scenario: A non-owner submitter gets no seq
- **WHEN** a dashboard editor who is not the form's owner submits successfully
- **THEN** the `201` response's row carries `id` and `updatedAt` and no `seq` key

#### Scenario: The form owner still gets seq
- **WHEN** the form's owner submits successfully
- **THEN** the `201` response's row carries `id`, `seq` and `updatedAt`

### Requirement: Only a caller with owner or editor access to the panel's dashboard may submit

`POST /api/panels/:id/submit` SHALL admit a caller who holds `owner` or `editor` access to the panel's dashboard,
whether or not they own the form or hold any grant on its bound source. It SHALL respond `404` when the panel is not
visible to the caller, `400` when the panel is not a `form` panel, `403` with the message
`You have view-only access to this dashboard` when the caller holds a named `viewer` grant, `404` when a signed-in
caller holds no named grant on the dashboard (including when the dashboard is public), and `404` when the form owner's bound source no longer exists, is no longer owned by the form's
owner, or the config carries no binding. The row SHALL be written as the form's owner sees their own source, with
row-level security enforced for the application database role, so a write can only ever land on a source the form's
owner owns. No row SHALL be written in any refused case. Access SHALL be re-checked on every submit, so a revoked or
downgraded grant takes effect on the next request.

#### Scenario: Editor grantee submits to the owner's source
- **WHEN** a user holding a named `editor` grant on the dashboard, with no grant on the bound source or any pipeline,
  submits a valid form
- **THEN** the response is `201` and the owner's source has exactly one more row

#### Scenario: Grantee cannot write the owner's source
- **WHEN** a user holding a named `viewer` grant on the dashboard submits
- **THEN** the response is `403` with `You have view-only access to this dashboard` and the source is unchanged

#### Scenario: Stranger cannot see the form
- **WHEN** a signed-in user with no grant on a non-public dashboard submits to one of its form panels
- **THEN** the response is `404` and the source is unchanged

#### Scenario: A signed-in stranger on a public dashboard is not admitted
- **WHEN** a signed-in user with no named grant submits to a form panel on a public dashboard
- **THEN** the response is `404` and the source is unchanged

#### Scenario: A form whose owner does not own the bound source writes nothing
- **WHEN** a form panel's owner does not own the source its binding names (for example a copy made by another user)
  and that owner submits
- **THEN** the response is `404` and no source is modified

#### Scenario: A downgraded editor is refused on the next submit
- **WHEN** an editor's grant is changed to `viewer` and they submit again
- **THEN** the response is `403` and nothing is written

#### Scenario: The dashboard owner submits a form an editor created
- **WHEN** an editor created a form panel bound to their own dataset on the dashboard and the dashboard's owner submits
  it
- **THEN** the response is `201` and the row lands on the editor's (the form owner's) source

#### Scenario: Write is bounded by row-level security as the application role
- **WHEN** the submit path runs against a database role without `BYPASSRLS`
- **THEN** the editor's submit lands in the form owner's source, and an append attempted in the editor's own database
  context against that source writes nothing

#### Scenario: Deleted bound source is reported as not found
- **WHEN** the owner submits to a form panel whose bound source has since been deleted
- **THEN** the response is `404` and nothing is written

#### Scenario: Non-form panel is rejected
- **WHEN** the panel id names a `text` panel
- **THEN** the response is `400`

### Requirement: A counter's displayed value reconciles to the dataset's authoritative aggregate after a successful submit

This requirement applies when the signed-in user is the form's owner (the user who owns the panel and its bound
source). A user who is not the form's owner never reads the dataset's aggregate; see "A non-owner's counter shows a
local tally and never reads the dataset". Once every request in a `counter` field's current pending burst has settled — a success, a definite
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

## ADDED Requirements

### Requirement: A form's bound field declarations are readable per panel by dashboard owners and editors

The system SHALL expose `GET /api/panels/:id/form-schema` for a `form` panel, responding `200` with
`{"fields": [...]}` holding the bound dataset's declarations of exactly the fields the form configures (each
declaration as the dataset schema route returns it), in the dataset's declared order, and no other declaration. It SHALL
admit a caller with `owner` or `editor` access to the panel's dashboard, checked on every request, and respond `404`
when the panel is not visible to the caller, `403` with `You have view-only access to this dashboard` for a named
`viewer` grant, `404` for a signed-in caller with no named grant (including on a public dashboard), `400` for a
non-`form` panel, and `404` when the form owner's bound source no longer exists. The read SHALL run
as the form's owner sees their own source with row-level security enforced, and SHALL read no dataset row.

#### Scenario: Editor reads only the form's fields
- **WHEN** a dataset declares `a`, `b` and `c`, the form binds `a` and `c`, and a dashboard editor requests the route
- **THEN** the response holds the declarations of `a` and `c` only

#### Scenario: Viewer and stranger are refused
- **WHEN** a viewer grantee requests the route, and a user with no grant requests it
- **THEN** the viewer gets `403` and the stranger gets `404`

#### Scenario: Read is bounded by row-level security as the application role
- **WHEN** the route runs against a database role without `BYPASSRLS`
- **THEN** the editor receives the form owner's declarations, and the same read in the editor's own database context
  returns nothing

### Requirement: A non-owner's counter shows a local tally and never reads the dataset

When the signed-in user is not the form's owner, a `counter` field SHALL show its `+`/`-` controls and a value that
starts from the field's initial value (or empty) and moves only by the deltas of that user's own successful clicks in
this view. The client SHALL NOT request the dataset's aggregate, rows or schema routes for that form. A definite
rejection SHALL roll back that click's delta exactly as for the owner. An indeterminate failure (no response) SHALL
leave the tally as displayed and the assertive region SHALL announce that the current value could not be confirmed.

#### Scenario: An editor's clicks move a local tally without an aggregate read
- **WHEN** a dashboard editor who is not the form's owner presses `+` three times and each submit succeeds
- **THEN** the displayed value has moved by three steps and no request to `/api/data-sources/*` was made

#### Scenario: An editor's compact counter is enabled with only the bound field's declaration
- **WHEN** a non-owner opens a form whose single field is a counter, and the schema it received holds only that field's
  declaration (no `occurred_at`/`value`)
- **THEN** the `+`/`-` controls are enabled, show no configuration issue, and `+` submits

#### Scenario: An editor's indeterminate click is announced as unconfirmed
- **WHEN** a non-owner's counter submit fails with no response
- **THEN** the tally is left as displayed and the assertive region announces that the value could not be confirmed

### Requirement: A counter submit is refused when the dataset no longer has the counter row shape

When a form configures a `counter` field, the submit SHALL be validated, against the dataset declaration read under
the write lock, for the counter row shape the form required when it was configured (a field named `occurred_at` of type
timestamp, and a field named `value` that is numeric and not required). If the shape no longer holds, the submit SHALL write nothing and respond `400` for every
submitter, the form's owner included.

#### Scenario: Renamed occurred_at refuses the counter write
- **WHEN** the owner renames the dataset's `occurred_at` field after configuring a counter form, and then an editor
  presses `+`
- **THEN** the response is `400` with the generic "form no longer matches its dataset" message and no row is written

#### Scenario: Dropped value refuses the counter write
- **WHEN** the owner drops the dataset's `value` field after configuring a counter form, and an editor presses `+`
- **THEN** the response is `400` with the generic message and no row is written

#### Scenario: The owner's direct submit is refused too
- **WHEN** the form's owner submits the same counter form through the API
- **THEN** the response is `400` and no row is written

### Requirement: A non-owner submitter learns nothing of the dataset beyond the form's own fields

For a submitter who is not the form's owner, a rejected submit SHALL NOT name any declared field the form does not
configure: such field errors SHALL be dropped and the message SHALL say the form no longer matches its dataset. A
row-limit rejection SHALL NOT state the limit. The form's owner SHALL receive the existing, unfiltered errors.

#### Scenario: An unbound required field is not disclosed to an editor
- **WHEN** the dataset declares a required field `secret_note` with no default that the form does not configure, and an
  editor submits
- **THEN** the `400` response does not contain `secret_note` and its message says the form no longer matches its dataset

#### Scenario: The owner still sees the precise error
- **WHEN** the form's owner submits in the same situation
- **THEN** the `400` response's `fieldErrors` names `secret_note`

#### Scenario: An editor cannot probe which fields the dataset declares
- **WHEN** an editor submits the form's configured values plus an extra key the dataset declares but the form does not
  configure, and separately the same values plus an extra key the dataset does not declare
- **THEN** the two `400` response bodies are identical

#### Scenario: A non-owner's row-limit rejection states no number
- **WHEN** the dataset is at its row limit and an editor submits
- **THEN** the `400` message contains no digit

### Requirement: A write by a non-owner is attributed to its submitter and its auto-run to the pipeline owner

A successful submit SHALL record an audit event for the append whose actor is the submitter and which names the panel.
Any downstream auto-run the write schedules SHALL be submitted as, and counted against, the pipeline's owner (their
HEL-505 rate limit and concurrency cap), and the run SHALL record the last writer before it fired as the user who
triggered it, as an editor's manual run does.

#### Scenario: An editor's submit triggers an auto-run counted against the pipeline owner
- **WHEN** an editor submits to a form whose dataset feeds an auto-runnable pipeline and the debounce fires
- **THEN** the run is in the pipeline owner's run history, counts toward the owner's concurrency cap, and its
  triggering user is the editor

#### Scenario: The audit event names the editor
- **WHEN** an editor submits successfully
- **THEN** the append's audit event has the editor as actor and carries the panel id
