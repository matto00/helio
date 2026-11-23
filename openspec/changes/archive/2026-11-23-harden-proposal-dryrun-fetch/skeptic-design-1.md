## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD e3d78e580a90886e082cbc0f8085b8e20c508014 (main tip; the change dir is the only untracked content).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/proposal-dryrun-fetch-hardening/HEL-1727`.

### What I verified (with evidence)

**D1: cap site covers every path from fetch failure to rejection and tool result.**
- Every propose-time fetch failure becomes a `Root.fetchError` at one line:
  `PipelineRootDryRun.scala:31` `r.map(x => Root(x.schema, x.fetchError))`. Its sources are
  `SourceService.dryRunRestSchema` (:233 "Connector not found", :237 `Some(err)` from `inferSchemaForConnector`) and
  `dryRunSqlSchema` (:252). Both reach Root only through `inline` at :31, so capping there covers rest and sql.
- Readers of `Root.fetchError`: `PipelineProposalService.scala:129` (proposal path) and
  `PatchSetPipelineResolvers.scala:168` (patch-set path). Both pass the value only to
  `PipelineCreateDryRun.firstOutputProblem` (:77), which quotes it in the BadRequest. Repo-wide grep for `fetchError`
  found no other reader of the dry-run value.
- The other `fetchError` site, `PipelineProposalService.scala:598-601` (apply's unrunnable-run reason), comes from
  `CreateSourceResponse` on apply, not from the dry run. proposal.md lists it as a non-goal.
- Tool result: `AssistantToolExecutor.scala:282-285` `Left(err.message)`. That is the validation message verbatim, so
  capping upstream bounds it. `propose_combined` goes through `CombinedProposalService.scala:64` →
  `pipelineProposalService.validate`, so the same cap applies. The MCP tool calls the same route
  (`helioApi.ts:1065` → `PipelineProposalRoutes.scala:38` → `validate`).
- `issueAndParse` (RestApiConnectorDriver.scala:367) yields `Left(s"HTTP $code: $body")` with the full body. That
  confirms premise 1 of the ticket.

**D2: the SSRF spec would really go red; nothing refuses loopback before the fetch.**
- `validate` runs `validateStructure`, then `validateAllSourceReferences` (only acts on `sourceId`), then `dryRun`.
- `validateRestCreate` (SourceService.scala:119-170) checks type, auth, connectorId/url exclusivity and
  `rejectBodyOnSafeMethod`. It does no egress check.
- `ImplicitConnectorConfig.forLegacySource` marks `baseUrl` as `@annotation.unused`, so no URL check happens there.
- Repo-wide grep for `checkEgress|validateAndResolve|validateUrl|isBlockedAddress`: the only egress-checking caller off
  the fetch path is `ConnectorEntityService.scala:183`, which the dry run never calls. It builds the Auto connector
  unpersisted (SourceService.scala:224-226). `PipelineProposalAnalyze`'s egress use belongs to the separate analyze
  route.
- So a loopback URL reaches `inferSchemaForConnector` → `issueAndParse` → `guardedPoolSettings` (:339-342) →
  `validateAndResolve`. The planned mutation (an unguarded `Http().singleRequest`) would deliver a request to the
  in-test server, and both the zero-hit and BadRequest assertions would fail. The admitted-host sanity case removes the
  remaining vacuity risk.
- The guard message is `URL host '<host>' resolves to a disallowed address` (ContentSourceSupport.scala:223). It is
  keyed on the host, so reading it from `validateAndResolve` in the test is stable even though URL composition may
  rewrite the path.
- Literal `127.0.0.1` resolves without DNS, so the spec makes no outbound call.

**D3: the reorder preserves propose/apply parity and the inline create checks.**
- `apply` (PipelineProposalService.scala:190-205) runs the same private `dryRun` (with `chargeFetches = false`) before
  `resolveAllRoots`. Reordering inside `dryRun` changes both sides identically.
- `PipelineCreatePreflight.run` (:31-38) needs only the request: root indices, lane checks, `checkSteps`,
  `checkOutputs`. `validateCrossOwnerRefs` is a DB ownership read and needs no schema. Neither depends on root schemas,
  and the placeholder roots (`sourceId = "dry-run"`) are built today before `check` anyway.
- When preflight returns `None`, the design still dry-runs the roots, so inline static/sql/rest create checks keep
  running. When preflight returns `Some`, the roots are dry-run before `checkOutputs`, unchanged.
- The patch-set resolver's existing order is preflight then `rootSchemas()` (PatchSetPipelineResolvers.scala:156-168).
  The claim holds.

**D4: the MCP description claims are true.**
- The stale sentence is real (pipelineProposal.ts:146-148): "non-SELECT is rejected at apply time, never re-validated
  here".
- `proposePipelineHandler` really calls `api.validatePipelineProposal` (pipelineProposalHandlers.ts:55) →
  `POST /api/pipelines/validate-proposal`. That runs `dryRun` with `chargeFetches = true`. The budget refusal is
  `ServiceError.TooManyRequests` (SourceFetchBudget.scala:20). SQL read-only checks run in the dry run through
  `validateSqlCreate` → `SqlConnectorDriver.checkQuery` (SourceService.scala:85). So the new text and its test are
  accurate.

**Other checks.**
- AC coverage: AC1 → D1 plus tasks 1.2 and 1.3. AC2 → D2 plus task 1.1 and the mutations in 3.2. AC3 → D3 plus task
  1.4. AC4 → D4 plus task 1.5.
- Driver constraints: loopback, real guard, no outbound call, no deploy, no migration and fake transport are all
  respected.
- Every cited spec exists. So do both precedents: `HomeSummaryLimits.ErrorLogMax = 500` (HomeSummaryModel.scala:17)
  and `AssistantStopMessages.MaxErrorChars = 200`.
- No TODO or TBD markers. The tasks have red/green acceptance signals.

### Verdict: CONFIRM

### Non-blocking notes
1. **`offsetByCodePoints` pitfall (HEL-1823 class).** `s.offsetByCodePoints(0, 500)` throws
   `IndexOutOfBoundsException` when `s` has fewer than 500 code points. That can happen while `s.length > 500` in UTF-16
   units, for example 400 emoji = 800 chars. Guard the cut with `s.codePointCount(0, s.length) <= 500` (pass through
   unchanged). Add a task 1.2 case for "≤500 code points but >500 UTF-16 units → unchanged". The spec already requires
   this ("at or under the cap SHALL pass through unchanged" counted in code points), but no planned test exercises it.
2. **Inaccurate design claim.** design.md Context says "every HEL-1638 dry-run spec bypasses the guard by construction"
   via `fetchOverride`. This is inaccurate: `ProposalDryRunRestSchemaSpec` uses the real driver with no
   `fetchOverride`. It does run with a widened `isBlocked` (admitLocalhost), so the rationale stands, since no spec
   asserts a refusal. Reword if convenient.
3. **Scope gap worth a follow-up ticket.** The assistant must call `test_connection` on the exact inline config before
   `propose_pipeline` (`requireVerifiedInlineRoot`, AssistantToolExecutor.scala:230-248). `testRest` → `issueTest`
   returns the same uncapped `HTTP $code: $body`, and that reaches the model's context in the `test_connection` tool
   result. D1's Alternatives explicitly put test-connection out of scope, which is defensible against the ticket's
   literal AC. However, the ticket's motivating hazard (a hostile body blowing up the model's context) stays open
   through that sibling tool. Recommend a spinoff and a one-line mention in proposal.md Non-goals.
4. **Charged fetch before a later root's checks.** With several inline roots, root 0's charged fetch still runs before
   root 1's schema-free inline create checks (the serial fold). This is outside AC3, which names step checks. Mention it
   in the doc comment, or leave it.
