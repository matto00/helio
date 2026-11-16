## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD fd7064f7d700e49a2f7dfc1f6a244aab02048fd2. The planning artifacts are untracked, and there are no source
changes. B = backend/src/main/scala/com/helio.

### What I verified (with evidence)

Round-2 change requests, checked against the code:

- **CR-1 (inline roots in patch-set pipeline creates): resolved.** D1b no longer claims sourceId-only roots. It
  parameterizes D1 steps 1-2 by entry point. The proposal path uses PPS/SourceService checks and messages. The
  patch-set and `POST /api/pipelines` path uses checks extracted from `PipelineRootWrites`, which are its own
  messages. Step 3's schema builder is shared. The code supports this:
  - `PipelineRootWrites.resolveInlineRootSourceId` (PipelineRootWrites.scala:59-103) carries its own messages:
    "roots: name is required…" (l.64), "inline csv sources are not supported for pipeline roots…" (l.71),
    "roots: config is required…" and "unrecognized inline type".
  - It then calls the same `sourceService.createSql`/`createRest` and `dataSourceService.createStatic` that
    PPS.resolveSource uses (PPS ~l.382-412). So the extracted `validate*` functions in D1.2 serve both entry points.
  - On the patch-set path the root schema at apply is `ds.inferredSchema` of the created source, looked up by
    `lookupOwnedRoots` → `createTransactional` (PipelineCreateWrites.scala; PCT:59). That is the same input as on
    the PPS path, so a shared step-3 builder is correct.
  - The corpus entry exists: an inline static root with an existing column (accept) and a missing column (reject).
  - `resolvePipelineCreate` is in `resolveAll` (PatchSetApplyResolvers.scala:99). It currently skips inline roots
    (PatchSetPipelineResolvers.scala ~l.118-121), which is the gap D1b closes.
- **CR-2 (one REST request composition): resolved in substance.** The "extend the ephemeral path" option is gone, and
  HEL-823's no-templating rule on the ephemeral path is kept.
  - The design factors the post-`resolveConnector` part of `buildResolvedRequest` (RestApiConnectorDriver.scala:123-200:
    templating, `joinUrl`, ordered query merge, headers) to take a `Connector` value.
  - It feeds that function the unpersisted Auto connector from `ImplicitConnectorConfig.forLegacySource`
    (ImplicitConnectorConfig.scala:19, pure) or the real connector.
  - It extracts `createRest`'s url-branch config build (`splitUrl`, url+config queryParams merge, `parameters`;
    SourceService.scala:161-195) into a shared pure function.
  - The corpus must discriminate, with a recorded mutation (drop `parameters` from the dry-run path, entry goes red).
  - Two traps remain in how this gets built: notes 1 and 2 below.
- **CR-3 (inventory section 4): resolved.** Section 4 now marks the `PipelineService.create` edit IN SCOPE via D1b. Only
  addStep, updateStep and `DataSourceService.createStatic`/update stay on the follow-up.
- Earlier resolutions still hold:
  - The disabled-step fix: PCT builds `NodeStepInput` without `enabled` (PCT:61-70), while the insert uses
    `spec.enabled.getOrElse(true)`. Task 2.6 adds the `POST /api/pipelines` regression test.
  - The fetch-failure rule.
  - The `Real`/`Sentinel` panel binding.

Citations I re-checked:
- These all exist: `buildForCreate` (PanelCreateBuilder.scala:34), `resolvePanelCreate` (PatchSetPanelResolvers.scala:79),
  `OutputControlsValidator`, `PanelUpdateValidation`, `validateBindingsAndControls` (DashboardProposalService.scala:70),
  `ProposalLayoutSupport`, `resolveSentinelOutputId` (CombinedProposalService.scala:155),
  `rejectMissingOutput`/`rejectMissingDataSource`/`rejectInconsistentForm` (PanelBindingChecks.scala),
  `validateCreatePanelRequest`, `OutputFieldMappingCheck`, `checkExistingGraphAction`, `staticColumnRuntimeType`
  and `resolveAllRoots`.
- `OutputControlsValidator` requires an `OutputRepository` (l.24). That makes task 0.2's sentinel-controls decision
  a real one, and the spec allows apply-only with a reason.

Other checks:
- No placeholders.
- AC coverage is unchanged and acceptable: AC1 → 1.1-1.3; AC2 → 4.1; AC3 → 4.2; AC4 → 4.2 as a scripted replay, with
  the live run reported unmet under the driver's directive.
- The spec, proposal, design and inventory agree on scope, including patch-set pipeline creates being in scope.

### Verdict: CONFIRM

### Non-blocking notes (the executor should handle these; the corpus would catch 1 and 2)

1. **The unpersisted Auto connector has no credential.**
   - Problem: `Connector.isPending` is `credentialId.isEmpty` (Connector.scala:46). The credential branch of
     `buildResolvedRequest` returns `Left("Connector credential not found")` for `(Some(credRepo), None)`
     (RestApiConnectorDriver.scala:128-133). An unpersisted Connector value has `credentialId = None`. If the factored
     function keeps the pending guard or the decrypt step, every bare-url root is rejected in the dry run.
   - Fix: the factored function should take the credential value as an argument. Pass `""` for the NoAuth Auto
     connector, which matches `forLegacySource`'s plaintext. Keep `resolveConnector` and the decrypt in the
     persisted-path caller.
2. **`fetchOverride` cannot see the composed request.**
   - Problem: `fetch` applies `fn(config)` before `buildResolvedRequest` (l.267). The stub receives the un-templated
     `RestApiConfig`, not the endpoint after templating or the merged query pairs. A mutation inside the shared
     composition function would therefore stay green under a `fetchOverride` stub.
   - Fix: use the local HTTP stub option for the discriminating corpus entry, so the recorded mutation actually
     goes red.
3. **The check order differs by entry point.**
   - The PPS apply path resolves (creates) inline roots first, then runs `pipelineService.create`.
   - `PipelineCreateWrites.checkedCreate` (patch-set apply, `POST /api/pipelines`) runs a different order: the root
     shape and ownership of all roots, then `PipelineCreatePreflight.run`, then `validateStepCrossOwnerRefs`, and only
     then the inline source create checks (`createRootSources` → `createSql`/`createRest`/`createStatic`).
   - The patch-set policy in D1b should use that order too. Otherwise a multi-error edit reports a different first
     message at preview than at apply. Accept/reject parity is unaffected.
4. **SSRF guard on the dry-run fetch.** The dry-run REST fetch must be issued through `issueAndParse`. That is the
   HEL-879 SSRF choke point, keyed on the final post-`joinUrl` URI (l.318-333). Propose (assistant, MCP, and the new
   validate routes) now makes outbound fetches, so this is a new egress surface. State it in the PR.
5. **"edit N:" prefixes.** Patch-set resolve errors carry an `edit N:` prefix (`prefixedWithEdit`). "Apply's message"
   for D1b should be read as the edit-prefixed form, consistent with the existing preflight behaviour.
6. **Task numbering.** In tasks.md, section 2 runs 2.1, 2.2, 2.2a, 2.3, 2.5, 2.6, 2.4. This is cosmetic.
