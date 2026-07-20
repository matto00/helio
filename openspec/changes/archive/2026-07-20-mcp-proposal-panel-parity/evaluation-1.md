## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 4 ticket DoD items addressed: `propose_dashboard` type set now matches `create_panel`
  (`collection` in, `divider` out); proposal panel-config shapes support collection/chart-options/
  table-config via the new generic `config` passthrough; `apply_proposal` verified end-to-end
  against a live backend (re-verified fresh, see Phase 3); no stale type lists remain
  (`scripts/check-schema-drift.mjs` confirms zero drift across 7 surfaces).
- No AC silently reinterpreted. The scope (Option B, generic `config` passthrough vs. per-field
  expansion) was human-approved per `design.md` D1 and matches `proposal.md`.
- tasks.md 1–4 and 5.1 are checked and match what was implemented; 5.2/5.3 were correctly left
  unchecked for the evaluator per the orchestrator brief — completed in Phase 3 below.
- No scope creep. The one file outside `proposal.md`'s literal Impact list
  (`scripts/check-schema-drift.mjs`) is a necessary consequence of 2.2/3.2 (see Phase 2) and is
  explicitly flagged by the executor for scrutiny — judged correct, not creep.
- No regressions to existing behavior: `divider` stays wire-tolerant on the backend
  (`PanelType.fromString`, `buildNonDataConfig`); only the two agent-facing surfaces narrow.
- API contracts updated together: backend protocol, JSON schema, and MCP client all moved in the
  same change, confirmed in lockstep by the schema-drift script.
- Planning artifacts (proposal/design/tasks) reflect the final implemented behavior; the spec delta
  (`specs/mcp-panel-composition-tools/spec.md`) scenarios map 1:1 to the new backend tests and the
  live verification performed below.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **V41 binding-safety claim confirmed** (the primary scrutiny item). `mergeConfig` in
  `DashboardProposalService.scala:176-189` re-applies the flat `dataTypeId` onto the merged JsObject
  unconditionally after `derived ++ config`, so a `config.dataTypeId` can never survive the merge.
  This is defense-in-depth on top of an independent second check: `PanelService.create` already
  runs `rejectCompanionBinding(dataTypeIdFromCreateConfig(createConfig), user)` against whatever
  `dataTypeId` actually ends up in the final `CreatePanelRequest.config` JSON — so even a
  hypothetical bug in the merge would still be caught downstream. Verified directly: re-ran
  `DashboardApplyProposalSpec` fresh (`sbt -batch testOnly ...DashboardApplyProposalSpec
  ...DashboardProposalProtocolSpec`) — all 37 tests pass, including "keep the flat dataTypeId
  authoritative when config attempts to override it (HEL-316, V41)", which asserts against a real
  `companionTypeId` fixture (a DataType with `sourceId` set).
- **`check-schema-drift.mjs` carve-out judged correct, not a weakening.** Read the full file: the
  new `agentFacingPanelTypes` (canonical minus `divider`) is scoped to exactly the two surfaces that
  intentionally narrow (`dashboard-proposal.schema.json` enum, `proposal.ts` `PANEL_TYPES`); the
  other three surfaces (`create-panel-request.schema.json`, `panel.schema.json`,
  `update-panels-batch-request.schema.json`) remain compared against the full backend-canonical set
  including `divider`, so the guard's real intent (catch accidental drift) is preserved everywhere
  it should apply. This mirrors the precedent HEL-310 itself established for `create_panel`'s
  independently-narrowed enum in `write.ts`. Re-ran `node scripts/check-schema-drift.mjs` fresh —
  clean, 7 panel-type surfaces checked.
- **Backward compatibility confirmed.** `DashboardApplyProposalSpec`'s "apply a flat-field-only
  proposal (no config) unchanged (HEL-316 regression)" test asserts the created panel's `config` is
  byte-for-byte `{dataTypeId, fieldMapping}` with no extra keys — passes. Also confirmed live via
  the in-app Proposal Review UI (Phase 3): a flat-field-only demo proposal round-tripped with no
  behavior change.
- Imports/qualifiers: no inline FQNs introduced (`JsObject`/`JsString`/`JsValue` already
  top-of-file-imported in `DashboardProposalService.scala`; `spray.json` types likewise in the
  protocol file).
- File-size soft budgets: `DashboardProposalService.scala` (306 lines) and
  `DashboardApplyProposalSpec.scala` (553 lines) are informational-only warnings per
  `check:scala-quality` (exit 0), correctly not gated — both were already over the 250-line soft
  budget before this change and neither approaches the 400-line "propose a split" threshold.
  Confirmed via fresh `npm run check:scala-quality` run (44 pre-existing soft warnings, no new
  failures).
- DRY: reuses the existing `PanelConfigCodec.decodeCreateConfig` path verbatim rather than
  duplicating panel-config validation in the proposal layer — matches `create_panel`'s established
  pattern (D1).
- Readable/modular: `mergeConfig` is a small, well-documented pure function; `buildCreateRequest`'s
  branching is unchanged in shape, just extended.
- Type safety: `config: Option[JsObject]` / TS `Record<string, unknown>` are appropriately generic
  for a passthrough field — no untyped escape hatches.
- Tests meaningful: 4 new protocol round-trip tests + 5 new route-level tests against the real
  RLS-enforced route tree exercise collection/chart/table config, the V41 bypass attempt, and the
  backward-compat regression — these would catch a real regression in the merge logic.
- No dead code, no leftover TODO/FIXME in the diff.
- No over-engineering: the generic `config` passthrough (vs. per-field expansion) is the leaner
  design and avoids a new field per future panel-config surface — reasonable per D1's stated
  rationale.
- Fresh gates re-run (not just trusting the executor's report):
  `sbt -batch testOnly com.helio.api.DashboardApplyProposalSpec
  com.helio.api.protocols.DashboardProposalProtocolSpec` → 37/37 pass;
  `node scripts/check-schema-drift.mjs` → clean; `npx openspec validate mcp-proposal-panel-parity`
  → valid; `helio-mcp && npm run build` → exit 0, `dist/tools/proposal.js` confirmed to have no
  `divider` in `PANEL_TYPES`; `npm run lint` (root, covers `helio-mcp/src`) → 0 warnings;
  `npm run check:scala-quality` → clean (44 pre-existing soft warnings only).

### Phase 3: UI Review — PASS
Issues: none.

Triggered by `schemas/**` and `openspec/specs/**` changes. Started servers via the canonical script
(`scripts/concertino/start-servers.sh` → `assert-phase.sh servers` → `PASS servers`) on
DEV_PORT=5489 / BACKEND_PORT=8396.

- **Task 5.2 (live `apply_proposal` round-trip, evaluator scope) — done and passing.** Logged in as
  the canonical dev account, minted a PAT via `POST /api/tokens` (revoked after the run), built
  `helio-mcp/dist`, and drove the real MCP stdio server with the official
  `@modelcontextprotocol/sdk` client (`propose_dashboard` then `apply_proposal`) against the live
  worktree backend with a proposal containing a **collection** panel
  (`config: {baseType: "metric", layout: "list"}`) and a **chart** panel with
  `config: {chartOptions: {line: {smooth: true, showPoints: true}}}`, both bound to a real
  pipeline-output DataType. Both tools returned success (`isError: undefined`); the applied
  response's panel `config` objects show `baseType`/`layout` and `chartOptions` persisted exactly as
  proposed, with `dataTypeId` intact. Confirmed visually in the browser: the created dashboard
  ("HEL-316 eval e2e") renders both panels correctly (collection shows the three bound rows; chart
  renders as a line chart) with zero console errors.
- **Task 5.3 (in-app Proposal Review UI round-trip, evaluator scope) — done and passing.** Navigated
  to `/proposals/review` (no router state → falls through to the page's demo-proposal fixture path,
  which is flat-field-only, i.e. exercises the "no `config`" branch of the shared write path).
  Reviewed the 3-panel proposal (metric/chart/table), clicked "Accept & create" — the app navigated
  to `/`, the new dashboard ("skeptic-output overview") appeared in the sidebar and rendered all 3
  panels with correct data (table rows, metric value, chart), zero console errors. This confirms the
  shared `POST /api/dashboards/apply-proposal` write path has no regression for the pre-existing
  flat-field-only flow.
- Happy path works end-to-end from both entry points (MCP tool and in-app UI).
- No console errors observed in either flow (checked via `browser_console_messages`).
- No blank screens; loading state (`aria-busy` on `/proposals/review` while DataTypes load) and the
  existing `EmptyState` component are unaffected by this change (not modified).
- Interactive elements (Accept & create, Reject, panel title textboxes) retain accessible names —
  unchanged from before this change.
- Breakpoint spot-check at 768px on `/proposals/review`: dialog renders without layout breakage
  (screenshot reviewed, cleaned up after). Since no `frontend/**` files were touched by this change,
  a full 1440/1100/768/0 sweep of unrelated UI was not exhaustively repeated — the spot-check
  confirms no incidental breakage from the schema/spec-only trigger.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- None beyond what the executor already self-flagged (file-size soft-budget warnings, informational
  only, already noted in `files-modified.md`).
