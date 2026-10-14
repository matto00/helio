## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/stale-specs-dead-text-path/HEL-1466`. Reviewed HEAD is `273c0b0c9c884a17210f58db811a3bb02718415d`, and the only change in the tree is the untracked change dir.
- `openspec validate remove-stale-bound-content-specs --type change --strict` printed `Change 'remove-stale-bound-content-specs' is valid`.
- REMOVED headers match the living specs byte for byte:
  - `Non-markdown panels have null content`
  - `Text panel sizing`
  - `propose_dashboard exposes the v1.5 panel type set`
  - `Proposal panels accept a generic config passthrough`
- MODIFIED requirements keep every living scenario name:
  - markdown-panel requirements 1–2, plus one new null scenario.
  - panel-cross-filtering: both scenarios at `:163` and `:167`.
- No living spec or doc outside these three specs cross-references any removed requirement name (grep returned no hits).
- **Round-2 CR1 (form create) is resolved, and the claim is true.**
  - `FormPanel.scala:211` declares `AllowedKeys = Set("dataSourceId","fields","submit")`.
  - At `:236-238`, `read` raises `Unrecognized form config attribute(s): ...` before any other field check.
  - `PanelConfigCodec.safe` returns the `DeserializationException` message as `Left`, so the 400 names the attribute.
  - The image, divider and output decoders read only their own keys via `fields.get(...)`, and their writers emit only their own fields. So "dropped" is accurate for those three types.
  - Task 1.1 now probes all four types on both create and update.
- **Round-2 CR2 (create_panel parity) is resolved.** The ADDED requirement now cites the product-scope reason recorded in `scripts/lib/agentFacingPanelTypes.mjs` `AGENT_SURFACE_EXCLUSIONS.divider` ("purely presentational layout chrome..."), which is true. Task 1.2 verifies every sentence.
- Five-type set:
  - `helio-mcp/src/tools/proposal.ts:45` has `PANEL_TYPES = ["text","markdown","image","output","form"]`, used by `z.enum` at `:71`.
  - `propose_dashboard` is registered at `:134` and `apply_proposal` at `:183`.
  - The `dashboard-proposal.schema.json` `ProposalPanel.type` enum (`:34`) has the same five values.
- Binding authority:
  - `ProposalPanelSupport.scala:260` calls `withSourceBinding(mergeConfig(..., panel.outputId, bindingKey), panel.dataSourceId)`.
  - `:271-272` re-applies the flat `dataSourceId` after the merge.
  - The delta's "flat outputId / form dataSourceId remain authoritative" matches this.
- Markdown PATCH: `MarkdownPanel.scala:46-48` maps absent to unchanged and `JsNull` to `""`, and `:72` applies `getOrElse`. This matches the MODIFIED requirement.
- panel-cross-filtering: both quoted strings appear byte-for-byte in the living narrowing requirement:
  - the header at `:46`
  - "every target panel (any panel other than the originating one) whose Output field mapping references the filter's dimension" at `:47`
- panel-content-sizing: the ADDED requirement carries every sizing rule from the living `Text panel sizing` requirement unchanged. Only the two bound-data scenarios are restated against `config.content`.
- TextRenderer:
  - It reads `data?.content ?? content`.
  - Its only references are `TextRenderer.tsx` itself and `PanelContent.tsx:237`.
  - `PanelContent` still takes `data` for other renderers, so the D3 guard (LITERAL vs BOUND through `PanelContent`) can be built. The mutation fails it as long as the prop pass-through is also restored, which D3 states.
  - `PanelContent.test.tsx` exists as a home for the guard.
- Item 4: root `package.json:62` is `"jest && npm --prefix frontend test"`, and `CLAUDE.md:25` documents the root form. Task 3.1 tests this empirically before any doc change. The fix is limited to the CLAUDE.md lines, which the AC allows.
- AC coverage:
  - Items 1, 2, 3 (spec) and 5: deltas plus tasks 1.x.
  - Item 3 (code + guard + mutation): tasks 2.x, 4.1 and 4.2.
  - Item 4: task 3.x.
  - Re-derivation and evidence per claim: C1 and 1.x.
  - No AC is left uncovered. No scope drift beyond the named stale statements.

### Verdict: CONFIRM

### Non-blocking notes
- The stale "create_panel parity" wording still appears in three places:
  - `scripts/lib/agentFacingPanelTypes.mjs:17-18` (the exclusion reason string)
  - `helio-mcp/src/tools/proposal.ts:142-143` ("dropped for agent/UI parity, mirroring create_content_panel")
  - the `dashboard-proposal.schema.json:35` description ("mirrored by create_panel's enum")

  `create_panel` no longer exists, and `create_content_panel` offers `divider`. The delta does not assert any of this wording, so it is out of scope here. Name all three in the follow-up, alongside `panel-type-rendering`'s "Bound text panel renders live content".
- The ADDED requirement sentence "No stale type list SHALL remain in the proposal flow's tool schemas or descriptions" is true about type lists. Task 1.2 should still record that the `proposal.ts` description's type list reads `text/markdown/image/output/form`.
- No user-visible change is expected from the planned work.
