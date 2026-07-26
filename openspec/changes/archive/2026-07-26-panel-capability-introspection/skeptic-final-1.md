## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Read all planning artifacts fresh**: `ticket.md` (6 ACs + 5 pre-brief concerns), `proposal.md`,
   `design.md` (D1-D6), `specs/panel-capability-introspection/spec.md`, `tasks.md` (15/15 checked).

2. **AC1 (numeric multi-row → chart/table/metric/collection bindable)**: read
   `PanelCapabilityService.scala:47-118` and `PanelBindingSpec.scala:56-105` directly. `capabilityFor`
   marks `bindable=true` when every required slot has ≥1 eligible column; `PanelCapabilityServiceSpec.scala:110-154`
   exercises this with a real embedded-Postgres DataType (`revenue: float`, `region: string`) and asserts
   per-slot `eligibleColumns` contents, not just booleans. Ran the test myself — passes.

3. **AC2 / V41 companion text (exact match, not paraphrase)**: read `PanelService.scala:297-309`
   (`rejectCompanionBinding`) — the literal string is `"Panels can only bind to pipeline-output data types"`
   at line 306. `PanelCapabilityService.scala:29` (`NotPipelineOutputMessage`) has the byte-identical
   string. `PanelCapabilityServiceSpec.scala:199` asserts this exact string. Confirmed match myself, not
   trusting the evaluator's claim.

4. **AC3 (slot definitions from one source, cross-checked)**: read `frontend/src/features/panels/state/panelSlots.ts`
   directly — `PANEL_SLOTS.chart = {xAxis,yAxis,series}` and `PANEL_SLOTS.timeline = {time,event}` match
   `PanelBindingSpecSpec.scala:19,23` exactly. Read `frontend/src/features/panels/ui/editors/CollectionEditor.tsx`
   directly — line 35's doc comment claims "derived from `PANEL_SLOTS.metric`" but `grep PANEL_SLOTS` on the
   file returns only that one comment line; the component never imports `PANEL_SLOTS`. Lines 55-57
   (`initialFieldMapping.value/.label/.unit`) and 113-116 (`{value:...}/{label:...}/{unit:...}`) are the real
   hardcoded key set `{value,label,unit}`, which `PanelBindingSpecSpec.scala:30,56-59` transcribes correctly
   and cites accurately. This is a real, non-tautological cross-check — I independently confirmed the
   design.md D2 "correction" (CollectionEditor doesn't actually wire to PANEL_SLOTS) is true in the current tree.

5. **AC4 (shape signals)**: `PanelCapabilitiesResponse` (`PanelCapabilityProtocol.scala:55-62`) has
   `columns`, `rowCount`, `singleRow`, `isPipelineOutput` — all populated in `PanelCapabilityService.build`.

6. **AC5 (MCP tool)**: read `helio-mcp/src/tools/read.ts:121-142`, `helioApi.ts:217-224`, `types.ts:113-146`
   directly. The tool description accurately states the five panel kinds, each kind's slots, eligibility
   rules, and the V41 semantics — an agent reading only the description would build a correct offers menu.
   Ran `npm run typecheck` and `npm run build` in `helio-mcp/` myself — both clean.

7. **AC6 (test coverage)**: `PanelCapabilityServiceSpec.scala` covers numeric multi-row (5.1), single-numeric-column
   multi-row/no-row-gate (5.2), companion/V41 (5.3), timestamp/timeline (5.4), cross-tenant 404 (5.5, both
   service- and route-level in `DataTypeDataSourceAclSpec.scala:187-202`). `PanelBindingSpecSpec.scala`
   covers the drift cross-checks (5.6).

8. **Multi-tenancy**: read `DataTypeDataSourceAclSpec.scala:1-90` — `userA`/`userB` are genuinely distinct
   `AuthenticatedUser`s backed by real rows inserted into a real embedded-Postgres `users` table (not mocked
   or aliased). The new test block (lines 187-202) asserts 200 for the owner and 404 (not 403) for the
   cross-user caller. Confirmed `findByIdOwned` is the lookup path in `PanelCapabilityService.scala:36` and
   that `ServiceError.NotFound` maps to `StatusCodes.NotFound` in `ServiceResponse.scala:61` (not a
   route-level 403 anywhere in the new code).

9. **HEL-624 honesty**: grepped `aggregat|bar|line|scatter|pie` across every new backend/schema/MCP file
   touched by this change — zero hits inside the panel-capability response code, schema, or MCP tool
   description (the unrelated hits in `types.ts`/`read.ts` are pre-existing pipeline-shape/panel-config
   types, not part of this response). Confirms D4: the gap is avoided by omission, not by an unstated
   assumption or a false claim.

10. **Scope discipline**: `git diff main...HEAD --stat` — zero `frontend/**` files touched; all touched
    files are new (`PanelBindingSpec.scala`, `PanelCapabilityService.scala`, `PanelCapabilityProtocol.scala`,
    the schema, the MCP files) or minimal wiring diffs (`ApiRoutes.scala` +3 lines, `JsonProtocols.scala`
    +1 mixin, `DataTypeRoutes.scala` +1 route, two ACL/route test files updated only for the new constructor
    param + new test). Nothing resembling HEL-364 (compound bind), HEL-370 (batch create), HEL-366
    (tagging), HEL-367 (auto-pack), or HEL-368 (panel id key) is present.

11. **CONTRIBUTING.md compliance**: grepped `com\.helio\.` in the three new main-source files — every hit is
    a top-of-file `import` or a Scaladoc comment, none inline in executable code. File sizes: 105
    (`PanelBindingSpec.scala`), 128 (`PanelCapabilityService.scala`), 75 (`PanelCapabilityProtocol.scala`) —
    all under the 250-line soft budget; ran `node scripts/check-scala-quality.mjs` myself — 63 pre-existing
    warnings, none in the new files.

### Fresh gate re-runs (this session, not trusting prior reports)
- `sbt test` (full suite): **2081/2081 passed**, 0 failed.
- Targeted `sbt testOnly` on the four new/touched specs: **47/47 passed**.
- `npm test` (frontend): **137 suites / 1423 tests passed**.
- `npm run lint`: clean, 0 warnings.
- `npm run format:check`: clean.
- `node scripts/check-schema-drift.mjs`: clean (schema/case-class parity + panel-type enum parity).
- `node scripts/check-scala-quality.mjs`: clean (0 new violations).
- `helio-mcp`: `npm run typecheck` and `npm run build` both clean.
- No UI to verify — `git diff --stat` confirms zero `frontend/**` files touched; this is a backend + MCP
  read surface with no design-standard surface to judge.

### Verdict: CONFIRM

### Non-blocking notes
- `PanelCapabilityService.scala:44`'s `if (dataTypeRowRepo == null)` null-check is unusual Scala style but
  is documented as mirroring `DataTypeService.listRows`'s existing fixture-wiring pattern — consistent with
  the codebase, not worth blocking on.
- The `eligibleColumns`/`capabilities` type aliases (`PanelCapabilityResponse.EligibleColumns`,
  `PanelCapabilitiesResponse.Capabilities`) exist specifically to dodge `check-schema-drift.mjs`'s
  comma-split parser limitation — a reasonable, well-commented workaround, not a design smell.
