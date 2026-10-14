## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 273c0b0c9c884a17210f58db811a3bb02718415d (change dir untracked, no commits on branch yet).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/stale-specs-dead-text-path/HEL-1466`.
- `openspec validate remove-stale-bound-content-specs --type change --strict` -> "Change 'remove-stale-bound-content-specs' is valid".
- Ticket items still present in the tree:
  - mcp-panel-composition-tools `openspec/specs/.../spec.md:38-80`: the stale seven-type set, "Collection is proposable", "bound to the DataType" (:69) and "source-companion ... DataType id" (:78) are all present. The REMOVED headers match the live headers byte for byte (:38, :54).
  - markdown-panel `:9-40`: top-level `content` in reqs 1-2; `:35` lists `text` under null content. Present.
  - panel-content-sizing `:47`/`:52`: "Text panel with bound data ..." scenarios. Present.
  - panel-cross-filtering `:159-160` paraphrases. The quoted header (`:46`) and the target-panel definition ("every target panel (any panel other than the originating one) whose Output field mapping references the filter's dimension", `:47`) both appear verbatim in the live spec, so the D2 quoting is accurate.
- Premise correction (`form`): `helio-mcp/src/tools/proposal.ts:45` `PANEL_TYPES = ["text","markdown","image","output","form"]`, and `dashboard-proposal.schema.json` `ProposalPanel.type` enum is the same five values. Correct.
- Binding authority: `ProposalPanelSupport.scala:260` (`mergeConfig(... panel.outputId ...)`) and `:271-272` (`withSourceBinding` re-applies flat `dataSourceId`). Correct.
- Image `content` is ignored. `ImagePanelConfig.decode` and `Patch.decode` (`ImagePanel.scala`) read only imageUrl/imageFit/caption, so an unknown `content` key is dropped. No `content` appears in Output/Form/Divider panel Scala. Correct.
- TextRenderer: `TextRenderer.tsx` reads `data?.content ?? content`. Its only caller is `PanelContent.tsx:237`. `PanelContent` keeps its `data` prop after the change because `MetricRenderer data={data}` uses it at `:253`. So the D3 guard (passing non-null `data` through `PanelContent`) is still constructible and typechecks. Correct.
- Item 4 premise: root `package.json:62` `"test": "jest && npm --prefix frontend test"`, and CLAUDE.md:22-25 documents the root form. D4's proposed mechanism is plausible. Task 3.1 checks it empirically before anything changes. Sound.

### Verdict: REFUTE

### Change Requests

1. **A false code fact is written into the markdown-panel delta.** design.md "Code facts" says "Markdown/Text `Patch` treat absent and `null` `content` as 'leave unchanged'". The ADDED/MODIFIED delta `specs/markdown-panel/spec.md` (requirement "Markdown panel content is updatable via PATCH") repeats it: "An absent or `null` `config.content` SHALL leave the stored content unchanged". Ground truth contradicts both. `backend/src/main/scala/com/helio/domain/panels/MarkdownPanel.scala` `Patch.decode` has `case Some(JsNull) => Some("")`, and `applyPatch` uses `patch.content.getOrElse(config.content)`, so a `null` **clears content to `""`**. The same is true of `TextPanel.scala:48`. Its doc comment reads "absent leaves unchanged; `JsNull` -> ''", and `PanelConfigCodec.applyConfigPatchUnsafe` routes PATCH straight to it with no null-stripping. Required fixes:
   - Requirement text: absent `config.content` leaves the content unchanged. `null` clears it to the empty string, so there is no clear-to-null and the stored value is never null.
   - Add a scenario that pins the null behaviour, e.g. "PATCH with `config: { content: null }` -> response `config.content: \"\"`".
   - Correct the design.md code-fact bullet.
   - Reword task 1.1 to verify absent and null **separately**. As written ("PATCH absent/null unchanged"), a check that only tries an absent `content` would wrongly confirm the false claim. This ticket exists to remove false spec claims, so it must not add one.

### Non-blocking notes

- markdown-panel scenario "Markdown panel content survives round-trip" says "an authenticated read that carries its panels" without naming an endpoint. Consider naming one (e.g. `GET /api/dashboards/:id/export`) so the evidence command in task 1.1 has a concrete target.
- `panel-type-rendering/spec.md:51` "Bound text panel renders live content" stays stale after the code is removed. This is acknowledged in Non-Goals and Risks. Make sure the follow-up ticket names that scenario explicitly.
- No user-visible change is expected. The text render path only changes for a text panel that is handed non-null row data, and nothing in the tree supplies that (task 2.1 should prove it).
