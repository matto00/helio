## MODIFIED Requirements

### Requirement: Analyze response carries a deny-by-default cost verdict
`GET /api/pipelines/:id/analyze` (non-concise) SHALL include a `costVerdict` object with `autoRunnable`, optional
`estimatedRows`, `stepCount` (enabled steps), `reasons`, and `canRun`. `autoRunnable` SHALL be true if and only if
`reasons` is empty. `canRun` SHALL be true if and only if BOTH the requesting user is the pipeline's owner or holds an
editor grant on it — the same check `POST /api/pipelines/:id/run` enforces — AND no enabled step in the response's
`steps` carries a `validationError`; this holds regardless of `autoRunnable`. Every enabled step whose
`validationError` is present SHALL contribute exactly one reason with code `step-config-invalid`, `stepId` set to
that step's id, and `detail` equal to that step's `validationError` text. The verdict SHALL deny with a distinct
reason code for: an enabled AI step (`analyzewithai`, `generatetext`) as `ai-step`; a `rest_api`/`sql` root or a
URL-backed root as `remote-fetch`; an estimate above the row threshold as `rows-above-threshold`; an enabled step
count above the bound as `steps-above-bound`; a write-back step as `writeback-step`; an enabled content-conversion
step (`convertformat`) as `content-conversion`; an enabled step with a configuration `validationError` as
`step-config-invalid`. Anything the estimator cannot classify SHALL be denied: an op outside the cheap allowlist
(`unclassified-op`), an unresolvable or unknown root source (`unclassified-source`), no available row estimate
(`row-estimate-unavailable`), or no roots (`no-roots`). A disabled step SHALL never contribute a
`step-config-invalid` reason nor affect `canRun`.

#### Scenario: Pipeline with an AI step is denied
- **WHEN** a pipeline has an enabled `analyzewithai` step over a small dataset root
- **THEN** `costVerdict.autoRunnable` is false and `reasons` contains a reason with code `ai-step` naming that step

#### Scenario: Small local pipeline is allowed
- **WHEN** a pipeline has one dataset root with a known row count below the threshold and only allowlisted enabled steps
- **THEN** `costVerdict.autoRunnable` is true and `reasons` is empty

#### Scenario: Unclassifiable op is denied
- **WHEN** a pipeline has an enabled step whose op is not in the cheap allowlist and not a named deny op
- **THEN** `costVerdict.autoRunnable` is false with reason code `unclassified-op`

#### Scenario: Content-conversion step is denied
- **WHEN** a pipeline has an enabled `convertformat` step over a small dataset root
- **THEN** `costVerdict.autoRunnable` is false and `reasons` contains a reason with code `content-conversion` naming that step

#### Scenario: Remote source is denied
- **WHEN** a pipeline root is a `rest_api` source
- **THEN** `costVerdict.autoRunnable` is false with reason code `remote-fetch`

#### Scenario: The owner viewing their own denied pipeline can run it
- **WHEN** the pipeline owner requests `/analyze` for their own pipeline, `autoRunnable` is false, and no enabled
  step has a `validationError`
- **THEN** `costVerdict.canRun` is true

#### Scenario: A viewer grantee cannot run a denied pipeline
- **WHEN** a user holding only a viewer grant requests `/analyze` for a pipeline they don't own,
  and `autoRunnable` is false
- **THEN** `costVerdict.canRun` is false

#### Scenario: A step configuration error blocks the run and names the step
- **WHEN** the pipeline owner requests `/analyze` and an enabled step's `validationError` is present
- **THEN** `costVerdict.canRun` is false, `costVerdict.autoRunnable` is false, and `reasons` contains a reason with
  code `step-config-invalid`, `stepId` equal to that step's id, and `detail` equal to that step's `validationError`

#### Scenario: Every misconfigured step is named
- **WHEN** two enabled steps each carry a `validationError`
- **THEN** `reasons` contains one `step-config-invalid` reason per such step, each naming its own step

#### Scenario: A disabled misconfigured step does not block the run
- **WHEN** the only step whose configuration is invalid is disabled, and the owner requests `/analyze`
- **THEN** `reasons` contains no `step-config-invalid` reason and that step does not by itself make `canRun` false
