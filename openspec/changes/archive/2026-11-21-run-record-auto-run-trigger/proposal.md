## Why

The backend writes four run trigger sources (`TriggerSource` in `PipelineRunService.scala`: `manual`, `scheduled`,
`external`, `auto-run`), but the run-record contract (`schemas/pipelines/pipeline-run-record.schema.json`) and the web
client's `PipelineRunRecord.triggerSource` type list only three. Any `auto-run` record returned by
`GET /api/pipelines/:id/run-history` violates the published schema, and the home timeline mark (`TimelineMark.tsx`) keys its
label on `auto`, so an auto-run mark shows the raw text `auto-run`. No test holds the route's output to the schema.

## What Changes

- Add `auto-run` to the run-record `triggerSource` enum.
- Widen the web client's `triggerSource` type to the four values, as one exported `TriggerSource` union, and type the
  run-history label map exhaustively over it so a future value is a compile error, not a silent fallback.
- Home timeline marks label trigger sources through the shared `triggerSourceLabel` (an auto-run shows `Auto-run`,
  the wording the run-history modal already uses).
- A backend seam spec seeds one run per trigger source through the real repository, calls the real run-history
  route, validates every record against the schema file, and writes a shared fixture
  `shared-test-fixtures/pipeline-run/run-history-response.json`; the web-client contract test reads it.
- Drop `completedAt`/`rowCount`/`errorLog` from the schema's `required`: the route omits them when unset (no
  `NullOptions`), so today every succeeded or unfinished run already violates the schema. The web client normalises
  the omitted fields to `null` at its boundary.
- helio-mcp: no change; it types `triggerSource: string` and the three fields as optional, and no tool narrows them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pipeline-run-provenance`: the trigger-source set is four values (`auto-run` added by HEL-1093/V110), the run-history
  record schema admits all four, a seam test holds the real route to the schema, and the UI labels `auto-run`.

## Impact

`schemas/pipelines/pipeline-run-record.schema.json`, `frontend/src/features/pipelines/types/pipelineStep.ts`,
`frontend/src/features/pipelines/utils/triggerSourceLabel.ts`, `frontend/src/features/home/ui/TimelineMark.tsx`,
`frontend/src/features/pipelines/services/pipelineService.ts` (normalisation), a new backend route spec, a new shared
fixture, a new frontend contract test. No migration, no route or wire change.

## Non-goals

- Insight `trigger` (`on_run|daily|manual|pin`) and Output `refresh` enums: different concepts, unchanged.
- History/home-summary schemas type `triggerSource` as plain `string`; narrowing them is out of scope.
- No MCP redeploy (source only).
