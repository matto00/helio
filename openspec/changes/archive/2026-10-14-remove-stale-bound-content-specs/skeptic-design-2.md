## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 273c0b0c9c884a17210f58db811a3bb02718415d. The change dir is untracked and the branch has no commits yet.

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/stale-specs-dead-text-path/HEL-1466`.
- `npx --no-install openspec validate remove-stale-bound-content-specs --type change --strict` printed "Change 'remove-stale-bound-content-specs' is valid".
- Round-1 CR1 has been fixed. The markdown-panel PATCH requirement now says that an absent `config.content` leaves the content unchanged and that `null` clears it to `""`. A null scenario was added, the design.md code fact was corrected, and tasks 1.1a and 1.1b are now separate probes. The round-trip scenario now names `GET /api/dashboards/:id/export`.
- The REMOVED headers match the live spec headers byte for byte:
  - markdown-panel `:34`
  - mcp-panel-composition-tools `:38` and `:54`
  - panel-content-sizing `:35`
- panel-cross-filtering: `grep -cF` returns 1 for both quoted strings (the requirement header `:46` and the target-panel definition `:47`). Live `:160-161` still paraphrases them, so item 5 is real and D2 is accurate.
- Proposal type set: `helio-mcp/src/tools/proposal.ts:45` has `PANEL_TYPES = ["text","markdown","image","output","form"]`. The `dashboard-proposal.schema.json` `ProposalPanel.type` enum has the same five values. The zod `z.enum(PANEL_TYPES)` rejects deleted kinds. `PanelConfigCodec.decodeCreateConfig` (`:57-64`) registers only text/markdown/image/divider/output/form, so `timeline` is also gone.
- Binding authority: `ProposalPanelSupport.scala:260` (`mergeConfig(..., panel.outputId, ...)`) and `:271-272` (`withSourceBinding` re-applies the flat `dataSourceId`).
- TextRenderer: `TextRenderer.tsx` reads `data?.content ?? content`. Its only caller is `PanelContent.tsx:237`. `PanelContent` keeps `data` for `MetricRenderer` (`:253`), so the D3 guard is constructible. Only those two files reference `TextRenderer`.
- Item 4: root `package.json:62` is `"test": "jest && npm --prefix frontend test"`, and CLAUDE.md:25 documents the root form. Task 3.1 tests this empirically before any change. Sound.

### Verdict: REFUTE

This round found the same kind of defect as round 1: an ADDED requirement writes a new false claim into a living spec, and the verification task only probes the case where the claim happens to be true.

### Change Requests

1. **markdown-panel ADDED requirement "Only text and markdown panels carry literal content" is false for `form` on create.**
   - The requirement says that a `content` key sent in the config of an `output`, `image`, `divider` or `form` panel "on create or update SHALL be ignored (not stored)".
   - Ground truth: `backend/src/main/scala/com/helio/domain/panels/FormPanel.scala:211` declares a closed `AllowedKeys = Set("dataSourceId","fields","submit")`. `FormPanelConfig.read` (`:236-238`) calls `deserializationError("Unrecognized form config attribute(s): ...")` on any other key. `decodeCreate = decode`, and `PanelConfigCodec.scala:62,111` maps that error to `Left(...)`.
   - So `POST /api/panels` for a form panel with `config.content` is **rejected (400), not ignored**. `schemas/panels/panel.schema.json` `$defs.FormConfig` also declares `additionalProperties: false`.
   - Form PATCH (`Patch.decode`, `:283-302`) is tolerant and does drop the key. The behaviour therefore differs between create and update, and the single sentence covers neither correctly.
   - The design.md code fact ("Per-kind decoders are tolerant JSON readers") over-generalises in the same way. Task 1.1 probes only `image`, so it cannot catch this.
   - Required fixes:
     - Reword the requirement so it matches each kind. For example, image/divider/output ignore an unknown `content` key, while form rejects it on create with a 400 because its config is a closed set. Alternatively, restrict the "ignored" clause to the kinds where it holds, and state the form rule separately.
     - Correct the design.md code-fact bullet.
     - Extend task 1.1 so that every kind the requirement names (output, image, divider, form) is probed on both create and update. A probe of one kind must not certify a sentence about four.

2. **mcp-panel-composition-tools ADDED requirement re-asserts parity with a tool that no longer exists, and that tool's successor contradicts the claim.**
   - The new requirement keeps the phrase "matching `create_panel`'s agent-facing type set for agent/UI parity" next to "SHALL NOT offer `divider`".
   - `create_panel` is not a registered MCP tool. `helio-mcp/src/server.test.ts:46` lists it under removed tools, and the full `registerTool(` inventory under `helio-mcp/src/` does not contain it.
   - Its replacement, `create_content_panel` (`helio-mcp/src/tools/placements.ts:74,94`), uses `z.enum(["text","markdown","image","divider"])`. It **offers** `divider`, and it does not offer `output`/`form`.
   - So the parity sentence is false on both counts. This is exactly the stale kind of claim this ticket exists to remove. (The stale wording also appears in the `proposal.ts:38-39` comment and the `agentFacingPanelTypes.mjs` exclusion reason. Those are code comments, outside this change's scope; they are worth naming in the follow-up.)
   - Required fixes:
     - Drop the `create_panel` parity clause, or restate the actual rationale: divider is excluded as purely presentational layout chrome, per `scripts/lib/agentFacingPanelTypes.mjs` `AGENT_SURFACE_EXCLUSIONS`, which `check:schemas` enforces.
     - Add an item to task 1.2 that verifies every remaining sentence of that requirement, including the stated exclusion source.

### Non-blocking notes

- The scenario "Output panel is proposable" says "with ... an `outputId`". The proposal flow pre-validates bindings (`preValidateBindings`), so "a valid, caller-owned `outputId`" would be more precise.
- The proposal says "markdown-panel requirements 1–3", while D1 MODIFIES 1–2 and REMOVES/re-ADDs 3. The two are consistent, but the wording could match.
- No user-visible change is expected from the planned work.
