# pipeline-source-sample-store Specification

## Purpose
Hold one page load's source samples in client memory for the pipeline editor, refreshed only by an explicit action,
and tell the user plainly what those rows are: an exact static source, an aged live sample, or a 1,000-row prefix.

## Requirements

### Requirement: In-memory sample store with capture-once semantics

The client SHALL keep source samples in memory only, keyed by source id. Opening a pipeline page SHALL capture the
sample of each of its sampleable root sources (owned by the caller, or reachable through the pipeline scope per
"Granted sources are sampled through the pipeline scope") that has nothing cached, exactly once; later renders, step
edits and returning to the page in the same page load SHALL NOT re-fetch. A root source that is not sampleable SHALL
NOT be requested. A refresh control SHALL re-fetch that one source on demand. A page reload SHALL start with an empty
store, and signing out SHALL clear it.

#### Scenario: First open captures once
- **WHEN** the pipeline page opens and no sample is cached for its source
- **THEN** exactly one sample request is sent for that source

#### Scenario: Edits do not re-fetch
- **WHEN** the user edits steps on the open pipeline page
- **THEN** no further sample request is sent

#### Scenario: Manual refresh
- **WHEN** the user activates the refresh control on a source
- **THEN** exactly one new sample request is sent and the label's capture age resets

#### Scenario: Reload holds nothing
- **WHEN** the page is reloaded
- **THEN** nothing from the previous store is read from browser storage, and a new first capture is sent

### Requirement: Evaluator-ready store selectors

The store SHALL expose each sample as evaluator frames: decoded rows of the evaluator's value model plus a
`complete` flag that is false when the sample is truncated, for root frames and for secondary sources.

#### Scenario: Truncated sample is incomplete
- **WHEN** a sample has `truncated` true
- **THEN** its evaluator frame has `complete` false

### Requirement: Sample label rules

Each sampleable root source shown on the pipeline page, in both the desktop spine layout and the phone layout, SHALL
carry a label and a refresh control with these rules (a root source that is not sampleable for the caller SHALL carry
neither): a non-static source (`rest_api`, `sql`,
or a URL-backed file source) SHALL always show "sample · N rows · fetched <age>" when exact or "sample · first 1,000 of
N rows · fetched <age>" when truncated; any source with more than 1,000 rows, static included, SHALL show "first 1,000
of N rows" plus the caveat that counts and aggregates describe the sample; only a static source with an exact sample
SHALL show "Static · N rows". When a truncated live read has no known total, N SHALL read "1,000+".

#### Scenario: Non-static exact sample
- **WHEN** a REST source's sample has 412 rows and is not truncated
- **THEN** the label reads "sample · 412 rows · fetched <age>" and shows no caveat

#### Scenario: Non-static prefix sample
- **WHEN** a SQL source's sample is truncated with a known total of 12,431
- **THEN** the label reads "sample · first 1,000 of 12,431 rows · fetched <age>" with the caveat

#### Scenario: Static source over the cap
- **WHEN** an uploaded CSV has 12,431 rows
- **THEN** the label reads "first 1,000 of 12,431 rows" with the caveat and no capture age

#### Scenario: Static exact sample
- **WHEN** a dataset source has 30 rows
- **THEN** the label reads "Static · 30 rows"

#### Scenario: Viewer's card
- **WHEN** a viewer grantee views a shared pipeline whose root source they do not own
- **THEN** that source's card shows no sample label and no refresh control

### Requirement: Granted sources are sampled through the pipeline scope

On a pipeline page, the client SHALL capture, with the same capture-once and manual-refresh semantics as owned sources,
the sample of each root source the caller does not own when the analyze response's `callerRole` is `owner` or `editor`
(a permission-only signal, unaffected by invalid steps), by requesting it scoped to the pipeline whose page is open;
the refresh control SHALL use the scope of the page it is rendered on, never a pipeline id remembered from an earlier
capture. When the caller may
not sample a root source (a `viewer` grantee on someone else's source), the client SHALL send no sample request for it
and SHALL show no sample label or refresh control for it, rather than "Sample unavailable".

#### Scenario: Editor opens a shared pipeline
- **WHEN** an editor grantee opens a pipeline whose root source belongs to the owner
- **THEN** exactly one sample request scoped to that pipeline is sent for that source and its label shows the sample

#### Scenario: Viewer opens a shared pipeline
- **WHEN** a viewer grantee opens the same pipeline
- **THEN** no sample request is sent for the owner's source and its card shows no sample label

#### Scenario: Editor refresh keeps the scope
- **WHEN** the editor activates the refresh control on that source
- **THEN** exactly one new sample request scoped to that pipeline is sent

#### Scenario: Editor on a pipeline with an invalid step
- **WHEN** an editor grantee opens a shared pipeline one of whose steps is invalid
- **THEN** the owner's root source is still sampled and labelled

#### Scenario: Role not known yet
- **WHEN** the caller does not own a root source and the pipeline's analyze response has not arrived
- **THEN** that source's label reads "Loading sample…" and no sample request is sent for it until the role is known

#### Scenario: Analyze rejected
- **WHEN** the analyze request fails for a pipeline whose root source the caller does not own
- **THEN** that source's label reads "Sample unavailable" and no sample request is sent for it

#### Scenario: Refresh on a second pipeline
- **WHEN** an editor captured source S on pipeline P1 and later refreshes S on the page of pipeline P2
- **THEN** the refresh request is scoped to P2
