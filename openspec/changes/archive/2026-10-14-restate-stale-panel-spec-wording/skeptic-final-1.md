## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 6b4d46cd0db59ca284fe6a36bb99eaf9df1c14ba against the live-resolved base 609e62b6d917243355a179fa8a26318c04898c27 (`resolve-review-base.sh`, exit 0). The diff is one commit. Spawn-cwd guard: READY.

### What I verified (with evidence)

- **No behaviour change.** Read the full non-openspec diff. It touches 7 files:
  - comments only in `AssistantProposalToolSchemas.scala`, `DashboardProposalProtocol.scala`, `ProposalPanelSupport.scala` (scaladoc), and `helio-mcp/src/tools/proposal.ts` (two comments);
  - one ScalaTest test name in `DashboardAuthoringPromptSpec.scala`;
  - three string literals: the `propose_dashboard` description in `proposal.ts`, the `AGENT_SURFACE_EXCLUSIONS.divider` reason in `agentFacingPanelTypes.mjs`, and the `ProposalPanel.type` description in `dashboard-proposal.schema.json`.

  No enum, type or logic token changed. The schema description string exists only in the schema file (grep over the tree, excluding the change dir: one hit), so no generated artifact derives from it.
- **Gates, re-run by me in this worktree:**
  - `npx openspec validate restate-stale-panel-spec-wording --type change --strict`: "is valid", exit 0.
  - `npm run check:schemas`: walked the `.../HEL-1592/schemas` path, 124 schemas, 11 panel-type surfaces, 14 assistant surfaces in sync, exit 0. `node scripts/check-schema-drift.selftest.mjs`: all cases passed, exit 0.
  - `npm --prefix helio-mcp run typecheck`: exit 0.
  - Root jest over `helio-mcp` and `scripts` (`--maxWorkers=3`, `--listTests` shows this worktree's paths): 51 suites and 469 tests passed, exit 0. This matches the count in evidence.md.
  - `sbt testOnly DashboardAuthoringPromptSpec` (with `-Xmx3g`, build file under this worktree): the backend compiled, 8 tests passed, and the renamed test ran under its new name.
- **AC1 (re-derive):** design.md "Code facts" re-derives all three items. I independently confirmed the facts that matter:
  - `create_panel` was removed (`helio-mcp/src/tools/write.ts:728`, HEL-907 comment).
  - `create_content_panel` offers `divider` (`placements.ts:94`).
  - `validatePanel` has no chartType or timeline-sort check (`ProposalPanelSupport.scala:36-51`).
  - `PanelConfigCodec.decodeCreateConfig` is the create-path decoder.
  - `/api/metrics` is gone (`ApiRoutes.scala:160`, `:591`).
- **AC2 (panel-type-rendering):**
  - The delta REMOVES "Each panel type renders a visually distinct body". That requirement holds every `typeId` scenario (base spec.md:16-60) and "Bound text panel renders live content".
  - It also REMOVES "Metric panel literal label/unit takes precedence…", which is the `fieldMapping` one.
  - It ADDS per-kind requirements for output, text, markdown, image, divider and form.
  - I spot-checked the claims against the code. `TextRenderer.tsx:6-18` shows literal content or placeholder lines and has no binding. `PanelContent.tsx:237`/`:253` handle text dispatch and the MetricRenderer fallback, so the unchanged "Unknown panel types degrade gracefully" requirement stays true.
  - After archive, no `typeId` remains in that spec. Lines 79-116 of the base spec have no `typeId` hits.
- **AC3 (wording):** `grep -rn "mirrored by create_panel|mirroring create_panel|create_panel's enum|create_panel parity"` over the tree, excluding node_modules, archive and dist, returned zero hits. The three named files and the `proposal.ts` panel-create-path comment now cite `AGENT_SURFACE_EXCLUSIONS`, `create_content_panel` and `PanelConfigCodec`/`POST /api/panels`. Each of those claims is true per the bullets above.
- **AC4 (mcp-panel-composition-tools):** the delta REMOVES all five named requirements. Their header text matches the base spec at lines 27, 76, 144, 178 and 211. The sort-handling Reason (zod enum rejects, backend decodes and never applies) agrees with the new `DashboardProposalProtocol.scala` comment and with the absence of any sort check in `validatePanel`.
- **AC5 / AC6:** the deltas are OpenSpec deltas and strict validation passes. evidence.md carries commands and outputs (859 lines). I sampled the gate outputs above and they reproduce.
- **AC7:** schema checks, helio-mcp typecheck and tests, and the backend build were all re-run green (above).
- **UI:** no `frontend/**` changes, so the visual and design step was skipped.

### Evaluator-noted misattribution (evidence.md "Out of scope, observed", bullet 2)

This is confirmed wrong. The line-34 `create_panel`/`type: "collection"` scenario sits at mcp-panel-composition-tools/spec.md:27-36. That is inside "create-panel-request schema agrees with the MCP type set", which this change REMOVES, so the scenario is gone at archive.

I judge it non-blocking:
- It is a triage note in the change's own record, not a living spec or shipped claim.
- The rest of the bullet points at real staleness that a follow-up would cover anyway. The "Proposal config passthrough is backward compatible" scenario still names `fieldMapping`/`aggregation`/`chartType` (base spec.md:47-48).
- The bullet itself says "Re-check at triage".

Delivery triage must not file the line-34 half. Editing it now would only move HEAD for a historical-record typo.

### Verdict: CONFIRM

### Non-blocking notes
- Triage: drop the line-34 `create_panel`/collection part of evidence.md "Out of scope" bullet 2, because the scenario is removed by this change. Keep the flat-field back-compat and chart-annotation staleness, which is real.
- The `validatePanel` scaladoc (`ProposalPanelSupport.scala:33-35`) reads as a complete list but omits `validateSourceBinding` and `validateControlsShape`. The omission predates this change; wording like "including" would fix it.
- Other living specs still mention `typeId` (dashboard-export-import, echarts-chart-panel, panel-polling, write-path-audit). evidence.md records them as out of scope; they are worth a follow-up.
- No gate defect: no mtime-ordering evidence was relied on.
