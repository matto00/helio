# Files modified (HEL-1156)

- `backend/src/main/scala/com/helio/domain/model/Panel.scala` — scaladoc-only corrections E1–E5 (trait Panel header x2, Panel.Registry, PanelKind.All, object PanelKind doc); no code line changed.

Review base: `BASE_SHA=2dd4ed6237817b1feef22d69f8bc8058e58541db` (`resolve-review-base.sh <worktree> main origin`).

## 2.1 AC1

```
$ git show origin/main:backend/src/main/scala/com/helio/domain/model/Panel.scala | grep -c -i "only requires updating"
1
$ grep -n -i "only requires updating" backend/src/main/scala/com/helio/domain/model/Panel.scala
(no output, exit status 1)
```

## 2.2 AC2

```
$ grep -c "Drift surface for a new panel kind" backend/src/main/scala/com/helio/domain/model/Panel.scala
1
$ grep -c "docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md" backend/src/main/scala/com/helio/domain/model/Panel.scala
1
$ grep -n "source of truth for \[\[parseKind\]\] and" backend/src/main/scala/com/helio/domain/model/Panel.scala
128:  /** Registry-derived allow-list: the source of truth for [[parseKind]] and
$ grep -n -i "this set ONLY" backend/src/main/scala/com/helio/domain/model/Panel.scala
129:   *  this set ONLY. Adding a kind also requires hand-enumerating many further
$ git show origin/main:... | grep -c -i -E 'only requires updating|single source of truth|8th panel kind|derives from this Map|round-trip through the|panels\.type|Source of truth for the panel-type'
8
$ grep -n -i -E '<same pattern>' backend/src/main/scala/com/helio/domain/model/Panel.scala
(no output, exit status 1)
$ grep -c "git grep -l -i divider -- backend/src/main frontend/src helio-mcp/src schemas" backend/src/main/scala/com/helio/domain/model/Panel.scala
1
```

## 2.3 AC3 (comment-only, before commit)

```
$ git diff -U0 -- backend/src/main/scala/com/helio/domain/model/Panel.scala | grep -E '^[-+]' | grep -v -E '^(\+\+\+|---)' | grep -v -E '^[-+][[:space:]]*(\*|/\*\*)'
(no output, filter exit status 1)
$ git diff --stat
 .../main/scala/com/helio/domain/model/Panel.scala  | 58 +++++++++++++++-------
 1 file changed, 41 insertions(+), 17 deletions(-)
$ git status --short
 M backend/src/main/scala/com/helio/domain/model/Panel.scala
?? openspec/changes/panelkind-scaladoc-drift-surface/
```

## 2.4 Claim proofs (design.md "Claim → proof")

P1 — `git grep -n -E "Panel\.Registry|Panel\.companionFor" -- backend/src/main | grep -v "domain/model/Panel.scala"`
```
backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala:58:        Left(s"Unknown panel type: '$unknown'. Valid values: ${Panel.Registry.keySet.toSeq.sorted.mkString(", ")}")
```
P2 — `grep -n "PanelRowMapper.rowToDomain(row)" .../PanelRowMapper.scala .../PanelRepository.scala`
```
backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRepository.scala:29:    PanelRowMapper.rowToDomain(row)
```
P3 — `grep -n "row.kind match"` and `grep -n -A1 "case _ =>" ... | head -2`
```
37:    row.kind match {
48:      case _ =>
49-        OutputPanel(id, dashboardId, row.title, meta, appearance, ownerId, outputConfig(row))
```
P4 — `grep -n "Valid values: text, markdown, image, divider, output, form" .../model.scala`
```
159:    case other      => Left(s"Unknown panel type: '$other'. Valid values: text, markdown, image, divider, output, form")
```
P5 — per-file count of `DividerPanel|"divider"|DividerCreate|FormPanel|"form"`
```
PanelConfigCodec.scala 8
PanelServiceHelpers.scala 3
PanelRepository.scala 2
DashboardSnapshotRepository.scala 2
AssistantProposalToolSchemas.scala 2
ProposalPanelSupport.scala 2
```
P6 — `grep -n "panels_kind_check" .../V108__add_form_panel_kind.sql`
```
4:-- without widening `panels_kind_check`, a `kind = 'form'` row cannot be
22:  DROP CONSTRAINT panels_kind_check,
23:  ADD CONSTRAINT panels_kind_check
```
P7 — spec paragraph and §2 heading
```
194:**Drift surface for a new panel kind** (as of HEL-1083/HEL-1084, 2026-09-17 —
157:### 2 — Form panel
```
P8 — `grep -n "Panel.Registry.keySet shouldBe" .../PanelSpec.scala`
```
60:      Panel.Registry.keySet shouldBe Set(
```
P9 — `grep -n -E '"def fromString\(s: String\)"|panelTypeSurfaces\.push' scripts/check-schema-drift.mjs`
```
220:  "def fromString(s: String)",
318:panelTypeSurfaces.push({
```
P10 — recipe `git grep -l -i divider -- backend/src/main frontend/src helio-mcp/src schemas`, count of each named site (`grep -c -F`)
```
PanelConfigCodec.scala 1
PanelServiceHelpers.scala 1
PanelRowMapper.scala 1
PanelRepository.scala 1
DashboardSnapshotRepository.scala 1
ProposalPanelSupport.scala 1
AssistantProposalToolSchemas.scala 1
model/model.scala 1
schemas/panels/ 4
dashboard-proposal.schema.json 1
helio-mcp/src/tools/proposal.ts 1
helio-mcp/src/tools/write.ts 1
frontend/src/features/panels/types/panel.ts 1
PanelContent.tsx 1
PanelDetailModal.tsx 1
mobilePanelHeights.ts 1
panelNarrowing.ts 1
OutputPicker.tsx 1
P10 negative control (old quoted recipe `'"divider"'`), count of PanelRowMapper.scala:
0
```

All P1–P10 outputs match the expectations stated in design.md.

## 3.1 Compile / test

```
$ cd backend && nice -n 19 sbt "testOnly com.helio.domain.model.PanelSpec"
...
[info] Total number of tests run: 36
[info] Suites: completed 1, aborted 0
[info] Tests: succeeded 36, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
[success] elapsed time: 1 s
exit=0
```

## 3.2 OpenSpec validate

```
$ openspec validate panelkind-scaladoc-drift-surface --type change
Change 'panelkind-scaladoc-drift-surface' is valid
exit=0
```
