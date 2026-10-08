# HEL-1156: Panel.scala's PanelKind.All scaladoc still asserts "adding a new kind only requires updating Panel.Registry" — the root source of the false premise HEL-1150 corrected

## Description

Follow-up from HEL-1150 (spec §2 correction), triaged `standalone` by the owner on 2026-09-18.

`origin_kind: followup`
`origin_ticket: HEL-1150`

HEL-1150 removed the false "registration is the only enumeration to change" premise from the v0.8 design spec. The premise did not originate in the spec — it originated in backend source, and it is still there: `backend/src/main/scala/com/helio/domain/model/Panel.scala` reads

```scala
  /** Registry-derived allow-list. After cycle 1 no consumer enumerates these
   *  manually — adding a new kind only requires updating [[Panel.Registry]]. */
  def All: Set[String] = Panel.Registry.keySet
```

The first sentence is true only for `parseKind`/`PanelKind.All`. The second is false: HEL-1083 delivering the `form` kind had to touch ~22 hand-enumerated sites across four layers (`PanelType`, `PanelConfigCodec`, `PanelServiceHelpers.buildNewPanel`, `PanelRowMapper`, `PanelRepository` config columns, `DashboardSnapshotRepository`, `AssistantProposalToolSchemas`, `schemas/panels/*`, `schemas/dashboards/dashboard-proposal.schema.json`, helio-mcp `proposal.ts`/`write.ts`, frontend `panel.ts`, `mobilePanelHeights.ts`, `panelNarrowing.ts`, `OutputPicker.CONTENT_PANEL_KINDS`, `PanelContent.tsx`, `PanelDetailModal.tsx`) plus a `panels_kind_check` migration (V108).

Left alone, this scaladoc re-seeds the same error into the next document or ticket written from the code. The corrected spec §2 carries the real drift surface and a re-derive recipe; the code comment should point there, not contradict it.

Suggested direction: rewrite the scaladoc (comment-only, no behaviour change) to state what `All` actually governs and where the rest of the surface is documented. Also check the `Registry` doc comment just above it ("Single source of truth — every …") for the same overclaim and correct it in the same change.

## Acceptance Criteria

1. `grep -n "only requires updating" backend/src/main/scala/com/helio/domain/model/Panel.scala` returns 0 hits (positive control: currently 1).
2. The replacement scaladoc names the spec section as the documented drift surface and says explicitly that the registry governs `parseKind`/`All` only.
3. Diff is comment-only in `Panel.scala` (no change to any non-comment line; `git diff -w` shows no code movement).
