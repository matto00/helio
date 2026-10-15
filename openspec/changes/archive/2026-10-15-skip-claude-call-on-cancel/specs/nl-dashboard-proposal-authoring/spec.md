## ADDED Requirements

### Requirement: A streaming request cancelled before the model call makes no model call
For `POST /api/authoring/dashboard?stream=true` (first turn and continued turn), the system SHALL NOT start the model
call (`ClaudeClient.stream`) when the response stream has been cancelled (client disconnected or stopped reading)
before grounding or conversation loading completed. A response stream that is read SHALL start exactly one model call
(plus at most one repair call) and end with the same terminal result or error event as before. The request's tier,
rate and daily-usage gate SHALL run, and charge the daily counter, at admission exactly as before (before the response
starts), independent of whether the stream is later read; the billed model call happens only on a live stream.

#### Scenario: A client that cancels before grounding completes causes no model call
- **WHEN** a streaming authoring request is admitted and its response stream is cancelled while grounding is still
  in progress, and grounding then completes
- **THEN** the Claude transport records zero calls for that request

#### Scenario: A client that reads the stream still gets the result
- **WHEN** a streaming authoring request is admitted and its response stream is read to completion
- **THEN** the Claude transport records exactly one streaming call and the stream ends with the terminal result event

#### Scenario: The daily counter is charged at admission, unchanged
- **WHEN** a beta-tier user's streaming authoring request is admitted
- **THEN** the shared daily usage counter is incremented before the response starts, whether or not the stream is read
