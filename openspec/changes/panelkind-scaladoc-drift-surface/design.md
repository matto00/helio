## Context

Ground truth on `origin/main` `2dd4ed62`, each verified by the orchestrator before planning (commands in "Claim → proof"
below; every one was run and its output recorded here):

- `Panel.scala:120-121`: `PanelKind.All` scaladoc says "adding a new kind only requires updating [[Panel.Registry]]".
- `Panel.scala:83-86`: `Panel.Registry` scaladoc says "every protocol / repo / service / snapshot dispatcher derives from
  this Map" and "Adding an 8th panel kind means dropping in one `panels/<Kind>Panel.scala` file and adding one line here".
- `Panel.scala:24-27` and `:35-37` (header of `trait Panel`): "only kinds registered there round-trip through the
  protocol / repo / service" and "`PanelRepository.rowToDomain` dispatches on `panels.type` → typed subtype via the
  registry".
- Reality: outside `Panel.scala`, the only reference in `backend/src/main` to `Panel.Registry`/`Panel.companionFor` is
  `PanelConfigCodec.scala:58`, which reads `Registry.keySet` to format an error message. `PanelRepository.rowToDomain`
  (`:28-29`) delegates to `PanelRowMapper.rowToDomain`, a hand-written `row.kind match` (`:37`) whose `case _ =>`
  (`:48-49`) silently builds an `OutputPanel`.
- The spec paragraph "**Drift surface for a new panel kind**" exists at
  `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md:194`, inside `### 2 — Form panel` (`:157`).
  It is a bold paragraph, not a heading, and is explicitly "not authoritative; re-derive before relying on it".
- The tree has grown sites the spec's list omits (`ProposalPanelSupport.scala`, `MobilePanelStack.tsx`, helio-mcp
  `helioApi.ts`/`placements.ts`/`placementsHandlers.ts`, `schemas/panels/*-batch-request.schema.json`), so the comment
  must NOT claim a count or a complete list; it names layers and points at the re-derive recipe.
- Gates: `PanelSpec.scala:59-60` pins `Panel.Registry.keySet` to a hardcoded set (fires when registry and test disagree,
  not on a missed hand site). `scripts/check-schema-drift.mjs` parses `PanelType.fromString` (`:220`) and compares
  several schema / helio-mcp / frontend enums (`:269`, `:318`, ...) against it.

## Goals / Non-Goals

**Goals:** every scaladoc in `Panel.scala` that claims the registry drives more than `All`/`parseKind`/`companionFor` is
corrected; `PanelKind.All` points at the spec paragraph and a re-derive command. **Non-goals:** see proposal.md.

## Decisions

- D1: Fix all five overclaiming comment blocks in `Panel.scala`, not only `:120-121`: the ticket asks to check the
  `Registry` doc; the `trait Panel` header (E1, E2) and the `object PanelKind` doc (E5, "Source of truth for the
  panel-type discriminator string" while `PanelType` keeps its own list) make the same claim in the same file. All five
  are comment-only, satisfying AC3. E1/E3 agree: the registry feeds `All`, `parseKind` and `companionFor`.
- D1a (design-gate r1): the re-derive recipe is the UNQUOTED `git grep -l -i divider` — the quoted `'"divider"'` form
  misses every backend site that matches on `DividerPanel.Kind` (incl. `PanelRowMapper`) and the proposal surfaces
  that deliberately exclude divider. P10 proves coverage of every named site plus a negative control.
- D2: No count ("~20", "22") and no claim of completeness in the comment — counts rot; the spec list is already stale
  against the tree. Name layers + give the re-derive command instead.
- D3: Say "Known gates" rather than "the only gates": two gates are verified, but proving no other gate exists (e.g. a
  TypeScript exhaustiveness error in some frontend switch) is out of reach for a comment change.
- D4: Do not link the spec with a Markdown anchor — it is a bold paragraph, not a heading; cite it by quoted name + §2 +
  path.
- D5: `skip_specs: true` — no behaviour/contract change, so no spec delta. Alternative (a MODIFIED delta on
  `form-panel-type`) rejected: that spec's registry scenario is true and unaffected.

## Exact edits (apply verbatim; each OLD block occurs exactly once in Panel.scala)

Indentation and the ` *` / `   *` scaladoc gutters must be reproduced exactly. Only comment lines change.

### E1 — `trait Panel` header, the "Discipline is enforced via" paragraph

OLD (must match exactly once):

```
 *  refactor (the CS2c-3a cycle-3 lesson). Discipline is enforced via
 *  [[Panel.Registry]] — only kinds registered there round-trip through the
 *  protocol / repo / service. Adding an 8th panel kind without updating
 *  the registry is caught by the kind-set parity test in `PanelSpec`.
```

NEW:

```
 *  refactor (the CS2c-3a cycle-3 lesson). [[Panel.Registry]] is the source
 *  of truth for [[PanelKind.All]], [[PanelKind.parseKind]] and
 *  [[Panel.companionFor]] only: the codec, service, persistence, JSON-schema,
 *  helio-mcp and frontend layers each enumerate kinds by hand (see
 *  [[PanelKind.All]] for that drift surface).
 *  The kind-set parity test in `PanelSpec` pins the registry's key set; it
 *  does not detect a missed hand-enumerated site.
```

### E2 — `trait Panel` header, the closing "DB shape" paragraph

OLD (must match exactly once):

```
 *  DB shape (unchanged): the `panels` table preserves all 8 per-subtype
 *  nullable columns; `PanelRepository.rowToDomain` dispatches on
 *  `panels.type` → typed subtype via the registry. */
```

NEW:

```
 *  DB shape: `PanelRepository.rowToDomain` delegates to
 *  `PanelRowMapper.rowToDomain`, which dispatches on `panels.kind` with a
 *  hand-written match — NOT via the registry — and silently falls back to
 *  `OutputPanel` for an unrecognised kind. */
```

### E3 — `Panel.Registry` scaladoc

OLD (must match exactly once):

```
  /** Registry of every panel kind. Single source of truth — every
   *  protocol / repo / service / snapshot dispatcher derives from this Map.
   *  Adding an 8th panel kind means dropping in one `panels/<Kind>Panel.scala`
   *  file and adding one line here. */
```

NEW:

```
  /** Registry of every panel kind (kind string → [[Companion]]). The source
   *  of truth for [[PanelKind.All]], [[PanelKind.parseKind]] and
   *  [[companionFor]] only — no codec, repo, service or snapshot dispatcher
   *  dispatches through this Map (`PanelConfigCodec` reads its key set only
   *  for an error message). Adding a kind means a new
   *  `panels/<Kind>Panel.scala` file, one line here, AND every hand-enumerated
   *  site described on [[PanelKind.All]]. */
```

### E4 — `PanelKind.All` scaladoc

OLD (must match exactly once):

```
  /** Registry-derived allow-list. After cycle 1 no consumer enumerates these
   *  manually — adding a new kind only requires updating [[Panel.Registry]]. */
```

NEW:

```
  /** Registry-derived allow-list: the source of truth for [[parseKind]] and
   *  this set ONLY. Adding a kind also requires hand-enumerating many further
   *  sites — `PanelType` (model.scala, incl. its "Valid values" literal),
   *  `PanelConfigCodec`, `PanelServiceHelpers.buildNewPanel`, `PanelRowMapper`,
   *  `PanelRepository`'s config columns, `DashboardSnapshotRepository`,
   *  `ProposalPanelSupport`, `AssistantProposalToolSchemas`, `schemas/panels/`
   *  and `schemas/dashboards/dashboard-proposal.schema.json`, helio-mcp, and
   *  the frontend kind unions and if-chains — plus a migration that drops and
   *  re-adds `panels_kind_check` (precedent: V108). The documented list is the
   *  "Drift surface for a new panel kind" paragraph in §2 of
   *  docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md.
   *  That list is a dated snapshot: re-derive from the tree, e.g.
   *  `git grep -l -i divider -- backend/src/main frontend/src helio-mcp/src schemas`
   *  (unquoted: backend sites match on `DividerPanel.Kind`, not the string).
   *  Known gates: `PanelSpec` pins the registry key set, and
   *  scripts/check-schema-drift.mjs checks several schema / helio-mcp enums
   *  against `PanelType.fromString`; many other sites fall through silently
   *  (e.g. `PanelRowMapper.rowToDomain`'s `case _ =>` → `OutputPanel`). */
```

### E5 — `object PanelKind` scaladoc

OLD (must match exactly once):

```
/** Source of truth for the panel-type discriminator string. Constants here
 *  are exported by each panel file (as `<Kind>Panel.Kind`); [[All]] is
 *  derived from the registry so the allow-list cannot drift from the
 *  actual set of registered kinds. */
```

NEW:

```
/** The panel-type discriminator strings. Constants here are exported by
 *  each panel file (as `<Kind>Panel.Kind`); [[All]] is derived from the
 *  registry so this allow-list cannot drift from the registered kinds. It
 *  is not the only list: `PanelType` (model.scala) and the other sites
 *  described on [[All]] enumerate kinds by hand. */
```

## Claim → proof (run from the worktree root; expected output in the comment above each command)

```bash
cd /home/matt/Development/helio/.claude/worktrees/task/panelkind-scaladoc-drift-surface/HEL-1156

# P1 — nothing outside Panel.scala dispatches through the Registry; PanelConfigCodec reads keySet only for an error message.
# Expected: exactly 1 line, backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala:58: ... Valid values: ${Panel.Registry.keySet...
git grep -n -E "Panel\.Registry|Panel\.companionFor" -- backend/src/main | grep -v "domain/model/Panel.scala"

# P2 — PanelRepository.rowToDomain delegates to PanelRowMapper.rowToDomain.  Expected: exactly 1 line, backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRepository.scala:29:    PanelRowMapper.rowToDomain(row)
grep -n "PanelRowMapper.rowToDomain(row)" backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRowMapper.scala backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRepository.scala

# P3 — hand-written match on panels.kind with a silent OutputPanel fallback.
# Expected: 37:    row.kind match {      then   48:      case _ =>   and   49-        OutputPanel(id, ...
grep -n "row.kind match" backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRowMapper.scala
grep -n -A1 "case _ =>" backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRowMapper.scala | head -2

# P4 — PanelType's hand-written "Valid values" literal.  Expected: 1 hit, line 159
grep -n "Valid values: text, markdown, image, divider, output, form" backend/src/main/scala/com/helio/domain/model/model.scala

# P5 — each named backend file enumerates kinds by hand.  Expected counts: 8, 3, 2, 2, 2, 2 (each >= 1)
for f in backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala backend/src/main/scala/com/helio/services/panels/PanelServiceHelpers.scala backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRepository.scala backend/src/main/scala/com/helio/infrastructure/persistence/dashboards/DashboardSnapshotRepository.scala backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala; do echo "$f $(grep -c -E 'DividerPanel|"divider"|DividerCreate|FormPanel|"form"' "$f")"; done

# P6 — the migration drops and re-adds panels_kind_check; precedent V108.
# Expected: lines 4, 22 (DROP CONSTRAINT panels_kind_check,), 23 (ADD CONSTRAINT panels_kind_check)
grep -n "panels_kind_check" backend/src/main/resources/db/migration/V108__add_form_panel_kind.sql

# P7 — the spec paragraph exists, inside §2.  Expected: 194:**Drift surface for a new panel kind** (as of ...   and   157:### 2 — Form panel
grep -n "Drift surface for a new panel kind" docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md
grep -n "^### 2 — Form panel" docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md

# P8 — PanelSpec pins the registry key set.  Expected: 60:      Panel.Registry.keySet shouldBe Set(
grep -n "Panel.Registry.keySet shouldBe" backend/src/test/scala/com/helio/domain/model/PanelSpec.scala

# P9 — check-schema-drift.mjs compares enums against PanelType.fromString.
# Expected: 220:  "def fromString(s: String)",   and   318:panelTypeSurfaces.push({
grep -n -E '"def fromString\(s: String\)"|panelTypeSurfaces\.push' scripts/check-schema-drift.mjs

# P10 — the re-derive recipe quoted in E4 finds EVERY site E4 names. Expected: each line ends in " 1" (schemas/panels/ ends in " 4").
mkdir -p /tmp/claude-1000 && git grep -l -i divider -- backend/src/main frontend/src helio-mcp/src schemas > /tmp/claude-1000/hel1156-recipe.txt
for s in PanelConfigCodec.scala PanelServiceHelpers.scala PanelRowMapper.scala PanelRepository.scala DashboardSnapshotRepository.scala ProposalPanelSupport.scala AssistantProposalToolSchemas.scala model/model.scala schemas/panels/ dashboard-proposal.schema.json helio-mcp/src/tools/proposal.ts helio-mcp/src/tools/write.ts frontend/src/features/panels/types/panel.ts PanelContent.tsx PanelDetailModal.tsx mobilePanelHeights.ts panelNarrowing.ts OutputPicker.tsx; do echo "$s $(grep -c -F "$s" /tmp/claude-1000/hel1156-recipe.txt)"; done
# P10 negative control — the OLD quoted recipe misses PanelRowMapper.scala. Expected: 0
git grep -l -i '"divider"' -- backend/src/main frontend/src helio-mcp/src schemas | grep -c PanelRowMapper.scala
```

## Risks / Trade-offs

- A long scaladoc can itself rot. Mitigated by D2 (no count, no completeness claim) and the explicit "dated snapshot:
  re-derive" instruction.
