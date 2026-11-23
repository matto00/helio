## Context

See proposal.md (Why). Current code (main e3d78e580):

- `RestApiConnectorDriver.issueAndParse` returns `Left(s"HTTP $code: $body")` with the full body. `inferSchemaForConnector`
  (HEL-1638) composes the dry-run request and issues it through `issueAndParse`, whose `guardedPoolSettings` runs
  `ContentSourceSupport.validateAndResolve(uri, resolveHost, isBlocked)` before any connection. `fetchOverride` (tests)
  replaces the fetch entirely; `ProposalDryRunRestSchemaSpec` uses the real driver but a widened `isBlocked`
  (admits `localhost`), so no existing spec asserts a refusal on the dry-run fetch.
- `SourceService.dryRunRestSchema` / `dryRunSqlSchema` wrap a failed fetch as `InlineDryRunSchema(Vector.empty,
  Some(err))`; `PipelineRootDryRun.rootSchema` maps it to `Root(schema, fetchError)`. The pipeline proposal path
  (`PipelineProposalService.dryRun`) and the patch-set pipeline-create resolver (`PatchSetPipelineResolvers`) both use it.
- `PipelineCreateDryRun.firstOutputProblem` quotes `fetchErrors(i)` verbatim in
  `roots[i]: could not read the source schema (<err>), so fieldMapping cannot be checked`; the assistant tool executor
  turns that `ServiceError` into the `is_error` tool_result.
- `PipelineProposalService.dryRun` folds every root's schema (charged fetch first) and only then calls
  `createDryRun.check` = `preflight` then `checkOutputs`. The patch-set resolver already calls `dryRun.preflight` before
  `rootSchemas()`.

## Goals / Non-Goals

Goals: AC1-AC4 of ticket.md. Non-goals: see proposal.md.

## Decisions

**D1 - Cap at the root dry run, 500 code points + marker.** One function, `PipelineRootDryRun.capFetchError`, applied in
`rootSchema`'s `inline` mapping (`Root(x.schema, x.fetchError.map(capFetchError))`). This is the single choke point both
the proposal path and the patch-set path read `fetchError` from, and it covers rest and sql alike.
Size precedent: `HomeSummaryLimits.ErrorLogMax = 500` (run error text shown to users) and `AssistantStopMessages.
MaxErrorChars = 200` (one error line in an assistant stop message). 500 is chosen: the quoted text here is the whole
diagnosis the agent repairs from (an HTTP status plus a JSON error body), so 200 would often cut the useful part, while
500 keeps the tool result small. Counting is by code point: pass through unchanged when `codePointCount <= 500` (guard first:
`offsetByCodePoints(0, 500)` throws when there are fewer than 500 code points even if `length > 500`), else cut at
`offsetByCodePoints(0, 500)`, so a surrogate pair is never split (HEL-1823 class of defect). Marker ` … [truncated]` so the agent knows the text was cut.
Alternatives: capping in `issueAndParse` (changes source preview, test-connection and run `error_log` text everywhere:
out of scope, broader behaviour change); capping in `PipelineCreateDryRun.firstOutputProblem` (misses any future reader
of `fetchError`, and the patch-set path would rely on the same site anyway).

**D2 - SSRF spec through the real driver against a live loopback server.** New spec
`ProposalDryRunEgressGuardSpec` (backend/src/test/scala/com/helio/services/pipelines/). It binds an in-test Pekko HTTP
server on `127.0.0.1:0` that counts requests, builds the `SourceService` with a real `RestApiConnectorDriver` using the
DEFAULT `isBlocked`/`resolveHost` and NO `fetchOverride`, and calls `PipelineProposalService.validate` with an inline REST
root `url = http://127.0.0.1:<port>/rows` plus an Output whose `fieldMapping` names a column on that root (so the fetch
failure surfaces in the rejection). Assert: `BadRequest` whose message quotes the guard's own refusal text (read from
`ContentSourceSupport.validateAndResolve` for the same URL in the test, not hard-coded), and the server's hit count is 0.
No outbound call is possible: the only target is loopback, and the guard refuses it. Mutation (recorded, then reverted):
in `inferSchemaForConnector`, issue the request with the shared unpinned pool (`Http().singleRequest(request)`) instead
of `issueAndParse`; the server then receives a request and the spec goes red. A second mutation, the same change in
`issueAndParse` deleting the `guardedPoolSettings` call, also goes red. A setup sanity case (an `isBlocked` that admits
the literal `127.0.0.1` host, like `RestConnectorEgressGuardSpec.admitLocalhost`) proves the server IS reachable when
admitted, so a zero hit count is not vacuous.

**D3 - Preflight before the charged fetch in the proposal path.** Restructure `PipelineProposalService.dryRun` to build
the `CreatePipelineRequest` first, call `createDryRun.preflight`, and only then fold the root schemas, then
`createDryRun.checkOutputs` (when preflight returned indices). Roots are still dry-run when preflight returns `None`
(no steps or Outputs) so inline create checks keep running. This matches the patch-set resolver's existing order (D1b of
HEL-1722). Consequence: when a proposal has both a root problem and a step problem, the step problem is reported first;
apply runs this same `dryRun` before any write, so propose/apply parity is unchanged. The Output column check cannot move
before the fetch (it needs the fetched schema); the doc comment states that, and also that with several inline roots
root 0's charged fetch still precedes root 1's schema-free inline create checks (serial fold; outside AC3).

**D4 - MCP description.** Replace the sentence "Read-only-checks ... never re-validated here)." in
`helio-mcp/src/tools/pipelineProposal.ts` with text stating propose runs apply's pre-write checks as a dry run (writing
nothing; SQL read-only and create checks included; one live schema fetch per inline rest/sql root, charged to the
source-fetch rate limit, 429 when exhausted), returning `{ proposal, warnings, applyReady }`. A helio-mcp test asserts the
registered description no longer contains "never re-validated here" and mentions the live fetch. Source only; no deploy.

## Risks / Trade-offs

- [Existing specs assert an error order root-before-step] -> run `ProposalDryRunParitySpec`,
  `PipelineProposalServiceValidateSpec`, `ProposalDryRunRestSchemaSpec`, `CombinedProposalServiceValidateSpec` in full;
  a changed expectation is only acceptable if apply's order changed identically (it does, same function).
- [Guard text changes later] -> the spec reads the refusal text from the guard itself.
- [Pekko server in a spec] -> follow `RestConnectorEgressGuardSpec`'s binding/unbind pattern (`afterAll`).

## Migration Plan

None (no schema, no API shape). helio-mcp needs a redeploy at release to publish the new description.

## Planner Notes

- Self-approved: cap size 500 (existing precedent, not a product question); cap applies to sql too (same field).
- Premise check: `validateRestCreate` has no URL egress check, so a loopback URL reaches the fetch-time guard; the D2
  mutation proof is what confirms this empirically.
