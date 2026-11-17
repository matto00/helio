## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD fd7064f7d700e49a2f7dfc1f6a244aab02048fd2. The planning artifacts are untracked and there are no source
changes yet. B = backend/src/main/scala/com/helio.

### What I verified (with evidence)

Round-1 change requests, checked against the code:

- **CR2 (shared node-schema derivation): resolved.** `createTransactional` (PipelineCreateTransaction.scala:47-78) builds
  `NodeStepInput` without `enabled`. Analyze defaults it to `true` (PipelineAnalyzeService.scala:194) and treats a
  disabled step as pass-through (l.320). `CreatePipelineTransactionalStepRequest.enabled: Option[Boolean]` exists
  (PipelineProtocol.scala:37), and the step insert already persists `spec.enabled.getOrElse(true)` (PCT:204). D1.7
  extracts `outputNodeSchemas`, which both paths call, and fixes `enabled`. That matches the existing
  `pipeline-step-lifecycle` spec ("disabled steps excluded from every execution and analysis surface"), so it is a fix
  toward an existing contract and not a new contract. The disabled-step entry is in the corpus, and the mutation proof is
  specified. OK.
- **CR3 (fetch-failure acceptance): resolved.** Apply keeps a fetch-failed source with no inferred schema
  (`handleInlineCreated`, `CreateSourceEnvelope.build` Left branch). It still creates the pipeline, so `buildOutputsAction`
  checks against the empty schema, and `finishPipeline` records an unrunnable run (PPS ~l.505-525). The revised rule is
  "empty schema, run step 7 unchanged, only the message differs". It reproduces this exactly, and both corpus entries are
  required. The spec scenarios are updated. OK.
- **CR5 (spec exclusions): resolved.** The spec Requirement now lists the run, the inventory's apply-only rows and the
  deferred patch-set edits.
- **CR6 (sentinel panels): resolved.** D3 defines `Real`/`Sentinel(proposedOutput)`, skips `rejectMissingOutput` for the
  sentinel, and makes the controls rule conditional on task 0.2.
- **CR4 (patch-set pipeline create): included in D1b, but D1b rests on a false premise.** See CR-A below.
- **CR1 (rest root schema parity): half resolved.** The config build is now shared, but the request composition and
  inference are left open in a way that cannot achieve parity. See CR-B below.

New or remaining defects I found in the code:

- **Patch-set pipeline create roots can be inline.** D1b says "its roots are `sourceId` roots, so step 3 is
  `ds.inferredSchema`". That is false. `CreatePipelineRootRequest` (PipelineProtocol.scala:64-72) carries
  `type`/`sqlConfig`/`restConfig`/`staticConfig`. `resolvePipelineCreate` (PatchSetPipelineResolvers.scala:~125-133)
  skips inline roots explicitly ("an inline root ... apply-time `pipelineService.create` re-validates it, inline branch
  included"). The patch-set apply path is `PipelineService.create` -> `PipelineRootWrites.resolveOneRootSourceId`'s
  inline branch (PipelineRootWrites.scala:49-101), not `PipelineProposalService.resolveSource`. It has its own messages,
  for example "inline csv sources are not supported for pipeline roots; ...", which differs from PPS's "...not supported
  by apply-proposal yet...", and "roots: name is required for an inline source". As written, D1b has no schema for an
  inline root. An executor would either crash or use an empty schema. An empty schema would reject at preview every
  Output mapping a column of an inline rest/sql/static root, although apply succeeds. That breaks the spec's "Patch-set
  pipeline create ... as apply would" in the over-reject direction.
- **REST inference parity is still open.** Apply infers through `connector.inferSchema(restConfig, Owned(user))`, using
  the persisted Auto connector (`CreateSourceEnvelope.build`, CreateSourceEnvelope.scala:~45). That goes through
  `buildResolvedRequest` (RestApiConnectorDriver.scala:123-200): `joinUrl(baseUrl, endpoint)`, an ordered query merge,
  and `TemplateInterpolator` over endpoint/queryParams/headers with `parameters`. The ephemeral path
  (`buildEphemeralRequest`, l.455) deliberately does not template (HEL-823 non-goal, l.447-454) and uses the raw `url`.
  D1.3 lets the executor "extend the ephemeral infer path to carry queryParams/parameters, or infer with an unpersisted
  connector value; executor picks, the parity corpus decides". The first option means a second hand-written copy of the
  templating and URL composition: exactly the drift this ticket exists to remove, and it reverses a recorded HEL-823
  design decision. The corpus cannot decide either way. The test hook `fetchOverride` replaces the whole request build
  on the resolved path (l.267, `fn(config)`). On the ephemeral path its adapter passes `endpoint = config.url` and drops
  queryParams/parameters entirely (l.473-490). A stubbed corpus entry "url root with queryParams/parameters" therefore
  passes whichever option is chosen, unless the stub checks the composed request.
- **The inventory contradicts D1b.** apply-check-inventory.md section 4 still reads "PipelineService.create edit (rows
  1.4-1.12), addStep ... -> follow-up ticket". D1b and the spec say the pipeline create edit is in scope. Task 0.1 tells
  the executor to treat the inventory as the re-verified source of truth, so the contradiction will be read as license
  to defer.

Other checks:

- These citations hold: `staticColumnRuntimeType` (PipelineRowJson.scala:120; used by DataSourceService.scala:237),
  `resolveSentinelOutputId` (CombinedProposalService.scala:155), `checkExistingGraphAction` (PipelineCycleGuard.scala:101),
  `validateStepCrossOwnerRefs` (PCT:~100).
- The patch-set `$ref` mechanism (PatchSetRefs.scala) applies only to panel `config.outputId`, so a pipeline-create
  root can never be a `$ref` to a same-set source. D1b needs no ref handling.
- Placeholders: none. AC coverage: AC1 -> 1.1-1.3, AC2 -> 4.1, AC3 -> 4.2, AC4 -> 4.2 (scripted replay; live run reported
  unmet per the driver directive). Unchanged and acceptable.

### Verdict: REFUTE

### Change Requests

1. **D1b, inline roots in patch-set pipeline creates.** Remove the claim that patch-set pipeline-create roots are only
   `sourceId` roots. Specify how D1b handles an inline root. Recommended: run D1 steps 2-3 for it (inline create checks
   and the shared rest/sql/static schema builder), with the messages of the path patch-set apply actually takes
   (`PipelineRootWrites.resolveOneRootSourceId`'s inline branch), not PPS's. The cleaner way is for D1.1/D1.2 to extract
   from `PipelineRootWrites` too, so both inline-root entry points share one check list. Alternatively, defer inline
   roots in patch-set pipeline creates explicitly, with no column check and no rejection for Outputs on those roots so
   that nothing is over-rejected, and carve that out of the spec Requirement and the inventory. Add a corpus entry: a
   patch-set pipeline create with an inline static root whose Output maps one of its existing columns (preview must
   accept, as apply does) and one that maps a missing column (preview must reject).
2. **D1.3, REST: one request composition, not two.** Decide now instead of leaving it to the executor: the dry run must
   compose its HTTP request through the same code as `buildResolvedRequest` (templating, `joinUrl`, query merge,
   headers). For example, factor the post-`resolveConnector` part into a function that takes a `Connector` value, and
   feed it the unpersisted Auto connector that `ImplicitConnectorConfig.forLegacySource` would build. For the
   connectorId branch, use the real connector through the same function. Remove the "extend the ephemeral path with
   queryParams/parameters" option, since it re-implements templating that HEL-823 deliberately kept off that path. Make
   the corpus discriminating: the REST queryParams/parameters entry must fail if the dry run's composed request differs
   from apply's. Either the `fetchOverride` stub asserts on the composed request (endpoint after templating plus ordered
   query pairs), or a local HTTP stub records the received URL. Record a mutation (drop `parameters` from the dry-run
   path) that turns the entry red.
3. **Inventory section 4.** Rewrite the patch-set row so the `pipeline` create edit (rows 1.4-1.12 as applicable via
   D1b) is marked in scope, and only step add/update, updateStep and data-source create/update stay on the follow-up.

### Non-blocking notes

- The disabled-step fix also changes `POST /api/pipelines` (and patch-set pipeline creates), not only proposals. It
  aligns with `openspec/specs/pipeline-step-lifecycle/spec.md`, so no new delta is required, but say so in the PR and add
  one direct `POST /api/pipelines` regression test for it.
- With CR2 applied, the inline-root fetch happens twice per apply (dry run, then create). This is already stated in
  Risks. A transient fetch flip between the two is a stale-workspace case, not a parity failure. Worth one sentence.
- ClaudeClient citation corrected to l.168. Good.
