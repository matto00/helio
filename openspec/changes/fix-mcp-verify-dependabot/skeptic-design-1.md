## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- create_pipeline inputSchema (helio-mcp/src/tools/pipelines.ts): `roots: z.array(createPipelineRootSchema).min(1)`, steps/outputs default [], tag optional. Matches design claim. add_outputs_from_shape schema (pipelineId/stepId?/shapeId/params/outputName/outputKind?) matches.
- CreateApiTokenRequest(name, expiresInDays: Option[Int], scopedPipelineIds: Option[Seq]) (ApiTokenProtocol.scala:17); name <=100 chars, non-blank. `HEL-1264 verify <runId>` fits. POST/DELETE /api/tokens inside the authenticated block, session OR PAT (ApiTokenRoutes.scala header), unscoped create has no PAT restriction in ApiTokenService.create.
- SDK 1.29.0 validateToolInput throws McpError "Input validation error: Invalid arguments for tool X: <zod msg>", which the call handler converts via createToolError into an isError result (mcp.js ~139-178). Zod installed 3.25.76 -> "roots: Required". Design D2's detection (and "handler reached" check) is sound over InMemoryTransport.
- Outputs: V94 `outputs.pipeline_id REFERENCES pipelines(id) ON DELETE CASCADE`; design plans to confirm rather than assume. OK. HEL-989 source-delete-after-pipeline ordering is consistent with DataSourceDeleteError.
- Jest: root jest.config.cjs testMatch `**/?(*.)+(spec|test).[tj]s?(x)`, ignore list has no `scripts` or helio-mcp exclusion except dist; transform overrides to NodeNext, so helio-mcp/scripts/verifyPayloads.test.ts is collected and ts-jest type-checked like server.test.ts. tsconfig.typecheck.json includes scripts/**. Constraint: verifyPayloads.ts must not import verify.ts (top-level main()/import.meta) - design's regex-on-source approach already avoids that.
- check-dependabot-groups.selftest.mjs uses injected fixture families/manifests only (lines 20-31, 140-200); it does not enumerate real DECLARED_FAMILIES, so no selftest change is needed.
- Ticket ACs all traced: shapes (1.1/1.2), green e2e (3.5), fixtures + PAT revoke by id (1.3/1.4), drift guard w/ mutation (3.1/3.2), dependabot (2.1). No placeholders/TBDs.

### Verdict: REFUTE

### Change Requests
1. check-dependabot-groups.mjs `main()` (lines ~284-292) hardcodes `for (const directory of ["/", "/frontend"])` when loading manifests. Neither design.md D5, proposal Impact nor tasks 2.2 plan to add "/helio-mcp". As written, adding the `mcp-sdk` family to DECLARED_FAMILIES makes `check:dependabot` fail with `family "mcp-sdk": no manifest available for "/helio-mcp"` (family loop, ~line 238), and the "unaccounted production dependency" coverage loop is skipped for /helio-mcp (`if (!manifest) continue`) - so spec scenario "Grouping check covers helio-mcp" would also be unsatisfied. Revise D5/tasks 2.2 to extend the manifest-loading list to include "/helio-mcp", and make task 3.3's mutation also cover the coverage path (e.g. a helio-mcp prod dep in neither family nor DECLARED_INDEPENDENT -> red naming it), since that is the spec scenario. (Selftest may optionally gain a fixture case for the new directory; not required.)

### Non-blocking notes
- Consider `expiresInDays: 1` on the minted PAT as a backstop against a hard crash between mint and ledger push.
- A drift test with a stub HelioApi must return plausible shapes for the handler paths (e.g. create_pipeline's roots/outputs read, expand for the deliberate-failure calls) so "handler reached" is not confused with handler error; assert on the recorded api method, not on isError.
- The workspace mixes ticket-referencing comments (HEL-1264) with repo comment standard; keep them minimal.
