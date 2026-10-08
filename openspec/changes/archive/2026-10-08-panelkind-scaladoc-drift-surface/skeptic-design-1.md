## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `2dd4ed6237817b1feef22d69f8bc8058e58541db` (= origin/main; change dir untracked).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/panelkind-scaladoc-drift-surface/HEL-1156`.

### What I verified (with evidence)

- **P1–P9 re-run myself, all match the design's stated outputs:** P1 one hit,
  `PanelConfigCodec.scala:58` (error message only); P2 `PanelRepository.scala:29: PanelRowMapper.rowToDomain(row)`;
  P3 `37: row.kind match {`, `48: case _ =>`, `49- OutputPanel(...)`; P4 `model.scala:159`; P5 counts 8,3,2,2,2,2;
  P6 lines 4/22/23; P7 `194:` and `157:`; P8 `60:`; P9 `220:` and `318:`.
- **Claims not covered by P1–P10, checked separately:**
  - `PanelKind.All`/`parseKind`/`companionFor` have zero consumers in `backend/src/main` outside Panel.scala
    (`git grep -n -E "PanelKind\.(All|parseKind)|\bparseKind\(|companionFor|\bRegistry\b"`, panel hits = only
    PanelConfigCodec:58). "only" in E3/E4 holds.
  - The DB discriminator really is `panels.kind` (PanelRowMapper.scala:31-36 comment: `type`/`type_id` retired, `kind` NOT NULL). E2 holds.
  - `PanelConfigCodec` hand-enumerates (`encodeConfig` match, `decodeCreateConfig` match); `PanelRepository.configColumnsOf`
    at :330; `PanelServiceHelpers.buildNewPanel` at :130. E1/E4 layer list holds.
  - `check-schema-drift.mjs` compares schema files and helio-mcp `proposal.ts`/`proposalValidation.ts` sets. E4 "several schema / helio-mcp enums" holds.
  - `.openspec.yaml` has `skip_specs: true`; `openspec validate ... --type change` → `Change 'panelkind-scaladoc-drift-surface' is valid`.
- **OLD blocks:** applied E1–E4 by script to a scratch copy (scratchpad `sk/apply.py`), each OLD block counted
  exactly 1 occurrence in the live Panel.scala (`E1 count 1` … `E4 count 1`). No NEW text contains `/*` or `*/`
  (I checked, since Scala allows nested comments).
- **AC proofs on the scratch result:** AC1 control `1`, post-edit no output, exit 1. AC2: `1`, `1`, line 126, line 127.
  Overclaim regex: control `3`, post-edit exit 1. AC3 filter on a scratch git repo: no output, exit 1. **Negative control**
  (I changed one code line, `keySet` → `keySet.toSet`): the filter printed both lines, exit 0, so it is not vacuous.
- **Scope:** AC1–3 are covered by tasks 2.1–2.3. D1's extra header and Registry fixes stay inside the same file and are comment-only. The non-goals are sound.

### Verdict: REFUTE

The defect is in the E4 text itself. The ticket exists so that a reader stops under-enumerating the drift surface.
The comment's own re-derive recipe under-enumerates it, and P10 checks only a count, which cannot catch this.

Evidence: `git grep -l -i '"divider"' -- backend/src/main frontend/src helio-mcp/src schemas | grep -v -i test`
returns 16 files. That list leaves out 10 of the sites E4 names, or that the spec section names:

```
PanelConfigCodec quoted=0 unquoted=1
PanelServiceHelpers quoted=0 unquoted=1
PanelRowMapper quoted=0 unquoted=1          <- the very silent-fallthrough site E4 cites
PanelRepository.scala quoted=0 unquoted=1
DashboardSnapshotRepository quoted=0 unquoted=1
AssistantProposalToolSchemas quoted=0 unquoted=1
dashboard-proposal.schema quoted=0 unquoted=1
helio-mcp/src/tools/proposal.ts quoted=0 unquoted=1
PanelContent.tsx quoted=0 unquoted=1
PanelDetailModal.tsx quoted=0 unquoted=1
```

There are two reasons the quoted pattern misses them. Backend sites match on `DividerPanel.Kind` or `DividerPanel`
rather than the string literal. And `divider` is deliberately excluded from the proposal surfaces (create_panel enum,
dashboard-proposal schema, helio-mcp proposal.ts), so no quoted `"divider"` exists there. Anyone who follows the
comment's "e.g." command gets a list that silently drops most of the backend.

### Change Requests

1. **design.md E4: replace the re-derive command** with one whose output covers every site E4 names. Use
   case-insensitive *unquoted* `divider` (64 files, which covers all 10 above plus PanelPacker), or better, a
   two-kind pattern that also catches proposal-only surfaces, since divider is excluded there. For example:
   `git grep -l -i -E 'divider|FormPanel|"form"' -- backend/src/main frontend/src helio-mcp/src schemas`
   (87 files on 2dd4ed62). Add one clause saying divider is absent from proposal surfaces, so a second kind is needed.
   The replacement text must not contain `/*` or `*/`, because it sits inside a scaladoc and Scala nests comments.
2. **design.md P10 / tasks 2.4: replace the count-only P10 with a coverage proof.** For each site named in E4
   (PanelConfigCodec, PanelServiceHelpers, PanelRowMapper, PanelRepository, DashboardSnapshotRepository,
   ProposalPanelSupport, AssistantProposalToolSchemas, dashboard-proposal.schema.json, helio-mcp, frontend panel.ts),
   assert that the new recipe's `-l` output contains it. Include a negative control showing the old quoted
   `'"divider"'` recipe misses `PanelRowMapper.scala`.
3. **tasks.md 2.2: two of the four overclaim-regex alternatives are dead.** `every\s+protocol` and
   `dispatches on .panels\.type.` never match on origin/main, because grep is line-based and both phrases wrap
   across lines 83/84 and 37/38. The control `3` comes entirely from lines 26, 83 and 85. As written, the regex
   does not prove that E2's "via the registry" claim or E3's "derives from this Map" claim is gone. Replace those
   alternatives with single-line patterns that match today, e.g. `derives from this Map`, `round-trip through the`,
   `typed subtype via the registry`, then re-derive and restate the control count.

### Non-blocking notes

- E1 says the registry is the source of truth for `All`/`parseKind` "only", while E3 also lists `companionFor`. Consider listing `companionFor` in E1 too, so the two comments agree.
- `PanelKind`'s object scaladoc (Panel.scala:106) says "Source of truth for the panel-type discriminator string", while `PanelType` in model.scala is a separate hand list. Consider softening it in the same change, since D1 is fixing every overclaim in the file.
- `PanelConfigCodec.scala:8-14` makes its own "single source of truth … centralised in one file" overclaim. It is a different file and out of scope for AC3, so treat it as a candidate follow-up, like PipelineStep.
- E4's list omits `PanelPacker.ClampBounds` and `DashboardProposalService.DataPanelKinds`. That is acceptable under D2 (no completeness claim), but only once CR1's recipe actually finds them.
