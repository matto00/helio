## Context

See proposal.md - Why. Current behaviour, each fact verified on origin/main e88b929c6 (commands in "Verification
ledger" below — the executor re-runs them and pastes output into `evidence.md`):

- A literal markdown panel renders `panel.config.content` (`PanelContent.tsx:238`); a placed markdown Output renders
  `readMarkdownConfig(output.config).content` (`OutputPanelContent.tsx:237-239`). Neither reads `fieldMapping`.
- Backend `MarkdownPanelConfig(content: String)` (`MarkdownPanel.scala:14`); markdown Output has no slots and
  `validateFieldMapping` rejects every key (`OutputBindingSpec.scala:97-106,160-168`, HEL-1139).
- Proposal text/markdown panels get `{"content": ...}` only (`ProposalPanelSupport.scala:327-328`).
- Legacy rows: V94 kept data-bound markdown `fieldMapping` unfiltered (`V94__outputs_model.sql:560-563`); no later
  migration clears it; `pipeline-output-sheet/spec.md:84` names "stored config contains `fieldMapping.content`".
- `crossFilterRows.ts:91-92` maps `markdown` to that stored `fieldMapping`, so today
  `isPanelFilterableByDimension("markdown", {fieldMapping:{content:"region"}}, _, "region") === true`. Callers:
  `OutputPanelContent.tsx:131`, `useCrossFilteredPanelData.ts:76`, `useCrossFilterServerOps.ts:60`.

## Goals / Non-Goals

Goals: AC1-AC5 in ticket.md. Non-goals: see proposal.md Non-goals (follow-ups).

## Decisions

D1. `mcp-panel-composition-tools`: two MODIFIED blocks, each a full copy of the current requirement changing ONLY
the stale markdown-binding wording (diff vs canonical is the reviewable surface). `markdown-panel`: REMOVED + ADDED
(new name "...renders its literal content...") because `openspec validate` rejects a MODIFIED block that drops a
current scenario ("omits scenario(s) the current spec still has"), and the stale scenario must go. The ADDED block
keeps the three still-true scenarios and adds "Placed markdown Output renders its literal content".

D2. `## Purpose` is not expressible in an OpenSpec delta (archive only rewrites requirements), so the three Purpose
lines are edited directly in `openspec/specs/<cap>/spec.md`, in the same commit. Exact replacement text is in
tasks.md 1.1-1.3. `markdown-panel-content-source` gets no delta: none of its requirements is stale, only its Purpose.

D3. Item 2 stays in scope (3-line production diff, Haiku-sized). Delete `case "markdown"` from `fieldMappingForKind`
so markdown falls to `default: return {}`, drop the now-unused `readMarkdownConfig` import, and add a comment.
This is NOT "no behaviour change": for a legacy stored `fieldMapping` it flips the result true -> false (a markdown
Output renders no rows, so being a cross-filter target only caused a capabilities fetch / filter request and a
possible loaded-rows disclosure, never different content). Consistent with HEL-1139's owner ruling ("no data
binding of any kind"); no product call needed.

D4. Test labelling (honest): T1 legacy-mapping test = RED-FIRST (must fail on pre-change code; transcript
captured). T2 empty-mapping test = GUARD (passes before and after). T3 render test (markdown Output with a stored
legacy `fieldMapping` renders literal `config.content`) = GUARD backing the new spec scenario; mutation: change
`cfg.content` to `""` in OutputPanelContent.tsx:239 temporarily, T3 must fail, then revert. The existing test
"markdown/collection/timeline all read fieldMapping the same way" asserts markdown===true; it is updated (markdown
assertion removed) — that it goes red on the change is itself proof the change is real.

## Verification ledger (claim -> command; executor pastes output into evidence.md)

V1 `grep -n "isMarkdownPanel(panel)" frontend/src/features/panels/ui/PanelContent.tsx`
V2 `sed -n 237,239p frontend/src/features/panels/ui/OutputPanelContent.tsx`
V3 `grep -n "final case class MarkdownPanelConfig" backend/src/main/scala/com/helio/domain/panels/MarkdownPanel.scala`
V4 `sed -n 97,106p backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala`
V5 `sed -n 327,328p backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala`
V6 `sed -n 558,563p backend/src/main/resources/db/migration/V94__outputs_model.sql`
V7 `grep -n "No content yet" frontend/src/features/panels/ui/MarkdownPanel.tsx`
V8 `grep -rn "readMarkdownConfig" frontend/src --include=*.ts --include=*.tsx` (after: no hit in crossFilterRows.ts)
V10 `grep -rn "isPanelFilterableByDimension(" frontend/src --include=*.ts --include=*.tsx | grep -v test` (every caller gates
   target status on it — OutputPanelContent.tsx:131, useCrossFilteredPanelData.ts:76, useCrossFilterServerOps.ts:60)
V11 `sed -n 283p frontend/src/features/panels/ui/OutputPanelContent.tsx` (the only cross-filter disclosure; gated on
   `isCrossFiltered`, which requires target status)
V9 `grep -rn -i "datatype\|bound/authored\|content binding\|Source/Static\|bound-over-literal" openspec/specs/markdown-panel openspec/specs/markdown-panel-content-source openspec/changes/markdown-spec-literal-content/specs`
   (after archive: expected remaining hits ONLY the two verbatim mcp scenarios listed as follow-ups, which this
   grep does not cover because it excludes mcp-panel-composition-tools canonical file.)

## Risks / Trade-offs

- [MODIFIED/REMOVED header mismatch aborts archive] -> headers copied byte-exact; `openspec validate --strict` passes.
- [Kept verbatim stale DataType text inside the MODIFIED mcp block] -> intentional (D1, minimal diff), listed as a
  follow-up in proposal Non-goals; not a new claim.

## Planner Notes

Design gate round 1 (REFUTE) addressed: ADDED `panel-cross-filtering` requirement "A markdown Output panel is never
a cross-filter target" (the behaviour change now has a spec); exact mutation procedure; exact text moved to fenced
blocks E1-E4. The orchestrator (not the executor) files the Non-goals follow-up ticket at Delivery.
Self-approved: keeping item 2 in scope (D3); filling markdown-panel's `TBD` Purpose (adjacent, same file);
correcting the placeholder example text to the real string (V7).

## Exact text (copy verbatim — the fenced content only, no fences; tasks.md references E1-E5)

E1 — new Purpose body line for `openspec/specs/markdown-panel/spec.md`:

```
Defines how a literal markdown panel stores and updates its CommonMark `config.content` and renders it as read-only
HTML in the dashboard grid; markdown content is never resolved from a data field.
```

E2 — new Purpose body line for `openspec/specs/markdown-panel-content-source/spec.md`:

```
Defines the `helio://uploads/image/<id>` reference scheme that resolves uploaded images in rendered Markdown through the uploads route, how rendered images are constrained to the panel, and where the scheme is documented.
```

E3 — new Purpose body (3 lines, replacing the current 4) for `openspec/specs/mcp-panel-composition-tools/spec.md`:

```
Give the MCP agent surface v1.5 panel parity — letting an agent create every current panel type, author literal
text/markdown panel content, set chart type and per-type chart/table config, and upload images — so agents can
build dashboards with the full panel capability set the backend already supports.
```

E4 — comment lines for the JSDoc above `fieldMappingForKind` in crossFilterRows.ts. That JSDoc's last line ends
`never matches any dimension. */`: change it to end `never matches any dimension.` (drop ` */`), add the 4 lines
below after it, then a line `*/` indented with one space (` */`):

```
 *  `markdown` is deliberately absent (HEL-1405): a markdown Output has no
 *  data binding (HEL-1139) and renders no rows, so a legacy stored
 *  `fieldMapping` (V94) must never make it a cross-filter target -- it
 *  falls to the empty default.
```
