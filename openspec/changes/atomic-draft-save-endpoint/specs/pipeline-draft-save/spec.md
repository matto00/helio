## Purpose

Persist a whole client-side pipeline draft (steps, topology, order, Outputs) in one database transaction, refusing a
stale base, and optionally start a run through the unchanged HEL-505 guard.

## ADDED Requirements

### Requirement: Atomic declarative draft save
`POST /api/pipelines/:id/draft/save` SHALL accept `{baseFingerprint, steps[], outputs[], runAfterSave?,
confirmCascade?}` describing the final step tree and Outputs, and SHALL apply every create, update, delete (with its
cascade), re-parent, trunk reorder and Output create/update/delete in a single database transaction.

#### Scenario: Whole draft commits together
- **WHEN** an owner or editor saves a draft that creates, updates, deletes and reorders steps and edits an Output
- **THEN** the response is 200 and the stored definition equals the draft, with a new `fingerprint`

#### Scenario: Fault mid-chain leaves nothing
- **WHEN** a failure is injected after some writes of the chain and before commit
- **THEN** the stored definition and its fingerprint are byte-identical to before the request and no journal row exists

#### Scenario: Validation failure rolls back
- **WHEN** a step fails `rawConfigProblem`, a cross-owner secondary ref, the upsert target check, a lane cycle or a
  pipeline cycle
- **THEN** the response is 400 naming the step and nothing is written

### Requirement: Stale base is refused without an overwrite path
The save SHALL recompute the `pipeline` fingerprint inside its transaction, after taking the verified locks, and SHALL
return 409 with the `PATCH_SET_STALE` body (`stale[0].kind = "pipeline"`) and write nothing when it differs from
`baseFingerprint`. No request field SHALL bypass this check.

#### Scenario: Concurrent change makes the base stale
- **WHEN** another writer changes any fingerprinted state after the client read its fingerprint
- **THEN** the save returns 409 `PATCH_SET_STALE` and the other writer's change is intact

### Requirement: Pipeline read exposes the fingerprint
`GET /api/pipelines/:id` SHALL return `fingerprint`, computed by the same implementation the save and patch-set
preview use.

#### Scenario: Read-then-save round trip
- **WHEN** a client reads the pipeline and saves an unchanged definition with that fingerprint
- **THEN** the save succeeds

### Requirement: Cascade confirmation
A save that removes steps, Outputs, bound panels or targeting alert rules SHALL return 422 listing that impact unless
`confirmCascade` covers every item, with the impact computed under the save's locks.

#### Scenario: Unconfirmed cascade
- **WHEN** the draft drops a step whose Output has a bound panel and `confirmCascade` omits that panel
- **THEN** the response is 422 listing the panel and nothing is written

### Requirement: Access control
The save SHALL require owner or editor access (viewer 403, invisible 404), stamp created rows with the pipeline owner,
write one audit row and one journal row owned by the acting user.

#### Scenario: Editor saves a shared pipeline
- **WHEN** an editor grantee saves on a role without BYPASSRLS
- **THEN** created steps and Outputs are owned by the pipeline owner and the journal row is visible only to the editor

### Requirement: Run after save never rolls the save back
With `runAfterSave` set, the server SHALL commit the save first and then call `PipelineRunService.submit` unchanged;
a guard rejection SHALL return 200 with `run: {started: false, code: 429, retryAfterSeconds, reason}`.

#### Scenario: Rate-limited run after a save
- **WHEN** the owner's run rate limit is exhausted and a save requests `runAfterSave: "run"`
- **THEN** the response is 200, `run.started` is false with `retryAfterSeconds`, and the saved definition persists
