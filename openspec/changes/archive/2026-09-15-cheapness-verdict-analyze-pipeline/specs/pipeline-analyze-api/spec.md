## ADDED Requirements

### Requirement: Analyze response carries a deny-by-default cost verdict
`GET /api/pipelines/:id/analyze` (non-concise) SHALL include a `costVerdict` object with `autoRunnable`, optional
`estimatedRows`, `stepCount` (enabled steps) and `reasons`. `autoRunnable` SHALL be true if and only if `reasons` is
empty. The verdict SHALL deny with a distinct reason code for: an enabled AI step (`analyzewithai`, `generatetext`) as
`ai-step`; a `rest_api`/`sql` root or a URL-backed root as `remote-fetch`; an estimate above the row threshold as
`rows-above-threshold`; an enabled step count above the bound as `steps-above-bound`; a write-back step as
`writeback-step`. Anything the estimator cannot classify SHALL be denied: an op outside the cheap allowlist
(`unclassified-op`), an unresolvable or unknown root source (`unclassified-source`), no available row estimate
(`row-estimate-unavailable`), or no roots (`no-roots`).

#### Scenario: Pipeline with an AI step is denied
- **WHEN** a pipeline has an enabled `analyzewithai` step over a small dataset root
- **THEN** `costVerdict.autoRunnable` is false and `reasons` contains a reason with code `ai-step` naming that step

#### Scenario: Small local pipeline is allowed
- **WHEN** a pipeline has one dataset root with a known row count below the threshold and only allowlisted enabled steps
- **THEN** `costVerdict.autoRunnable` is true and `reasons` is empty

#### Scenario: Unclassifiable op is denied
- **WHEN** a pipeline has an enabled step whose op is not in the cheap allowlist and not a named deny op (e.g. `convertformat`)
- **THEN** `costVerdict.autoRunnable` is false with reason code `unclassified-op`

#### Scenario: Remote source is denied
- **WHEN** a pipeline root is a `rest_api` source
- **THEN** `costVerdict.autoRunnable` is false with reason code `remote-fetch`
