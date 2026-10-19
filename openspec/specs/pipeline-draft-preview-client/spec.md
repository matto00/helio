# pipeline-draft-preview-client Specification

## Purpose
A client for the draft-preview endpoint that paces requests under the endpoint's budget and reads its NDJSON stream.

## Requirements

### Requirement: The client reads the NDJSON stream incrementally
The client SHALL read the response body with a stream reader, split it into lines across chunk boundaries, validate each line
against the line contract and deliver it to the caller as it arrives. An invalid line or a non-200 response SHALL fail the
request with an error the caller receives.

#### Scenario: Line split across chunks
- **WHEN** one line arrives in two chunks
- **THEN** the caller receives it once, intact

### Requirement: The client is single-flight
Starting a new request SHALL abort the in-flight one with its `AbortController`; a superseded request's lines SHALL NOT reach
the caller.

#### Scenario: Superseded request
- **WHEN** a second draft is sent while the first is streaming
- **THEN** the first request's signal is aborted and only the second's lines are delivered

### Requirement: The client paces sends
The client SHALL send at the earlier of 350 ms after the last change or 600 ms after the first unsent change, never sooner
than 600 ms after its previous send, and SHALL always send the final state. Requests SHALL carry the session credentials and
the CSRF header. A request that would exceed any server cap SHALL NOT be sent and SHALL be reported as too large.

#### Scenario: Continuous drag
- **WHEN** a draft changes every 16 ms for 60 s
- **THEN** between 90 and 100 requests are sent during the drag, every gap is at least 600 ms, and the final state is sent

#### Scenario: Bursts shorter than the floor
- **WHEN** edits arrive in bursts separated by quiet gaps of about 360 ms for 60 s
- **THEN** every gap between sends is still at least 600 ms

#### Scenario: Rate limited
- **WHEN** a send gets `429` with `Retry-After`
- **THEN** no request is sent before `Retry-After` elapses and the latest state is sent after it
