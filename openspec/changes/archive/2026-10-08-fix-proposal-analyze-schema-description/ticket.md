# HEL-1281: Proposal analyze schema description still calls the response schema's AnalyzeStep stale

## Description

origin_kind: followup
origin_ticket: HEL-1266

Reported by the HEL-1266 lane and not verified by the driver.

HEL-1266 corrected the stale `AnalyzeStep` definition in `schemas/.../pipeline-analyze-response.schema.json` (`op` and
string `config` became `type` and object `config`). The proposal analyze schema's description still says the response
schema's `AnalyzeStep` is stale, which is no longer true.

## Acceptance Criteria

- Fix the description.
- Consider whether the proposal schema should now `$ref` the corrected definition instead of duplicating it.
- `check:schemas` stays green.
