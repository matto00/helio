# Red run (HEL-1779), on main code + new tests, before any implementation

Command: sbt testOnly PatchSetInsightOutputSpec AssistantProposalToolSchemasSpec OutputKindDriftSpec

[info] - should OutputConfigValidation.KnownKeys covers exactly the canonical kinds
[info] - should OutputBindingSpec.All covers exactly the canonical kinds, once each
[info] - should OutputPanelDefaultSize has a size for every canonical kind
[info] - should fromString's error message lists exactly the canonical kinds
[info] - should asString/fromString round-trip every canonical kind
[info] - should carry exactly the canonical kinds in every kind enum
[info] - should name every canonical kind in node-capabilities-response's description
[info] - should document every insight key on the create-output-request schema
[info] - should offer every canonical kind in its create picker (HEL-1744 L5 removed the insight exclusion)
[info] - should list exactly the canonical kinds in the node-capabilities parity fixture
[info] - should carry exactly the canonical kinds (HEL-1747 L8 removed the insight exclusion; every helio-mcp enum derives from it)
[info] - should propose_pipeline's Output kind enum equals the canonical kinds *** FAILED ***
[info] - should propose_combined's Output kind enum equals the canonical kinds *** FAILED ***
[info] - should keep no hand-written kind list in AssistantProposalToolSchemas.scala *** FAILED ***
[info] - should KeysDoc documents every insight key and value inside its insight: segment *** FAILED ***
[info] - should list exactly the canonical kinds
[info] - should decode a rest_api example's config to RestApiConfigPayload with no DeserializationException
[info] - should decode a sql example's config to SqlSourceConfigPayload with no DeserializationException
[info] - should each decode to a DashboardProposal with no DeserializationException
[info] - should include a form example whose flat dataSourceId survives the decode and passes validatePanel
[info] - should advertise dataSourceId on the panel schema
[info] - should each decode to a PipelineProposal with no DeserializationException
[info] - should exercise the inline-source branch (source-branch exclusivity)
[info] - should the inline rest_api example's config decodes through RestApiConfigPayload.toDomain
[info] - should decodes a step carrying enabled: false with no DeserializationException
[info] - should each decode to a CombinedProposal with no DeserializationException
[info] - should bind at least one dashboard panel via the literal "$pipelineOutput" sentinel, surviving decode
[info] - should every dashboard panel in every example passes PanelType.fromString and ProposalPanelSupport.validatePanel
[info] - should every panel passes PanelType.fromString and ProposalPanelSupport.validatePanel
[info] - should each decode to a PatchSet with no DeserializationException
[info] - should carry an update edit with target.id present
[info] - should documents attachAsTail: true as required for a pipelineStep create to add a lane
[info] - should decodes an edit targeting kind: "output" with no DeserializationException
[info] - should document every kind's keys and both aggregation shapes on propose_pipeline's Output config
[info] - should document every kind's keys and both aggregation shapes on propose_combined's Output config
[info] - should offer exactly OutputKind.all (insight included) as propose_pipeline's Output kind enum, and state the new-pipeline reads rule *** FAILED ***
[info] - should offer exactly OutputKind.all (insight included) as propose_combined's Output kind enum, and state the new-pipeline reads rule *** FAILED ***
[info] - should state the existing-pipeline reads.outputs rule on propose_patch_set's edit patch description (HEL-1779, RED on main) *** FAILED ***
[info] - should document them on propose_patch_set's edit patch description
[info] - should find at least one output panel and one Output, so the checks below cannot pass vacuously
[info] - should never put an Output config key on an output panel
[info] - should give every example Output a config that passes OutputConfigValidation.validateConfig for its kind
[info] - should show aggregation on at least one example Output's config
[info] - should be deprecated with a description on the propose_dashboard tool schema, and no other property is
[info] - should be deprecated with a description in schemas/dashboards/dashboard-proposal.schema.json, and no other property is
[info] - should RED: preview and apply a valid insight (refresh manual, reads a stored table Output), storing kind and config *** FAILED ***
[info] - should RED: reject at preview a reads.outputs id that is not an Output of that pipeline *** FAILED ***
[info] - should RED: reject at preview a reads.outputs id of an Output the same set deletes *** FAILED ***
[info] - should RED: reject at preview a reads.outputs id that is not an Output of that pipeline *** FAILED ***
[info] - should GUARD: preview and apply a valid reads update
[info] - should RED: reject at preview an out-of-range insight config value (validateConfig parity)
[info] Tests: succeeded 40, failed 11, canceled 0, ignored 0, pending 0
[info] *** 11 TESTS FAILED ***

Probed finding: on main OutputFieldMappingCheck (via PipelineCreatePreflight.validateOutputConfig) applies the new-pipeline rule (any reads.outputs refused, Map.empty) to a patch-set output create, so a valid insight read is refused at preview and a bad id carries a '(node ...)' suffix. Update-path: preview does not check reads at all. GUARD (green on main): valid reads update; out-of-range maxSentences update refused (preview projection already validates).
