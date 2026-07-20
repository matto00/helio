# Files modified — HEL-316 / mcp-proposal-panel-parity

- `backend/src/main/scala/com/helio/api/protocols/DashboardProposalProtocol.scala` — add optional
  `config: Option[JsObject]` to `ProposalPanel`; read/write it in the custom `proposalPanelFormat`
  (absent-tolerant, same pattern as the existing `aggregation`/`fieldMapping` fields).
- `backend/src/main/scala/com/helio/services/DashboardProposalService.scala` — `buildCreateRequest`
  now builds the derived flat-field config as before, then merges the passthrough `panel.config` over
  it via a new `mergeConfig` helper (`derived ++ config`), re-applying the flat `dataTypeId` after the
  merge so it stays authoritative (D2) — a data panel's `config.dataTypeId` can never override the
  server-resolved flat binding, preserving the V41 pipeline-only rule. `DataPanelKinds` and
  `preValidateBindings` are unchanged (still only look at the flat `dataTypeId`).
- `schemas/dashboard-proposal.schema.json` — added `config` (generic object, optional) to
  `$defs.ProposalPanel.properties`; removed `divider` from `$defs.ProposalPanel.properties.type.enum`
  (agent-facing surface only — the backend `PanelType.fromString`/`buildNonDataConfig` divider branch
  stay tolerant per D4, unchanged).
- `scripts/check-schema-drift.mjs` — **not listed in tasks.md but required to land 2.2/3.2 cleanly.**
  The existing panel-type-enum drift guard (HEL-310) compared `dashboard-proposal.schema.json`'s type
  enum and `helio-mcp/src/tools/proposal.ts`'s `PANEL_TYPES` against the FULL backend-canonical
  `PanelType.fromString` set (which includes `divider`, since the backend wire stays tolerant per D4).
  Removing `divider` from those two agent-facing surfaces without updating the guard would make
  `npm run check:schemas` (a Husky pre-commit gate) fail on this exact, intended change. Added an
  `agentFacingPanelTypes` carve-out (`canonicalPanelTypes` minus `divider`) and pointed those two
  surfaces at it; the other three surfaces (`create-panel-request.schema.json`, `panel.schema.json`,
  `update-panels-batch-request.schema.json`) are untouched and still compared against the full
  wire-tolerant canonical set. This mirrors how `create_panel`'s type enum in
  `helio-mcp/src/tools/write.ts` already narrows independently of this guard (it isn't schema-checked
  at all).
- `helio-mcp/src/types.ts` — added `config?: Record<string, unknown>` to `ProposalPanel`, with a
  doc-comment cross-referencing the backend merge semantics.
- `helio-mcp/src/tools/proposal.ts` — dropped `divider` from `PANEL_TYPES` (now
  metric/chart/table/text/markdown/image/collection, matching `create_panel`); added
  `config: z.record(z.unknown()).optional()` to `panelSchema`; refreshed the `propose_dashboard`
  description with per-type v1.5 `config` guidance (collection `baseType`/`layout`, chart
  `chartOptions` per type, table `density`/`columnOrder`, text/markdown/image flat-field notes),
  reusing the phrasing already written for `create_panel` in `write.ts`; refreshed `apply_proposal`'s
  description to note the `config` merge + `dataTypeId` authority and point back at
  `propose_dashboard` for the per-type shapes.
- `backend/src/test/scala/com/helio/api/protocols/DashboardProposalProtocolSpec.scala` — added a
  `config: Option[JsObject]` parameter to the shared `panel(...)` test fixture and a new
  "ProposalPanel.write/read — config" block: omit-when-absent, emit-when-present, tolerate-absent-on-
  read, and round-trip.
- `backend/src/test/scala/com/helio/api/DashboardApplyProposalSpec.scala` — added five HEL-316
  route-level tests against the real (embedded-Postgres, RLS-enforced) route tree: collection
  `config: {baseType, layout}` persists; chart `config: {chartOptions: {line: {smooth: true}}}`
  persists; table `config: {density, columnOrder}` persists; a data panel's `config.dataTypeId`
  attempting to override the flat `dataTypeId` with a non-pipeline-output (companion) type is silently
  ignored and the flat value remains on the created panel (V41 not bypassable); and a flat-field-only
  proposal (no `config` key at all) produces byte-for-byte the same created-panel config as before this
  change (`{dataTypeId, fieldMapping}` only, nothing else).
- `openspec/changes/mcp-proposal-panel-parity/tasks.md` — marked tasks 1–4 and 5.1 done; left 5.2/5.3
  (live-backend end-to-end `apply_proposal` round-trip + in-app Proposal Review UI check) unchecked —
  those require a running dev server and are explicitly the evaluator's job per the orchestrator brief.
  Round 2: added section 6 (round-2 fixes) and marked 6.1–6.5 done.

## Round 2 — skeptic-refuted V41 gap (skeptic-final-1.md, CR1/CR2/CR3)

**Finding**: text/markdown panels have no flat `dataTypeId` field (unlike metric/chart/table/
collection) — HEL-244 gave them an optional `dataTypeId` binding that lives ONLY inside `config`. The
round-1 `mergeConfig` re-apply only fires when the FLAT `dataTypeId` is `Some`, so it never touched
text/markdown; `preValidateBindings` only inspected the flat field; and (pre-existing, independent of
this ticket) `PanelServiceHelpers.dataTypeIdFromCreateConfig` only extracted `dataTypeId` for the bound
trio + collection, so `PanelService.create`'s `rejectCompanionBinding` never saw a text/markdown
binding at all. Net effect: `config.dataTypeId` on a `text`/`markdown` proposal panel could bind a
source-companion (non-pipeline-output) DataType with no validation anywhere — live-reproduced by the
skeptic as a 201 that persisted the exact class of binding V41 exists to reject.

**Fix — root cause, per systematic-debugging (also closes CR4, the pre-existing direct-path hole, at
its source)**:

- `backend/src/main/scala/com/helio/services/PanelServiceHelpers.scala` — `dataTypeIdFromCreateConfig`
  now also extracts `dataTypeId` for `TextCreate`/`MarkdownCreate`. Since `PanelService.create` calls
  this helper unconditionally for every create path (direct `POST /api/panels`, `create_panel`,
  `apply_proposal`), `rejectCompanionBinding` now validates a text/markdown binding exactly like any
  other panel type — a companion DataType 400s, a valid pipeline-output DataType succeeds.
- `backend/src/main/scala/com/helio/services/DashboardProposalService.scala` — `preValidateBindings`
  now checks a new `bindingCandidate(panel)` (flat `dataTypeId` when present, else — for a panel type
  OUTSIDE `DataPanelKinds` only — `config.dataTypeId` via the new `nonFlatConfigDataTypeId` helper)
  instead of just `panel.dataTypeId`, so the proposal's up-front "nothing is created on a bad binding"
  atomicity guarantee now also covers text/markdown's `config`-only binding, not just the mid-create
  rejection + whole-dashboard rollback. Doc comments on `buildCreateRequest`/`mergeConfig` corrected to
  no longer claim an unconditional guarantee — now accurately describe the two-mechanism enforcement
  (flat re-apply for `DataPanelKinds`; separate pre-flight + create-time validation for text/markdown).
- Doc corrections (CR3) — the round-1 absolute claims ("config can never bypass V41" / "dataTypeId
  always stays authoritative") were only true for `DataPanelKinds`; narrowed to be accurate in
  `design.md` (D2/D3 updated, new D3a added), `schemas/dashboard-proposal.schema.json`'s `config`
  property description, and both `helio-mcp/src/tools/proposal.ts` tool descriptions +
  `helio-mcp/src/types.ts`'s `ProposalPanel` doc comment.

**Regression tests (CR2)**:

- `backend/src/test/scala/com/helio/services/PanelServiceCompanionBindingGuardSpec.scala` — direct
  `PanelService.create` layer: new "reject with 400 when a TEXT panel's config.dataTypeId resolves to
  a companion DataType" and "succeed when a TEXT panel's config.dataTypeId resolves to a pipeline-
  output DataType" tests, mirroring the existing metric-panel tests exactly.
- `backend/src/test/scala/com/helio/api/DashboardApplyProposalSpec.scala` — five new route-level tests:
  text-panel-binds-companion → 400/nothing-created; markdown-panel-binds-companion → 400/nothing-
  created; text-panel-binds-valid-pipeline-output → 201/persisted; markdown-panel-binds-valid-pipeline-
  output → 201/persisted; text-panel-binds-unknown-id → 400/nothing-created.

**CR4** (pre-existing direct-path hole) — resolved by the shared-root fix above (`PanelServiceHelpers
.dataTypeIdFromCreateConfig`); no separate spinoff ticket needed, per the skeptic's own guidance that
the root-cause fix supersedes the spinoff requirement.

## Verification gates run (fresh, from this worktree, round 2)

- `cd backend && sbt -batch compile` → `[success]`, clean compile (exit 0).
- `cd backend && sbt -batch "testOnly com.helio.api.protocols.DashboardProposalProtocolSpec com.helio.api.DashboardApplyProposalSpec com.helio.services.PanelServiceCompanionBindingGuardSpec"`
  → `Tests: succeeded 50, failed 0, canceled 0, ignored 0, pending 0` / `All tests passed.` (exit 0).
- `cd backend && sbt -batch test` (full suite) → `Tests: succeeded 1412, failed 0, canceled 0,
  ignored 0, pending 0` / `All tests passed.` (exit 0) — up from 1405 in round 1 (+7 new tests: 2 at
  `PanelServiceCompanionBindingGuardSpec`, 5 at `DashboardApplyProposalSpec`).
- `openspec validate mcp-proposal-panel-parity` → `Change 'mcp-proposal-panel-parity' is valid` (exit 0).
- `cd helio-mcp && npm run build` (tsc) → exit 0, no errors.
- `node scripts/check-schema-drift.mjs` → `schemas in sync ...` / `panel-type enums in sync ...
  (7 surfaces checked)` (exit 0) — unaffected by the round-2 changes (no panel-type-enum edits).
- `npm run lint` (root ESLint, covers `helio-mcp/src/**`) → exit 0, zero warnings.
- `npm run format:check` → `All matched files use Prettier code style!` (exit 0).
- `npm run check:openspec` → `openspec/ is clean` (exit 0).
- `npm run check:scala-quality` → `Scala code-quality check: clean (44 soft warning(s))` (exit 0; same
  count as round 1 — no new flagged files, existing ones grew but stayed under the 400-line
  propose-a-split threshold except the two noted below, which were already over it in round 1).
- `npm test` (root Jest `--passWithNoTests` + `frontend` Jest) → `Test Suites: 109 passed, 109 total` /
  `Tests: 1147 passed, 1147 total` (exit 0).

**Live re-probe of the exact skeptic bypass** — killed and restarted the worktree's backend
(`localhost:8396`) to pick up the fix, re-authenticated as `matt@helio.dev`, and re-ran:

1. The skeptic's exact bypass — `text` panel, `config: {"dataTypeId": "97513324-...-skeptic-src"}`
   (the same source-companion DataType from the original report):
   `{"message":"panel 'Rogue Text': panels can only bind to pipeline-output data types"}` — **HTTP 400**
   (was 201 in round 1). Rejected by `preValidateBindings` before any creation (pre-flight, per CR1's
   atomicity requirement).
2. The identical shape against a valid pipeline-output DataType (`39713b12-...-skeptic-output`):
   **HTTP 201**, panel persisted with `config.dataTypeId` set to the pipeline-output id — proves the
   fix does not regress the intended "text/markdown DataType binding" v1.5 surface.
3. Sanity re-check — metric panel with flat `dataTypeId` = valid output and `config.dataTypeId` =
   companion (the round-1 "keep flat authoritative" scenario): **HTTP 201**, created with the flat
   (valid) id, companion `config.dataTypeId` silently ignored as before — no regression to
   `DataPanelKinds` behavior.

Both probe dashboards were deleted after verification (`DELETE /api/dashboards/:id` → 204 each).

## Notes for the evaluator

- `DashboardProposalService.scala` is now 344 lines (round 1: 307; soft budget 250) and
  `DashboardApplyProposalSpec.scala` is now 647 lines (round 1: 554; soft budget 250) — both already
  over budget in round 1 and flagged only as informational warnings by `check:scala-quality` (exit 0,
  not a gate failure). `DashboardApplyProposalSpec.scala` is now past the 400-line
  "propose-a-split-in-the-PR-description" threshold in CONTRIBUTING.md; not split here since (a) this
  codebase already has many much-larger test files in the same style (`ApiRoutesSpec.scala` at 4094
  lines, `DashboardPanelAclSpec.scala` at 655), and (b) splitting a security-regression-test file
  mid-cycle-2 risked losing the tight before/after pairing with the skeptic's exact repro scenario;
  flagging explicitly for the evaluator/skeptic to weigh in on whether a follow-up split is warranted.
- The `scripts/check-schema-drift.mjs` change (round 1) is the one edit outside the literal file list in
  `proposal.md`'s Impact section — it was necessary for the schema/MCP changes described there
  (2.2/3.2) to actually pass the existing pre-commit gate; flagging for explicit scrutiny per the
  "surface non-trivial findings" guardrail.
- Tasks 5.2 (live `apply_proposal` round-trip against a running backend) and 5.3 (in-app Proposal
  Review UI round-trip) are still unchecked — scoped to the evaluator per the orchestrator brief. Note
  the worktree backend at `localhost:8396` is now running the round-2-fixed code (restarted during this
  cycle's live re-probe), so it's ready for the evaluator's own live checks without a restart.
