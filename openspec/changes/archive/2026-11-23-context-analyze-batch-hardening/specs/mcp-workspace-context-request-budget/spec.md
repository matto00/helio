## MODIFIED Requirements

### Requirement: Fallback to per-pipeline analyze
If `GET /api/pipelines/context-analyze` fails (404 on an older server, any other error, or a body without an `items`
array) the call SHALL fetch each pipeline's analyze exactly as before. A pipeline absent from the batched response
SHALL be analyzed per pipeline. A batch item whose `steps` is not an array SHALL be treated as absent from the batched
response: that pipeline SHALL be analyzed per pipeline, never reported as a `stepsError` caused by the batch item. A
failure other than 404, a malformed body, or absent pipelines SHALL write one stderr line naming the read. The payload
SHALL be identical on every path.

#### Scenario: Older server
- **WHEN** the analyze batch returns 404
- **THEN** the call succeeds with the golden payload, writes no stderr line, and sends one analyze per pipeline

#### Scenario: One pipeline absent
- **WHEN** the analyze batch omits one pipeline
- **THEN** exactly that pipeline is analyzed per pipeline and the payload equals the golden

#### Scenario: An item without a steps array
- **WHEN** the analyze batch returns an item for a pipeline but that item has no `steps` array
- **THEN** exactly that pipeline is analyzed per pipeline, it carries no `stepsError` it would not carry per pipeline,
  one stderr line names the read, and the payload equals the golden
