# HEL-627: helio-mcp: add update_panel tool (title/type/config), not just appearance

## Description

The backend's `PATCH /api/panels/:id` already accepts a full partial update — `UpdatePanelRequest` (`backend/src/main/scala/com/helio/api/protocols/PanelProtocol.scala:70`) carries `title`, `appearance`, `type` **and** `config`, all optional.

But `helio-mcp` only wraps the appearance slice of it. `update_panel_appearance` is the sole panel-edit tool, so **an agent has no way to change a panel's** `title` **or** `config` — which includes `unit`, `annotation`, `columnOrder`, and markdown/text `content`.

The practical consequence: any text or config edit forces **delete-and-recreate**. That churns panel ids and layout positions, and it's lossy in exactly the way HEL-328 describes for the other resources.

Found in practice while an agent rebuilt the "Helio Roadmap — v1.6 to v1.8" dashboard on prod via MCP: 7 of 13 panels had to be deleted and recreated purely because their literal config text (metric `unit` strings, chart `annotation`s, two markdown bodies) was stale, with the layout re-packed afterwards. `bind_panel` was confirmed to merge-patch `config` on the bound-panel path, but it is a binding tool — it is not a general config editor and doesn't cover unbound panels or `title`.

## Scope

Add an `update_panel` tool in `helio-mcp/src/tools/write.ts` + a method on `HelioApi` (`helio-mcp/src/helioApi.ts`), as a thin pass-through to the existing `PATCH /api/panels/:id`:

* Accept optional `title`, `type`, `config`, `appearance` — mirroring `UpdatePanelRequest`.
* Reuse the shared `guarded` error wrapper so backend 400/403/404 surface verbatim (RLS and V41 stay authoritative server-side).
* Follow the same thin-passthrough pattern as the four tools proposed in HEL-328 (`update_data_source` / `update_data_type` / `update_pipeline` / `update_pipeline_step`) — this is the missing fifth resource in that same parity gap, and the two should probably ship together.

**Document the merge semantics precisely in the tool description**, because they differ per field and this is exactly where agents get burned:

* `appearance` is a **partial merge** as of HEL-362 (PR #297) — omitted fields are preserved. Note the tool description previously claimed partial merge while the backend still replaced wholesale; make sure the description matches the deployed reality, not the intent.
* State explicitly whether `config` merges or replaces, verified against `PanelServiceHelpers` rather than assumed.

## Acceptance Criteria

- [ ] `update_panel` registered and callable, returning the updated panel JSON.
- [ ] A panel's `title` can be changed without delete-and-recreate.
- [ ] A metric panel's `unit`, a chart's `annotation`, and a markdown panel's `content` can each be edited in place — panel id and layout position preserved.
- [ ] Tool description states exactly which fields are patchable and the merge semantics of each, verified against the backend rather than asserted.
- [ ] README tool table updated; `dist/` rebuilt.

## Notes

Related to HEL-328 (the same edit-in-place parity gap for data-source / DataType / pipeline / pipeline-step — panels are simply missing from its table). This is the low-level primitive that the HEL-343 (epic: Conversational Refinement) patch-set work (HEL-403 schema, HEL-406 apply path) will sit on top of; without it, a patch set cannot express a panel text edit at all.
