# pipeline-ai-tier-gating Specification

## Purpose
Pipeline-triggered AI model calls are gated by account tier and a shared daily quota, keyed on the
pipeline's owner across every trigger path, so a capped user cannot spend unbounded model budget
through a pipeline and always receives a clear error instead of a silent no-op.

## Requirements

### Requirement: Pipeline AI calls are gated by tier and daily quota
Every model call issued by a pipeline AI step SHALL pass a tier/quota check BEFORE the model
request is issued. The check SHALL be enforced at the single client seam every pipeline AI step's
model call passes through, so no individual step can bypass it. A `beta`-tier user at or over the
configured daily limit SHALL be denied and NO model request SHALL be sent for that call. An
`owner`-tier user SHALL never be counted or capped. A configured limit below 1 SHALL deny every
`beta` call ("always capped"). Where the gate's own dependencies are unavailable, the AI client
SHALL degrade to its unavailable state rather than permitting an ungated call.

#### Scenario: Beta user under the limit proceeds
- **WHEN** a `beta`-tier owner's pipeline runs an AI step and the owner is under the daily limit
- **THEN** the model call is issued and the step proceeds normally
- **AND** the owner's daily count increases by one per model call

#### Scenario: Beta user at the limit is denied before the model call
- **WHEN** a `beta`-tier owner is already at the configured daily limit and their pipeline runs an
  AI step
- **THEN** no model request is sent
- **AND** the step fails with a quota denial rather than returning empty or null output

#### Scenario: Owner tier is never capped
- **WHEN** an `owner`-tier owner's pipeline runs an AI step having already exceeded the beta limit
- **THEN** the model call is issued and nothing is counted against them

#### Scenario: A limit below 1 denies every beta call
- **WHEN** the configured daily limit is 0 or negative and a `beta`-tier owner's pipeline runs an
  AI step
- **THEN** the first call is denied with no model request and no counter row written

#### Scenario: Missing gate dependencies fail closed
- **WHEN** the gate's backing dependencies are unavailable
- **THEN** the AI client reports itself unavailable and issues no model call, rather than
  proceeding ungated

### Requirement: Quota is keyed on the pipeline owner on every trigger path
The identity a pipeline AI call is counted against SHALL be the pipeline's OWNER, never the
triggering caller, on every trigger path — manual run, scheduled run, hook-triggered run, and
preview. A scheduled run, which has no interactive user, SHALL count against the pipeline owner.

#### Scenario: Scheduled run counts against the owner
- **WHEN** a cron-fired run of a `beta`-tier user's pipeline executes an AI step
- **THEN** the call is counted against the pipeline owner's daily quota

#### Scenario: Grantee-triggered run counts against the owner, not the grantee
- **WHEN** an editor grantee triggers a run of another user's pipeline containing an AI step
- **THEN** the call is counted against the pipeline OWNER's quota, and not against the grantee's

#### Scenario: Owner preview charges the owner
- **WHEN** the pipeline owner previews a node whose dependency closure contains an enabled AI step
- **THEN** the model calls are issued and counted against the owner's daily quota

### Requirement: A preview that would issue an AI model call requires run-level authorization
Because a preview executes its target node's full dependency closure and any resulting model call is
charged to the pipeline OWNER, a preview that would issue a pipeline AI model call SHALL be
authorized by the same rule that governs triggering a run — the pipeline owner or an editor grantee
only. A viewer-level grantee SHALL be denied with a clear error and SHALL cause ZERO model calls, so
a read-only grantee cannot draw down the owner's daily budget.

#### Scenario: Viewer grantee cannot drain the owner's budget via preview
- **WHEN** a viewer-level grantee previews a node whose closure contains an enabled AI step
- **THEN** the request is denied with a clear error
- **AND** no model call is issued and the owner's daily count is unchanged

#### Scenario: Editor grantee preview is permitted and charged to the owner
- **WHEN** an editor grantee previews a node whose closure contains an enabled AI step
- **THEN** the model calls are issued and counted against the pipeline OWNER's quota

#### Scenario: Viewer preview of a pipeline without AI steps is unaffected
- **WHEN** a viewer-level grantee previews a node whose closure contains no enabled AI step
- **THEN** the preview proceeds exactly as before

### Requirement: A quota denial is a clear, named failure
A quota denial SHALL surface as a distinct, named failure carrying the configured limit and when it
resets — never as a silent no-op, an empty output column, a null value, or a skipped step. The
failing run SHALL fail as a whole, persisting a failure reason the caller can read, and SHALL NOT
write a partial output snapshot.

#### Scenario: Denial names the limit and the reset
- **WHEN** an AI step is denied for quota
- **THEN** the run's failure reason identifies the step, states the quota was exhausted, and
  includes the configured limit and its daily reset

#### Scenario: Denial is distinguishable from model-side failures
- **WHEN** an AI step is denied for quota
- **THEN** the failure is reported distinctly from an unavailable client, a model guardrail
  refusal, an API error, and a transport failure

#### Scenario: A quota-denied background backfill does not destroy existing output
- **WHEN** a background Output backfill would issue an AI model call for an owner who is over the
  daily limit
- **THEN** no model call is issued, the Output's previously materialized rows remain intact and are
  NOT replaced with an empty or partial row set, and the denial is recorded in the logs
- **AND** the denial does not fail the unrelated request that triggered the backfill

#### Scenario: Background backfill is attributed to the pipeline owner
- **WHEN** a background Output backfill executes a closure containing an enabled AI step for an
  owner who is under the daily limit
- **THEN** the model calls are issued and counted against the pipeline owner
- **AND** an `owner`-tier pipeline's backfill is never blocked by the cap

#### Scenario: No partial output is persisted
- **WHEN** a multi-row AI step is denied part-way through the row set
- **THEN** the run fails and no output snapshot is written for that run
- **AND** no further model calls are issued for the remaining rows
