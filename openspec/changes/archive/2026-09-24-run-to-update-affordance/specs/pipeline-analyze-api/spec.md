## MODIFIED Requirements

### Requirement: Analyze response carries a deny-by-default cost verdict
`GET /api/pipelines/:id/analyze` (non-concise) SHALL include a `costVerdict` object with `autoRunnable`, optional
`estimatedRows`, `stepCount` (enabled steps), `reasons`, and `canRun`. `autoRunnable` SHALL be true if and only if
`reasons` is empty. `canRun` SHALL be true if and only if the requesting user is the pipeline's owner or holds an
editor grant on it — the same check `POST /api/pipelines/:id/run` enforces — regardless of `autoRunnable`. The
verdict SHALL deny with a distinct reason code for: an enabled AI step (`analyzewithai`, `generatetext`) as
`ai-step`; a `rest_api`/`sql` root or a URL-backed root as `remote-fetch`; an estimate above the row threshold as
`rows-above-threshold`; an enabled step count above the bound as `steps-above-bound`; a write-back step as
`writeback-step`; an enabled content-conversion step (`convertformat`) as `content-conversion`. Anything the estimator
cannot classify SHALL be denied: an op outside the cheap allowlist (`unclassified-op`), an unresolvable or unknown root
source (`unclassified-source`), no available row estimate (`row-estimate-unavailable`), or no roots (`no-roots`).

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
- **WHEN** the pipeline owner requests `/analyze` for their own pipeline, and `autoRunnable` is
  false
- **THEN** `costVerdict.canRun` is true

#### Scenario: A viewer grantee cannot run a denied pipeline
- **WHEN** a user holding only a viewer grant requests `/analyze` for a pipeline they don't own,
  and `autoRunnable` is false
- **THEN** `costVerdict.canRun` is false
