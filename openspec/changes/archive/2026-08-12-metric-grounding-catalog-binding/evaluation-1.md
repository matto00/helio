## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

Verification:
- All 5 ticket ACs addressed explicitly, not partially:
  - `get_workspace_context` includes `metrics` (context.ts `Promise.all` fan-out + `WorkspaceContext.metrics`, `context.test.ts` present/empty/deprecated-included coverage) — confirmed live and by unit test.
  - Proposal panel `metricId` → `apply_proposal` binds via the HEL-500 config path, nothing created on an invalid id — confirmed via live curl against the running backend (see Phase 3): valid metricId produced `config.metricId` on the created panel; nonexistent/foreign/deprecated/unsupported-type metricId each 400'd and created nothing (dashboard count unchanged).
  - `propose_dashboard` warns (not rejects) on missing/deprecated/non-owned/unsupported-type `metricId`, `applyReady` reflects it (`proposalValidation.ts` `computeProposalWarnings`, 6 new unit tests in `proposal.test.ts`).
  - `schemas/dashboard-proposal.schema.json` updated (`metricId` added to `ProposalPanel`); `check:schemas` passes; existing proposals without `metricId` behave byte-for-byte as before (additive-only splice in `buildDataConfig`, verified in diff and by the pre-existing round-trip tests in `DashboardProposalProtocolSpec` still passing unmodified).
  - `sbt test` (2450/2450) + helio-mcp build/typecheck/tests pass; no FQNs inlined — all re-verified fresh (see Phase 2).
- No AC silently reinterpreted. The one field-name deviation from the ticket text (`boundDataTypeId` → `dataTypeId`) is design.md Decision D1, explicitly flagged as "the real field, not a new decision" and confirmed correct against `MetricProtocol.scala`/`MetricRoutesSpec.scala` — not a silent reinterpretation.
- All 20/20 `tasks.md` items verified against the diff — each maps to real, present code (walked 1.1–4.5 individually against `git diff` and file reads).
- No scope creep: touched-file list matches proposal.md's "Impact" section exactly (backend protocol/services/routes, backend tests, schema, helio-mcp context/tools/types + tests, `check-schema-drift.mjs`). No frontend UI files touched, consistent with the ticket's explicit MCP/backend-only scope.
- No regressions: `sbt test` full suite green; live smoke test through the running dev UI (dashboard list, panel grid) showed no console errors and no broken flows after the `ApiRoutes`/service constructor changes.
- API contract updated in the same change (`schemas/dashboard-proposal.schema.json`), `check:schemas` passes (35 protocol surfaces + 7 panel-type-parity surfaces checked, including the `DATA_PANEL_TYPES` relocation to `proposalValidation.ts`).
- Planning artifacts reflect the implemented behavior for all D1–D7 decisions. One minor gap: the `proposalValidation.ts` extraction (driven by a real TS2589 compile-graph issue, probe-documented in `files-modified.md`) isn't recorded in `design.md`/`tasks.md` — but this exactly mirrors the unrecorded `metricSchemas.ts` precedent from HEL-541 (confirmed: HEL-541's archived design.md/tasks.md also don't mention it), so this is consistent house style, not a new gap. Non-blocking.

### Phase 2: Code Review — PASS

Issues: none.

Fresh gate re-runs (this evaluator's own, in `WORKTREE_PATH`, no `CLEAN_WORKTREE`):
- `cd backend && sbt test` → **2450/2450 passed**, 144 suites, 0 failed (matches executor's report).
- `npm run lint` → clean (0 warnings).
- `npm run format:check` → clean.
- `npm run check:schemas` → clean (35 protocol + 7 panel-type surfaces).
- `npm run check:scala-quality` → clean (0 FQN violations; 84 pre-existing soft file-size warnings, none on files touched by this change).
- `npm run check:openspec` → **fails as expected** ("change is complete (20/20) but not archived") — this is the documented, precedented reason (HEL-541 commit 9d8c67e5) the executor used `git commit -n` once; confirmed the failure reproduces identically on a fresh run, not a real defect. Every other Husky check was run clean before the bypassed commit per the commit message, consistent with CONTRIBUTING.md's AI-collaborator exception ("even then the situation must be called out explicitly in the commit body" — it was).
- `helio-mcp`: `npm run typecheck` clean, `npm run build` clean.
- Root `npx jest` (picks up `helio-mcp/src/**/*.test.ts`, ignores `frontend/`) → **112/112 passed**, 3 suites (`write.test.ts`, `proposal.test.ts`, `context.test.ts`) — matches the executor's reported "112" figure. (`helio-mcp/dist/*.test.js` transiently appeared from this evaluator's own `npm run build` and was removed before the real re-run — a self-induced artifact, not a pre-existing defect; `dist/` is gitignored.)
- No `frontend/**` files changed, so the frontend lint/format/test/build gate quartet doesn't apply per the `when` clause; not run.

Code-quality checklist:
- **CONTRIBUTING.md compliance**: no inline FQNs anywhere in the diff (grepped `com\.helio\.[A-Za-z]+\.` across the backend diff — all hits are import-line additions, none inline); `check:scala-quality` confirms mechanically. ACL triad honored (`MetricRepository.findByIdOwned` — owner-scoped, cross-user returns `None`, mapped to 400 "not found", never leaking existence — matches the pre-existing `dataTypeId` check's own pattern in the same function). `metricRepo` nullable-optional constructor wiring in `ApiRoutes.scala`/`DashboardProposalService`/`DashboardContentsService` correctly mirrors `PanelService`'s established convention (design.md D5, verified in the diff).
- **DRY**: `preValidateBindings` cleanly composes `validateDataTypeBinding` + `validateMetricBinding` via `validateOnePanelBinding` — no duplicated validation logic; `DashboardContentsService` and `DashboardProposalService` both delegate to the same shared `ProposalPanelSupport` functions, so the metricId check is written once. MCP-side, `computeProposalWarnings` is the single source for both `proposal.ts`'s runtime call and `proposal.test.ts`'s unit coverage.
- **Readable**: extensive, precise doc comments throughout (`ProposalPanelSupport.scala`, `proposalValidation.ts`); no magic values — `MetricIdSupportedKinds`/`METRIC_ID_SUPPORTED_TYPES` are named, mirrored constants on both sides of the wire.
- **Modular**: `proposalValidation.ts` extraction is justified by a probe-confirmed TS2589 compile issue (documented root-cause/probe in `files-modified.md`, per `systematic-debugging.md`), not speculative abstraction — same class of issue and same fix shape as the precedented `metricSchemas.ts` (HEL-541).
- **Type safety**: `metricId: Option[String]` / `z.string().optional()` / `metricId?: string` consistently typed across Scala/Zod/TS; no new `any` or unsafe casts introduced (the one `panels as ProposalPanel[]` cast in `proposal.ts` is pre-existing, unchanged by this diff).
- **Security**: metricId ownership enforced via RLS-respecting `findByIdOwned` at the hard-reject apply-time path; verified live that a foreign metric 400s. `propose_dashboard`'s advisory warning uses the same `api.listMetrics()` (already caller-scoped).
- **Error handling**: every rejection path returns a specific 400 message (verified live: "not found", "deprecated", "not supported on a `<type>` panel"); nothing silently ignored or swallowed.
- **Tests meaningful**: `DashboardApplyProposalMetricBindingSpec.scala` covers valid/nonexistent/foreign/deprecated/unsupported-type for both `apply-proposal` and `PUT /contents`, each proving atomicity (dashboard count / panel titles unchanged on rejection) — these would catch a real regression in `preValidateBindings`. MCP-side, 6 new tests cover the same warning matrix plus the two-independent-warnings-on-one-panel case.
- **No dead code**: the old inline `DATA_PANEL_TYPES` in `proposal.ts` was fully removed (moved, not duplicated); `check-schema-drift.mjs` updated to read from the new location so parity checking doesn't silently drift.
- **No over-engineering**: the `proposalValidation.ts` split is the minimum needed to fix a real compile failure; `MetricIdSupportedKinds` is a plain `Set[String]`, not a new type hierarchy.
- **Behavior-preserving refactor**: `validateDataTypeBinding`'s extracted logic is byte-for-byte identical to the pre-change inline version (compared side by side in the diff); the `computeProposalWarnings` extraction's control flow (`return` inside `forEach` → explicit `if/else`) is verified behavior-equivalent.
- **DESIGN.md**: N/A — no `frontend/**` files changed.

### Phase 3: UI Review — PASS

Triggers matched: `backend/src/main/scala/com/helio/api/ApiRoutes.scala` (route composition changed — new `metricRepo` constructor arg threaded to two services) and `schemas/**` (`dashboard-proposal.schema.json`). No `frontend/**` files changed, and no new UI surface was added by this ticket (MCP/backend-only, additive-only wire field) — `frontend/src/features/dashboards/ui/ProposalReview.tsx` does not reference `metricId` and needs no change (optional field, doesn't break rendering).

Dev server setup: `scripts/concertino/start-servers.sh` → `READY backend=http://localhost:8888/health`, `READY frontend=http://localhost:5981`; `scripts/concertino/assert-phase.sh servers` → `PASS servers`.

Checks:
- Happy path: navigated the running app (`localhost:5981`), switched dashboards, panels rendered correctly — no regression from the `ApiRoutes`/service-constructor rewiring.
- New capability (not reachable through any frontend control — MCP/API-only per ticket scope) verified directly against the live backend:
  - Created a metric via `POST /api/metrics`, applied a proposal with a valid `metricId` via `POST /api/dashboards/apply-proposal` → 201, created panel's `config.metricId` set to the metric id.
  - Nonexistent `metricId` → 400 `"metric ... not found"`, confirmed no dashboard named that proposal's name was created.
  - `metricId` on an unsupported `collection` panel → 400 `"metricId is not supported on a collection panel"`, confirmed nothing created.
  - Cleaned up the test dashboard/metric created during this verification (`DELETE`d both) to avoid polluting the shared dev DB.
- Unhappy paths (above) return clear JSON error bodies, no blank screens or unhandled exceptions.
- No console errors during any tested flow (`browser_console_messages` level=error → 0 across load, dashboard switch, and breakpoint resizes).
- Breakpoints 1440/768 resized without layout breakage or console errors (no visual change expected — this ticket touches no CSS/layout code).
- No new interactive elements were added by this change (MCP/backend-only), so no new accessible-name/keyboard-support surface to check.

### Overall: PASS

### Non-blocking Suggestions

- `design.md`/`tasks.md` don't record the `proposalValidation.ts` extraction (a real, probe-justified implementation-time decision). Consider a short addendum for full plan/implementation fidelity in future changes, though this matches existing house style (HEL-541's `metricSchemas.ts` extraction also went unrecorded there).
- `helio-mcp/src/context.ts` is now 1139 lines, well past the ~250-line soft budget CONTRIBUTING.md states generally (the `check:scala-quality` script only mechanically enforces this for Scala files, so TS files aren't gated). Not something to fix in this ticket, but worth flagging for a future decomposition pass given it keeps growing additively.
