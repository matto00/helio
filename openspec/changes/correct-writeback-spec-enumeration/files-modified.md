# Files modified — HEL-1150

- `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` — rewrote §2 ("Form panel") in place:
  corrected the false "registration is the only enumeration to change" premise, fixed the two stale line-number
  anchors (`Panel.scala:109`, `model.scala:141`) to symbol+directory anchors, added a layer-grouped "Drift surface
  for a new panel kind" snapshot (dated, labelled non-authoritative, with a re-derive recipe), stated the
  `panels_kind_check` migration requirement (V108 precedent), fixed the false "second panel kind after `divider`"
  claim, and added one dated provenance parenthetical. No other file touched.

Base SHA resolved via `scripts/concertino/resolve-review-base.sh` (main/origin): `9f6f4d41248103e39582500c38b95cc6d8233be5`

`git diff --name-only 9f6f4d41248103e39582500c38b95cc6d8233be5` → exactly one file:
`docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`

## Verification (D8 — zero-hit probes with positive controls)

Probes run against the file before and after the edit:

| Probe                                                          | Pre-edit (red) | Post-edit (green) |
| ---------------------------------------------------------------- | -------------- | ------------------ |
| `grep -c "only enumeration to"` (multi-line phrase; confirmed with `grep -Pzo`) | 1 | 0 |
| `grep -cE 'Panel\.scala:109\|model\.scala:141'`                 | 2              | 0                  |
| `grep -c panels_kind_check`                                      | 0              | 1                  |
| `sed -n '/^### 2 — Form panel/,/^### 3 —/p' <file> \| grep -cE ':[0-9]+\`'` (stale line-number anchors inside §2) | n/a (pre-edit had the two anchors above, caught by the previous probe) | 0 |
| `grep -c V108`                                                    | 0              | 1                  |

Symbol resolution — every symbol named in the new §2 resolves via `grep -rq`/`test -f` over
`backend/src frontend/src schemas helio-mcp/src` (26/26 OK; two initial single-line-literal probes for
`PanelRowMapper`'s two fallthroughs false-failed because the `case _ =>` and its RHS span two source lines —
re-probed with `grep -rq "case _ =>"` and `grep -rq "case _ *=> base"`, both OK, and manually read the file to
confirm both silent fallthroughs (`rowToDomain`'s `case _ => OutputPanel(...)` and `domainToRow`'s
`case _ => base`) are real):

```
OK  Panel.Registry
OK  Panel.Companion
OK  PanelKind.All
OK  PanelType (object + fromString/asString/Default, model.scala)
OK  PanelConfigCodec
OK  buildNewPanel (PanelServiceHelpers)
OK  PanelRowMapper.rowToDomain case _ => OutputPanel(...)
OK  PanelRowMapper.domainToRow case _ => base
OK  PanelRepository.configColumnsOf
OK  PanelRepository.configColumnValuesOf
OK  DashboardSnapshotRepository (PanelConfigCodec match)
OK  AssistantProposalToolSchemas
OK  schemas/panels/*.schema.json
OK  schemas/dashboards/dashboard-proposal.schema.json
OK  helio-mcp/src/tools/proposal.ts
OK  helio-mcp/src/tools/write.ts
OK  frontend/src/features/panels/types/panel.ts
OK  frontend/src/features/dashboards/types/proposal.ts
OK  frontend/src/features/panels/ui/grid/mobilePanelHeights.ts
OK  frontend/src/features/panels/state/panelNarrowing.ts
OK  OutputPicker.CONTENT_PANEL_KINDS
OK  PanelContent.tsx
OK  PanelDetailModal.activeEditorRef
OK  PanelDetailModal.renderSubtypeEditor
OK  PanelSpec (backend/src/test/scala/com/helio/domain/model/PanelSpec.scala)
OK  scripts/check-schema-drift.mjs
OK  V108__add_form_panel_kind.sql
```

Formatting: `npx prettier --write` then `npx prettier --check` on the one file — exit 0, "All matched files use
Prettier code style!".

Diff-hunk scope (D7/tasks 2.2/2.3): `git diff --name-only <base>` lists exactly one file (outside `openspec/`);
both `@@` hunks in the file's diff fall strictly between line 157 (`### 2 — Form panel`) and line 243
(`### 3 — Output controls...`), i.e. entirely inside §2. No `frontend/`, `backend/`, `schemas/`, `helio-mcp/`, or
migration file touched.

## Findings against the planning artifacts

- The exact false-premise string `"registration is the only enumeration to change"` wraps across a line break in
  the source markdown, so a naive single-line `grep -c` reports 0 even pre-edit; confirmed the true count (1) with
  `grep -Pzo`. Recorded both counts above for anyone re-running the probe.
- `PanelRowMapper`'s two silent fallthroughs (`rowToDomain`'s `case _ => OutputPanel(...)` and `domainToRow`'s
  `case _ => base`) are real but span two source lines each (`case _ =>` then the RHS on the next line), so a
  literal-string `grep -rq "case _ => OutputPanel"` false-fails. Verified by reading the file directly and by a
  looser grep. No change to the spec text was needed — the description in §2 already states the fallthrough
  target correctly.
- Everything else in design.md's Context section and the ticket's "Orchestrator corrections" (symbol locations,
  V108 precedent, panel.ts/proposal.ts/write.ts paths, `PanelDetailModal.tsx` chains) verified correct against the
  tree as stated; no further corrections needed beyond what D1–D8 already specified.
