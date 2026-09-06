## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Derived cold from the worktree, not from the orchestrator's summary. Every claim below
was re-measured; the round-1 fixes rest on two negative claims, both of which I
re-established independently.

### What I verified (with evidence)

**CR1 — picker is create-only (Decision 5 / task 4.3).** Confirmed.
`grep -rn ConnectorSelectField frontend/src` → the only mount is `RestApiForm.tsx:56`;
`RestApiForm` is rendered only at `AddSourceModal.tsx:499`. `AddSourceModal` has three
mount sites (`SourcesPage.tsx:154`, `AddRootModal.tsx:121`, `CreatePipelineModal.tsx:226`)
— all create flows; `ls frontend/src/features/sources/ui/` shows no edit-source modal
(`SourceDetailPanel`/`SourceDetailPage` are detail surfaces). `useRestSourceForm.ts:71`
is `useState<Connector | null>(null)` with no hydration; the only other use is
`:126 ...(connector ? { connectorId: connector.id } : {})`. Independent corroboration of
the "would not even work anyway" aside: `Select.tsx:46` really is
`options.find((o) => o.value === value) ?? null`. The deletion of the affordance is correct.

**CR2 — no OpenAPI / no REST-create schema (Decision 7 / task 5.1).** Confirmed.
`find . -iname '*openapi*' -o -iname 'swagger*'` (node_modules pruned) → zero hits.
`ls schemas/sources/` → exactly `field-override-payload.schema.json` and
`static-column-payload.schema.json`. `grep -rl connectorId schemas/` → exactly one file,
`schemas/pipelines/create-pipeline-request.schema.json`, in the HEL-973-owned directory.
Both negative claims hold; "no `schemas/` edit, the OpenSpec delta is the contract record"
is the right call and proposal.md's Impact bullet now matches.

**CR3 — no-decrypt assertion built to fail (tasks 3.3 / 3.3a).** The named mutation is
genuinely feasible: in `RestApiConnectorDriver.scala`, `credRepo.decryptForUse` is at
line 118 and `Uri(joinUrl(connector.baseUrl, resolvedEndpoint))` at line 143 — strictly
ordered, so a guard moved between them fails no-decrypt while leaving no-request green.
The vacuity hazard the task cites is real (`credentialRepoOpt match { case None => ... }`
at :115). Recording-repo requirement + zero-call-count assertion is the right shape.

**Decision 4 fixture measurement.** Re-measured, not trusted: `grep -rn "new SourceService("
backend/src/test/scala` → 12 sites across exactly **7** files, matching the design's count.
The two named as exercising `connectorId` (`SourceServiceSpec`, `RestConnectorEgressGuardSpec`)
each have 2 `connectorId` hits; the two named as passing no repo
(`PipelineRootRoutesSpec.scala:124,140` — literally `connector = null`,
`PipelineAnalyzeProposalRoutesSpec.scala:146`) have **zero** `connectorId` hits. The three
files the design leaves unnamed (`AuditMutationInstrumentationSpec`,
`SourceServiceBareUrlParametersSpec`, `SourceServiceBareUrlQueryParamsSpec`) all pass an
explicit `connectorRepo = connectorRepo` and have zero `connectorId` hits. Fail-closed is
safe and costs no fixture rewrite, exactly as claimed.

**Decision 2a insertion point.** `SourceService.createRest` confirmed: the
`(Some(_), None)` branch runs `RestApiConfigPayload.toDomain`, then
`RestApiConfig.rejectBodyOnSafeMethod`, then `createRestWithConfig`. The specified
"after `rejectBodyOnSafeMethod`, before `createRestWithConfig`" slot exists literally.
`DataSourceKind.RestApi = "rest_api"` at `DataSource.scala:187`, as cited.

**Decision 3 (no update path).** `UpdateDataSourceRequest(name: Option[String])` confirmed
in `api/protocols/sources/DataSourceProtocol.scala`; `DataSourceRoutes.scala:103` is its
only consumer. The "do not write an update test" instruction is correct.

**Spec deltas.** `## MODIFIED Requirements` header "Connector selection in the REST source
form" matches `openspec/specs/sources/rest-source-authoring/spec.md:10` verbatim; both
`## ADDED` requirement names are absent from `openspec/specs/rest-api-connector/spec.md`
(17 existing requirements checked). Delta headers are hygiene-valid.

**Coverage / scope.** All five ACs trace to tasks: AC1→4.1+6.3, AC2→2.1 (rejected, with the
`400` recorded in the spec delta), AC3→4.2+6.3, AC4→1.1–1.3, AC5→Decision 2b/§3 (correctly
reassigned away from the deleted picker affordance). No task exceeds the ticket; no `?kind=`
parameter, no migration, no `schemas/pipelines/` touch, HEL-890/HEL-973 files untouched.
No `TODO`/`TBD`/deferred decision remains in any artifact.

### Verdict: CONFIRM

The three round-1 change requests are genuinely closed, not narratively closed. The core
shape (server-side guarantee at two checkpoints, UI as affordance, no update-path check, no
migration) survives adversarial re-reading and is not re-litigated here.

### Non-blocking notes

1. `specs/sources/rest-source-authoring/spec.md` says the enforcement boundary "is the
   server-side check on the create/**update** path", while the sibling
   `specs/rest-api-connector/spec.md` delta and Decision 3 state explicitly that no update
   path exists. Both cannot be right in the durable spec text. Drop "/update" — one word,
   in the affordance sentence only, so it constrains no behavior.
2. §3.2 asks for the fetch-time guard to be shown on "fetch, preview, refresh, and infer",
   but `resolveConnector` is a single seam and the ephemeral bare-url path
   (`RestApiConnectorDriver.scala:443`) never resolves a Connector at all. If infer/test-
   connection on the ephemeral shape turns out not to route through `resolveConnector`, that
   is expected — record it rather than manufacturing a fourth call site.
3. Decision 2b's curated `Left` is an `Either[String, Connector]`, so task 3.5's
   "leaks no id/baseUrl/credential" is checkable directly on the string — worth asserting
   the absence of the Connector id substring, not just eyeballing the message.
