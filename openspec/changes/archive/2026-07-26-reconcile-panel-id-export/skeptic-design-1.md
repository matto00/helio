## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **Core identity claim ("same id, two labels") — TRUE, verified in code, not just trusted from
   planning artifacts.**
   - `DashboardSnapshotPanelEntry.fromDomain` sets `snapshotId = panel.id.value`
     (`backend/src/main/scala/com/helio/api/protocols/DashboardProtocol.scala:158-160`).
   - `PanelResponse.fromDomain` sets `id = panel.id.value`
     (`backend/src/main/scala/com/helio/api/protocols/PanelProtocol.scala:112-114`).
   - Both derive from the identical domain value `panel.id.value`. Confirmed: this is one
     identity under two wire labels, not two competing concepts. The design's D1 premise holds.

2. **Import path keys exclusively off `snapshotId`, never a real/live id — verified.**
   - `backend/src/main/scala/com/helio/infrastructure/DashboardSnapshotRepository.scala:140`
     (`idMap = payload.panels.map(p => p.snapshotId -> UUID.randomUUID().toString).toMap`) and
     line 171 (`idMap(entry.snapshotId)`).
   - `backend/src/main/scala/com/helio/services/DashboardServiceValidation.scala:55,61,71-72`
     — all pattern-match/reference `entry.snapshotId` only.
   - No code path reads a would-be `id` field on import. Adding an additive `Option[String] id`
     is confirmed inert to the import/remap contract, as claimed.

3. **`DashboardSnapshotPanelEntry` current shape confirmed**: `snapshotId, title, type,
   appearance, config` (5 fields, `jsonFormat5` at `DashboardProtocol.scala:212`) — matches
   task 1.1's plan to bump to `jsonFormat6`.

4. **MCP `get_dashboard` verbatim-passthrough claim (D5) — verified.**
   `helio-mcp/src/helioApi.ts:172`: `return { ...record, panels: snapshot.panels }` — no
   per-field remapping. `helio-mcp/src/types.ts:52-58` (`SnapshotPanelEntry`) already mirrors
   the real `type`/`config` wire shape correctly (not the stale `typeId`/`fieldMapping` shape —
   see item 6). Confirms D5: only a type-mirror + description-string edit is needed, no MCP
   transformation logic.

5. **Backward-compat mechanism (`Option[String]`, no version bump) is sound and matches
   existing codebase convention.** Widespread precedent for `Option[String]` fields decoding
   absent keys to `None` via `DefaultJsonProtocol`/`jsonFormatN` elsewhere in the protocol
   layer (e.g. `AuthProtocol.scala`). `CurrentVersion = 2` (`DashboardProtocol.scala:178`)
   remains untouched by this change's additive field, consistent with D3's reasoning.

6. **Pre-existing spec/impl drift, correctly scoped out — but re-asserted, not fixed, in the
   very sentence the delta edits.** Confirmed the *baseline* spec
   (`openspec/specs/dashboard-export-import/spec.md`) already states the export panels array
   carries `snapshotId, title, type, appearance, typeId, and fieldMapping` — stale versus the
   real code shape (`type` + `config`, no `typeId`/`fieldMapping`, post CS2c-3c). The proposed
   delta (`specs/dashboard-export-import/spec.md:4`) edits this exact sentence to add
   `snapshotId, id, ...` but leaves `typeId`/`fieldMapping` in place uncorrected. design.md's
   Non-Goals section explicitly discloses this as known, pre-existing, out-of-scope drift — a
   reasoned, self-approved call, not an oversight. Non-blocking per instructions (pure
   consistency nit on an already-decided, disclosed non-goal) — noted below, not a Change
   Request.

7. **Scope discipline (HEL-369, HEL-624) — clean.** Grepped all planning artifacts;
   `HEL-369`/`HEL-624`/"external-run"/"pie"/"scatter"/"aggregation" appear only in the explicit
   Non-Goals/Out-of-scope disclaimers, never as work items. No code changes exist yet (design
   gate, `git log` shows only the planning commit `91a54f02` after `d4104b94`).

8. **`schemas/` non-goal (D4) verified**: no `schemas/*.schema.json` file references
   `snapshotId`/`DashboardSnapshot`; `check-schema-drift.mjs` has no matching class to compare.
   Consistent with "don't add a schema for a class the drift tool doesn't track."

9. **Frontend impact claim (pure type-only, no behavior change) verified**: grepped
   `frontend/src/features/dashboards/` — no code outside `types/dashboard.ts` references
   `snapshotId` or `DashboardSnapshotPanelEntry`; confirms it's a download/upload pass-through
   with no logic branching on the field.

10. **AC traceability** — all 5 ticket ACs map to concrete tasks: AC1→1.1/2.1/2.2, AC2→1.2/5.3,
    AC3→1.1/5.1, AC4→5.1-5.4, AC5 (helio-news simplification) correctly deferred as a spinoff
    since `helio-news` lives outside this monorepo (`~/Development/helio-news`), consistent
    with the ticket's own "could be simplified" (descriptive, not a mandate) phrasing and D6.

11. **Spec delta format** — correctly uses `## MODIFIED Requirements` against the two
    requirements actually touched (Export/Import endpoints), openspec convention respected.

### Verdict: CONFIRM

The central design question the human flagged — same identity vs. genuinely different
concepts — is independently confirmed true from the actual code, not merely asserted by the
planning artifacts. The backward-compat mechanism, MCP wiring claim, and scope boundaries all
check out against ground truth. No placeholders, no contradictions between proposal/design/
tasks, no ambiguous task a competent implementer could misread.

### Non-blocking notes

- `specs/dashboard-export-import/spec.md:4` still lists `typeId`/`fieldMapping` as export panel
  fields, which is stale versus the real wire shape (`type` + `config`). This predates this
  change and design.md explicitly discloses it as an intentionally-deferred non-goal — but
  since the executor is already editing this exact sentence to add `snapshotId`/`id`, consider
  a one-line opportunistic fix (swap `typeId, and fieldMapping` for `and config`) while in
  there. Not required; leaving it is a defensible, disclosed scope call.
