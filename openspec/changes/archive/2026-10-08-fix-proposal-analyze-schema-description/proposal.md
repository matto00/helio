## Why

`schemas/pipelines/pipeline-analyze-proposal-response.schema.json` twice describes the response schema's
`$defs.AnalyzeStep` as stale (`op`/string-`config`). HEL-1266 corrected that def to `type` + object `config`, so the
contract file now documents a divergence that no longer exists, misleading any reader (human or agent) of the contract.

## What Changes

- Rewrite the stale sentence in the schema's top-level `description` (line 5).
- Rewrite the stale sentence in `$defs.AnalyzeProposalStep.description` (line 101) — not named by the ticket, same defect.
- Both new texts state the two step defs now share the `type` + object-`config` shape, and why the proposal schema keeps
  a local copy instead of a cross-file `$ref` (ticket AC 2: considered, declined — see design.md D1).
- No change to any schema keyword (`type`, `required`, `properties`, ...). Annotation text only.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — `description` is a non-validating annotation; no wire or validation behavior changes. `skip_specs: true`.)

## Non-goals

- Replacing `AnalyzeProposalStep` with a `$ref` (declined, design.md D1).
- De-duplicating `RootSourceSchema`/`SchemaField`/`AnalyzeWarning`, also copied between the two schemas.
- A drift guard keeping the two step defs aligned.

## Impact

One file: `schemas/pipelines/pipeline-analyze-proposal-response.schema.json` (two `description` strings).
No Scala, TypeScript, helio-mcp, or migration change. `check:schemas` unaffected: it never reads `description` values from schema files.
