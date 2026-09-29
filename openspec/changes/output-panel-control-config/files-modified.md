# Files modified — HEL-1189 output-panel-control-config

Enumerated against the live-resolved review base (`resolve-review-base.sh`, `main`/`origin`).
Covers cycle 1 (committed at `fba7c629`) plus cycle 2's two evaluator change requests
(evaluation-1.md).

## Backend — domain model + persistence

- `backend/src/main/scala/com/helio/domain/panels/OutputPanel.scala` — `OutputControlSpec` (closed-key strict decode, D2), `OutputPanelConfig.controls` field + wire format + `Patch` + `applyPatch`, `validateConfig` structural checks. **Cycle 2 (CR1):** added `OutputPanelConfig.responseJson(config, orphanedIds)` — the read-time wire shape that bakes `orphaned: Boolean` onto each control, used only by callers that have actually computed live orphan status.
- `backend/src/main/scala/com/helio/services/pipelines/OutputControlEligibility.scala` — `kindsFor(column, operators, fieldType)`, the single eligibility source of truth (D3), drift-guarded against the TS mirror. **Cycle 2 (CR2):** now genuinely the sole production entry point — `OutputControlsValidator` calls it directly instead of re-deriving the rule inline.
- `backend/src/main/resources/db/migration/V112__add_output_panel_controls.sql` — `panels.output_controls JSONB NULL` column, mirrors V108's NO FORCE/FORCE RLS bracket.
- `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRepository.scala` — `PanelRow.outputControls`, `PanelTable.outputControls` column, folded into `configColumnsOf`/`configColumnValuesOf` (C4 — the HEL-909/HEL-1083 "every config column must be in this tuple" discipline).
- `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRowMapper.scala` — `output_controls` read (tolerant decode, D9-layer-iii style, mirrors `form_config`) / write (NULL when empty).

## Backend — validation + read-time orphan status

- `backend/src/main/scala/com/helio/services/panels/OutputControlsValidator.scala` — write-time validation (`reject`, D4 id-diffed) extracted from `PanelService.scala` (file-size budget). **Cycle 2:** widened from `private[services]` to public (`PublicDashboardRoutes` now constructs its own instance); `controlEligible` refactored (CR2) to resolve the real operator set for a column then call `OutputControlEligibility.kindsFor(...).contains(kind)` directly — no more hand-rolled per-kind duplicate of the eligibility rule (`resolveOperators` still special-cases WHICH operators are worth resolving per kind, purely as a cost optimization: `Eq`/`In` are only resolved, via the cardinality-gated DB scan, when `kind == "dropdown"`; this is not a second eligibility rule, just avoiding an unneeded DB round-trip for the other three kinds). New public `isOrphaned(output, control): Future[Boolean]` (CR1) reuses `controlEligible` — "orphaned" is `controlEligible` evaluated read-only, never a second copy of the decision.
- `backend/src/main/scala/com/helio/services/panels/PanelService.scala` — calls `outputControlsValidator.reject(...)` from `buildForCreate`/`update` (unchanged behavior from cycle 1, now delegating to the extracted class).
- `backend/src/main/scala/com/helio/api/protocols/panels/PanelProtocol.scala` — **Cycle 2 (CR1):** `PanelResponse.fromDomain` gained an `orphanedControlIds: Option[Set[String]] = None` param (default preserves every existing call site's behavior byte-for-byte — `config` still comes from the plain `PanelConfigCodec.encodeConfig`); when `Some(ids)` is passed, `config` for an `OutputPanel` instead comes from `OutputPanelConfig.responseJson`, baking `orphaned` onto each control.
- `backend/src/main/scala/com/helio/api/routes/dashboards/PublicDashboardRoutes.scala` — **Cycle 2 (CR1):** `GET /api/dashboards/:id/panels` (this app's one true panel-READ path — both authenticated dashboard viewing and public/shared viewing funnel through here, confirmed via `frontend/.../panelService.ts`'s `fetchPanels`) now resolves `orphanedControlIds` per panel (mirroring the existing `resolveDataAsOf` async-resolve-then-merge pattern) and passes it into `PanelResponse.fromDomain`, satisfying `output-panel-placement`'s Requirement 3 ("reported as orphaned wherever the panel's controls are read").
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `nodeSnapshotRepoOpt` into the `panelService` constructor call (cycle 1, unchanged).
- `schemas/panels/panel.schema.json` — `OutputConfig.controls` + `$defs.OutputControlConfig` (cycle 1); **cycle 2:** added the optional `orphaned: boolean` property with a doc note on when it is/isn't present.

## Scope boundary for CR1 (documented, not silently narrowed)

`orphaned` is surfaced on the ONE steady-state panel-READ endpoint (`GET /api/dashboards/:id/panels`).
It is deliberately NOT threaded through `POST /api/panels`, `PATCH /api/panels/:id`,
`POST /api/panels/batch`, `POST /api/panels/updateBatch`, `POST /api/panels/:id/duplicate`, or the
~15 patchset/proposal/dashboard-snapshot echo call sites of `PanelResponse.fromDomain` — those are
write-acknowledgment echoes and ephemeral preview/undo-outcome projections, not "reads" in the
steady-state sense Requirement 3 is about, and threading async orphan computation through all of
them would be a much larger, riskier change than what was asked. `orphanedControlIds` defaults to
`None` for every one of those (unchanged behavior, config unaffected). Flagging this explicitly per
CONTRIBUTING.md's escalation guidance — if a evaluator/skeptic wants the field on additional
surfaces, that is a new, separately-scoped ask.

## Frontend — service + editor (cycle 1, unchanged in cycle 2)

- `frontend/src/features/pipelines/services/outputService.ts` — `getFilterCapabilities(outputId)`.
- `frontend/src/features/pipelines/types/output.ts` — `OutputFilterCapabilitiesResponse`/`OutputFilterCapabilityColumn`.
- `frontend/src/features/panels/state/outputControlEligibility.ts` — TS mirror of `kindsFor`/`KIND_REQUIREMENTS` (D6), drift-guarded.
- `frontend/src/features/panels/types/panel.ts` — `OutputControlKind`/`OutputControlSpec`/`OutputControlNumericRangeValue`/`OutputControlDateRangeValue`, `OutputPanelConfig.controls` (now required), `emptyOutputConfig` updated.
- `frontend/src/features/panels/services/panelService.ts` — `updatePanelOutputControls`.
- `frontend/src/features/panels/state/panelThunks.ts` — `updatePanelOutputControls` thunk.
- `frontend/src/features/panels/state/panelsSlice.ts` — imports + `.addCase(updatePanelOutputControls.fulfilled, ...)`.
- `frontend/src/features/panels/state/panelPayloads.ts` — `seedCreateConfig` now seeds `controls: []` for a new output panel.
- `frontend/src/features/panels/ui/editors/useOutputControlsEditorState.ts` — local list-editor state hook (add/rebind/setLabel/setDefaultValue/remove/reset/dirty), `firstEligibleColumn` (auto-bind rule).
- `frontend/src/features/panels/ui/editors/OutputControlRow.tsx` — one control's row (kind badge, orphan indicator, column rebind, label, default-value fields per kind, remove) — split out of the editor for CONTRIBUTING.md's file-size budget, mirrors `FormEditor.tsx`/`FormFieldRow.tsx`. Its `orphaned` prop remains client-computed (D6's already-fetched `/filter-capabilities` + `output.schema`) — this is unaffected by CR1's server-side addition, which is a separate, additive surface for OTHER consumers, not a replacement for this component's own live computation.
- `frontend/src/features/panels/ui/editors/OutputControlsEditor.tsx` — the "Controls" section container (fetch Output schema + filter-capabilities, compute offered kinds/columns, two-click add, `PanelEditorHandle`, ARIA live-region announcements).
- `frontend/src/features/panels/ui/editors/OutputControlsEditor.css` — DESIGN.md tokens only.
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx` — mounts `OutputControlsEditor` (own ref, wired into `activeEditorRef()`) alongside `OutputPanelSection` in edit mode.

## Tests

- `backend/src/test/scala/com/helio/services/pipelines/OutputControlEligibilitySpec.scala` — `kindsFor` boundary coverage incl. the two-Outputs-different-cardinality AC scenario (task 4.1).
- `backend/src/test/scala/com/helio/domain/panels/OutputPanelSpec.scala` — `OutputPanelConfig`/`OutputControlSpec` decode/encode/patch/validateConfig coverage (task 1.2).
- `backend/src/test/scala/com/helio/services/panels/PanelServiceOutputControlsSpec.scala` — `rejectInvalidControls` 400/success/orphan-non-blocking coverage (tasks 2.1/4.2); re-verified green after CR2's `OutputControlsValidator` refactor (behavior-preserving).
- `backend/src/test/scala/com/helio/infrastructure/persistence/panels/PanelRowMapperSpec.scala` — `output_controls` round-trip/NULL/tolerant-decode cases (task 1.4).
- `backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalConfigSpec.scala` — updated one pre-existing wire-shape assertion (`config` now always includes `"controls":[]`) — a genuine enumeration-site hit (MISTAKES.md/HEL-1082 lesson), not a defect.
- `backend/src/test/scala/com/helio/api/routes/dashboards/PublicDashboardRoutesSpec.scala` — cycle 2 (CR1/CR2), 4 new route-level tests against a real EmbeddedPostgres DB: `orphaned: false` for a still-eligible control; `orphaned: true` after the bound column is removed from the Output's schema; `orphaned: true` after the bound column is retyped so it no longer fits the control's kind; `orphaned: false` for a dropdown control under a real low-cardinality `eqInEligibleColumn` scan (genuine end-to-end coverage of CR2's refactored dropdown branch, not just `kindsFor`'s pure-function tests).
- `frontend/src/features/pipelines/services/outputService.filterCapabilities.test.ts` — `getFilterCapabilities` request/response shape (task 3.1).
- `frontend/src/features/panels/state/outputControlEligibilityDriftGuard.test.ts` — C4 drift guard (task 3.2).
- `frontend/src/features/panels/ui/editors/OutputControlsEditor.test.tsx` — two-click add, kind-offering parity, rebind, remove, orphan indicator, keyboard-only add, save() (task 4.4).
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.test.tsx`, `frontend/src/features/panels/ui/OutputPicker.test.tsx`, `frontend/src/app/App.test.tsx`, `frontend/src/features/patchSets/ui/PatchSetReviewPage.test.tsx`, `frontend/src/features/panels/state/panelPayloads.test.ts`, `frontend/src/test/panelFixtures.ts` — updated fixtures/mocks for `OutputPanelConfig.controls` becoming a required field and the new `getFilterCapabilities`/`updatePanelOutputControls` service exports.
- `frontend/src/theme/elevationTokenGuard.css.test.ts`, `frontend/src/theme/motionTokenGuard.css.test.ts` — bumped the hardcoded "every CSS file" count 120 -> 121 for the new `OutputControlsEditor.css`.
- `e2e/hel1189-output-panel-controls-live.spec.ts` — live two-click add-date-range-control verification, dark + light theme (task 4.5). Run live against `scripts/concertino/start-servers.sh` (DEV_PORT=6621, BACKEND_PORT=9528) — both pass.
