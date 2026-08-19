# HEL-755: Proposal-apply with an unreachable REST source returns a raw 502 instead of failing safely

## Description

Live incident 2026-08-19: applying a `CombinedProposal`/`PipelineProposal` whose nested REST data source pointed at a hostname that doesn't resolve (`lm-api-reads.espn.com` — confirmed genuinely non-existent in DNS from multiple vantage points, not a Helio infra issue) returned a bare `502` from `POST /api/proposals/apply`, surfacing to the user as a confusing browser error with no actionable message.

## Root cause — confirmed parts

`RestApiConnector.doFetch`/`testConnection` (`backend/src/main/scala/com/helio/domain/RestApiConnector.scala:100-105,125-130`) is already `Either`-safe — it `.recover`s the failure into `Left("Request failed")` and logs it (`log.error("REST source request failed", e)`, the exact line seen in prod logs). The create-time apply chain traced from there — `CombinedProposalService.apply` (`CombinedProposalService.scala:76-101`) → `PipelineProposalService.apply` → `CreateSourceEnvelope.build` (`CreateSourceEnvelope.scala:38-64`) — is *also* already safe: on `Left(err)` it returns `Future.successful(CreateSourceResponse(..., fetchError = Some(err)))`, no throw.

**The actual unsafe path was not found within this scope.** Two candidates not yet traced:

1. What `CombinedProposalService`/`PipelineProposalService` does with a `CreateSourceResponse` that has `fetchError` set — does something downstream throw/abort on seeing it, rather than proceeding to create the pipeline anyway?
2. A pipeline's first **run** (not creation) also calls `RestApiConnector.fetch` — this path was not traced at all. If the connection failure happens during an eagerly-triggered first run rather than during creation, the raw exception may originate there.

Also reconfirmed: no `ExceptionHandler`/`RejectionHandler` is registered anywhere in the backend (`grep -rln "ExceptionHandler\|handleExceptions\|Route.seal\|RejectionHandler"` → no hits) — the same known gap as HEL-750, so *any* unsafe path anywhere in the request lifecycle surfaces exactly this way (raw 502/connection-drop instead of a typed JSON error).

## Fix, two parts

1. **Root-cause and fix the actual unsafe path** — trace both candidates above, find where the raw exception/hang originates, and make it safe.
2. **"Fail safely, not silently"** — per explicit product direction: when a proposal's source can't be reached, the apply should still succeed at creating what it safely can (the source, the pipeline), leaving the source visibly in a misconfigured/needs-attention state (the `CreateSourceEnvelope` layer already computes exactly this via `fetchError` — the question is whether anything downstream actually preserves and surfaces it, or discards/aborts on it). The user should land on a real pipeline they can go fix the source URL for, not a dead end with nothing created and an opaque error.

An existing, complete, already-built connection-test capability (`Connector[Config].testConnection` → `ConnectionTest.run`, `Connector.scala:96`/`ConnectionTest.scala:22-26`, already wired for `SourceService.testRest`/`testSql`, `SourceService.scala:115-126`) is **not currently called anywhere in the proposal-apply path** — consider using it to validate the source *before* attempting real fetch/schema-inference during apply, catching the failure earlier and more cleanly than deep inside a REST fetch call.

Filed 2026-08-19 from a live incident, confirmed by browser console.

## Acceptance Criteria

- The actual unsafe path that produced the raw 502 (either the `CreateSourceResponse.fetchError` handling downstream of source creation, or the pipeline's eagerly-triggered first run hitting `RestApiConnector.fetch`) is root-caused and traced to a specific line/call.
- That unsafe path is fixed so an unreachable REST source during proposal-apply never produces a raw 502 / unhandled exception — it returns a typed, safe JSON response.
- Applying a proposal whose REST source is unreachable still creates what can safely be created (the source and the pipeline), with the source left in a visibly misconfigured/needs-attention state (surfacing `fetchError`), rather than aborting with nothing created.
- The user ends up able to navigate to a real pipeline/source they can fix the URL on, not a dead end.
- Regression coverage (backend test) exists for: apply with an unreachable REST source completes successfully (source + pipeline created, fetchError surfaced) rather than throwing/502ing.
