## ADDED Requirements

### Requirement: Render after a successful real run
After a real (non-dry) run's `succeeded` event has been published, every `insight` Output of that pipeline whose
`refresh` is `on_run` (the default) SHALL be rendered asynchronously. The run's terminal write, its `succeeded` event
and the caller's result SHALL NOT wait on, or change because of, any render. A dry run, a draft preview, a failed run
and a run whose `succeeded` publish was skipped SHALL NOT trigger a render.

#### Scenario: Render failure leaves the run succeeded
- **WHEN** a real run succeeds and its insight render fails or never completes (timeout)
- **THEN** the run is `succeeded`, its `succeeded` event is published at the same point it is without insights, and a
  `failed` attempt row is recorded for the failure (or the timeout)

#### Scenario: Dry run never renders
- **WHEN** a dry run of a pipeline with an `on_run` insight completes
- **THEN** the fake model transport records zero sends

### Requirement: Render guards
Before any model call a render SHALL, in this order: skip as `skipped_unchanged` when its input digest equals the
newest `ok` render's digest; skip with no row when the Output already had a model call within the last hour
(automatic triggers only); charge the pipeline OWNER through the owner-keyed quota gate, recording `skipped_quota`
and making no model call when denied. The input digest SHALL cover the preset, prompt,
sentence and character caps, the effective model, the head's columns and cell values, each compare's current value and
delta (an absent baseline and a zero delta encode identically), and each window's point values with consecutive repeats
collapsed; it SHALL NOT include the serialized grounding pack or any timestamp or value derived from one. Every row written after a model send was attempted SHALL record the
requested model id; rows with no send SHALL leave it null. Each render SHALL be capped at about 8k input tokens and 4096 output
tokens and bounded by a timeout; a result arriving after its timeout SHALL write no row. Cost SHALL be recorded in
`cost_micros` and never enforced. An attempt's `created_at` SHALL be the instant its render began, before its inputs were
read. An outcome with no model send whose status equals the newest attempt's (for `failed`, only when that attempt also
has no model) SHALL NOT insert a new row; it SHALL instead update that attempt's `created_at`, `trigger`, `run_id` and
`input_digest`.

#### Scenario: Ten identical runs, one model call
- **WHEN** ten real runs with identical data succeed, through the real snapshot and history writes, for a pipeline
  with an `on_run` insight, the hourly throttle disabled by the test clock
- **THEN** the fake transport records exactly one send, and the Output has one `ok` row and one `skipped_unchanged`
  row created at the tenth run

#### Scenario: A failing model is throttled
- **WHEN** an automatic render's send fails and another run succeeds within the hour
- **THEN** the failed row records the requested model and the second run makes no send

#### Scenario: Free-tier owner makes zero sends
- **WHEN** a pipeline owned by a `free`-tier user runs and its insight renders by any trigger
- **THEN** the fake transport records zero sends and one `skipped_quota` row exists however many runs occur, with data
  changing between runs

#### Scenario: Run during an in-flight render is caught up
- **WHEN** a second real run (overlapping the first, or followed by a failed run) succeeds while the first run's render
  is in flight or throttled, and the hourly window then passes
- **THEN** the tick pass renders over the second run's data

### Requirement: Weighted, owner-charged quota
A render SHALL be charged to the pipeline owner, never to the user who triggered it. An `owner`-tier owner SHALL NOT be
counted. A `beta`-tier owner SHALL be charged the `ClaudeModelCatalog` weight of the model the render uses (defaults
Haiku 1, Sonnet 4, Opus 8, overridable by `HELIO_BETA_MODEL_WEIGHTS`) against the same daily counter chat uses, once
per render including its single validator retry. Pipeline AI steps SHALL keep weight 1.

#### Scenario: Beta render charged its model weight
- **WHEN** a beta-owned insight renders on Sonnet 5.5 with default weights
- **THEN** the owner's daily counter increases by 4, and by the overridden weight when `HELIO_BETA_MODEL_WEIGHTS`
  overrides Sonnet

### Requirement: Daily renders on the scheduler tick
`daily` insights SHALL render from an interval-gated pass started (not awaited) on the existing
`PipelineSchedulerService` tick, with no new timer, at most once per aligned 15-minute UTC bucket. The pass SHALL
render a `daily` insight once per UTC day, at or after 06:00 UTC, when its newest attempt is older than that day's
06:00 UTC. Across instances only one pass SHALL render at a time. A failure of the pass SHALL never fail the tick. The
same pass SHALL render an `on_run` insight whose pipeline succeeded after its newest attempt and whose last model call
is at least an hour old.

#### Scenario: Daily insight renders once after 06:00 UTC
- **WHEN** the tick runs at 05:59, 06:00 and 06:10 UTC with a `daily` insight last attempted yesterday
- **THEN** exactly one `daily` attempt is recorded, at the 06:00 tick

#### Scenario: Two instances render once
- **WHEN** two service instances on one database run the pass concurrently for one due `daily` insight
- **THEN** the fake transport records exactly one send

### Requirement: Manual refresh
`POST /api/outputs/:id/insight/refresh` SHALL start a render of an `insight` Output for the pipeline owner or an
`editor` grantee and respond `202 {outputId, started}` without waiting on the model (`started` false when a render of
that Output is already in flight); the result appears as `lastAttempt` on
`GET /api/outputs/:id/insight`. A `viewer` grantee SHALL get 403; a
stranger, an unknown id and a non-insight Output SHALL get the same 404. It SHALL bypass the hourly throttle but not
the digest skip or the quota gate. An optional body `{"trigger":"pin"}` SHALL record the attempt with trigger `pin`
(any other body value is 400; no body means `manual`), and SHALL be limited by its own rate-limit instance
(`INSIGHT_REFRESH_RATE_LIMIT_PER_WINDOW`, default 6 per `RATE_LIMIT_WINDOW_SECONDS`).

#### Scenario: Viewer refused
- **WHEN** a viewer grantee posts a refresh
- **THEN** the response is 403 and the fake transport records zero sends

### Requirement: Delivery seam
An accepted render SHALL publish one in-process `InsightRendered` event carrying the Output id, pipeline id and the
stored record id. `InsightRenderService.latestFor(outputId)` SHALL return the newest `ok` render without an ACL check,
for internal callers only.

#### Scenario: Event published only for ok
- **WHEN** one render is accepted and another is skipped or fails
- **THEN** exactly one `InsightRendered` event is observed, for the accepted render
