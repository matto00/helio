## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- Ticket ACs verified against implementation:
  1. `create-panel-request.schema.json` `type` enum already included `collection` (fixed by prior HEL-315); executor correctly confirmed rather than re-touched. Verified `POST /api/panels` with `type: "collection"` via live UI flow (Add panel → Collection → Start blank → bind data type → Create) produced `POST /api/panels => 201 Created`.
  2. Audit note present in `files-modified.md` and `proposal.md`'s audit table, covering every enumerating surface (4 JSON schemas, helio-mcp `proposal.ts` two consts, `ProposalReview.tsx`, `write.ts` explicitly marked out-of-scope with reason, OpenAPI n/a). The design-gate skeptic independently re-grepped twice (round 1 found a real gap — `ProposalReview.tsx` — round 2 confirmed the audit complete against a fresh independent grep) — both skeptic reports are in the change dir and both concerns from round 1 were resolved before round 2 CONFIRM.
  3. Contract test added: `ApiRoutesSpec.scala` new case "create a collection panel and return 201 with type echoed (HEL-310)" (ran directly: 4/4 collection-related tests pass, 178/178 full `ApiRoutesSpec` suite passes). Plus the static parity guard in `check-schema-drift.mjs` (verified below in Phase 2).
- Tasks.md: all 15 items marked `[x]`; each traced to an actual diff hunk (schema enum widenings, TS const widenings, drift-checker additions, tests). No task claimed done without corresponding code.
- No scope creep: diff touches exactly the files named in `files-modified.md` plus the change's own planning artifacts; no unrelated refactors.
- No regressions: `write.ts` (deliberate `divider` omission) correctly left untouched and explicitly called out as out-of-scope, not silently skipped.
- API contracts: two JSON schemas widened additively (non-breaking); `dashboard-proposal.schema.json`'s `dataTypeId` description updated to mention `collection` alongside metric/chart/table, consistent with backend `DataPanelKinds`.
- Planning artifacts (proposal/design/tasks/spec.md) match the final implementation — cross-checked file-by-file, no drift between plan and diff.

### Phase 2: Code Review — PASS
Issues: none.

- **Canonical code-quality compliance**: `npm run check:scala-quality` → "Scala code-quality check: clean" (0 FQN violations introduced by this diff; existing file-size soft-budget warnings are pre-existing and informational per `CONTRIBUTING.md:123`). No new inline FQNs in the Scala test addition (`ApiRoutesSpec.scala`) — uses existing top-of-file imports.
- **DRY**: the drift-checker extension reuses the file's existing `extractQuoted`/regex-extraction idiom (matches the pre-existing `parseCaseClasses` pattern) rather than introducing a new parsing mechanism; `compareSets`/`getEnumAt`/`extractBetween` are small, single-purpose helpers not duplicated elsewhere in the script.
- **Readable**: canonical-set extraction is narrowly scoped (`case "x" => Right` arms, excluding the `other` fallback) with a defensive `>= 8 types` assertion (`scripts/check-schema-drift.mjs:186-193`) that fails loudly rather than silently under-matching if `PanelType.fromString` is reformatted.
- **Modular**: guard logic is additive to the existing zero-dep checker (per design.md's explicit decision to avoid a second script/new dependency); each surface is declared as a data entry in `panelTypeSurfaces`/`dataPanelTypeSurfaces` arrays rather than repeated conditional logic.
- **Type safety**: TS changes (`proposal.ts`, `ProposalReview.tsx`) are typed `Set`/`as const` array widenings, no `any` introduced; `helio-mcp/src/tools/proposal.ts`'s zod schema still type-checks (`npm run build` in `helio-mcp/` succeeds — confirmed independently).
- **Error handling**: the drift checker's new failure path reuses the existing `errors[]` accumulation + `process.exit(1)` pattern, with an added actionable hint ("For panel-type enum mismatches, widen the diverging surface to match the backend canonical set...").
- **Tests meaningful**: independently re-verified the new backend contract test is real coverage (ran `sbt "testOnly com.helio.api.ApiRoutesSpec -- -z collection"` — 4/4 pass) and the new frontend test asserts the actual regression this ticket exists to prevent (`ProposalReview.test.tsx`: unbound collection panel → "No DataType bound" warning visible; ran directly, 7/7 pass in that file). Both would catch a real regression: reverting either enum change causes the corresponding test to fail (verified by direct probe below, not just trusting the report).
- **No dead code**: no unused imports, no leftover TODO/FIXME in the diff.
- **No over-engineering**: guard scope matches exactly what the design/ticket calls for (4 schemas + 3 TS consts); `write.ts` correctly excluded rather than forced into an exact-match assertion that would be wrong by design (documented `divider` omission).
- **Drift-guard genuinely fails on drift** (the specific concern flagged by the orchestrator) — independently probed three ways, not trusting the executor's self-reported probe in `files-modified.md`:
  1. Removed `collection` from `schemas/panel.schema.json` → `npm run check:schemas` exit code **1**, correct file+pointer reported (`schemas/panel.schema.json properties.type.enum: missing: collection`). Restored via `git checkout`.
  2. Removed `collection` from `frontend/src/features/dashboards/ui/ProposalReview.tsx`'s `DATA_PANEL_TYPES` (the surface this ticket newly adds to guard scope) → exit code **1**, correctly reported `frontend/.../ProposalReview.tsx DATA_PANEL_TYPES: missing: collection`. Restored.
  3. Confirmed clean state passes: `npm run check:schemas` on unmodified tree → exit 0, reports "panel-type enums in sync with backend canonical sets (7 surfaces checked)" (4 schemas + helio-mcp `PANEL_TYPES` + helio-mcp `DATA_PANEL_TYPES` + `ProposalReview.tsx` `DATA_PANEL_TYPES` = 7, matches expected surface count).

### Phase 3: UI Review — PASS
Issues: none.

Triggers matched: `frontend/**` (`ProposalReview.tsx`, `ProposalReview.test.tsx`), `schemas/**`, `openspec/specs/**`.

Dev servers started via `scripts/concertino/start-servers.sh` and `assert-phase.sh servers` → both PASS.

- **Happy path**: created a `type: "collection"` panel through the live UI (Add panel → "Collection" panel type → "Start blank" template → bind an existing pipeline-output DataType → title → "Create panel"). Network trace confirmed `POST http://localhost:5483/api/panels => 201 Created`, panel rendered on the grid with the `collection` type badge visible in the panel footer. No console errors during the flow (0 errors, 3 pre-existing dev-mode warnings unrelated to this change, present before any interaction).
- **Unhappy/empty states**: bound data type had no matching rows for this panel's config, and the panel correctly rendered its existing "No data" tile placeholders rather than blank/crashing — pre-existing behavior, not something this change touches or regresses.
- **No console errors**: confirmed via `browser_console_messages(level: "error")` throughout — 0 errors at every checkpoint.
- **Entry points**: verified the one relevant entry point (panel-creation modal's type picker) already surfaced "Collection" pre-change (non-goal territory, confirmed pre-existing) and that end-to-end creation via that path is unaffected by the schema widening.
- **Accessible names / keyboard**: all interacted elements (Add panel, Collection, Start blank, data-type button, panel title textbox, Create panel, panel actions menu, Delete, Confirm) exposed accessible names via the Playwright accessibility snapshot; no unlabeled interactive elements encountered in this flow.
- **Breakpoints**: resized to 768px mid-flow — no console errors, layout did not break (panel remained visible, no overflow/crash). Given this change makes no CSS/layout modifications (pure enum/logic widening), a full 1440/1100/768/0 sweep was not exhaustively required, but the 768px spot-check plus the full existing Jest suite (which includes `mobilePanelHeights` breakpoint-specific tests, all passing) provides adequate confidence of no layout regression.
- Cleaned up the test panel (Delete → Confirm) after verification; no test debris left on the `divider-check` dashboard.

### Overall: PASS

### Change Requests
(none — Overall is PASS)

### Non-blocking Suggestions
- None beyond what's already tracked; the executor's own `files-modified.md` documents the probe methodology clearly, which was independently reproduced here with matching results.
