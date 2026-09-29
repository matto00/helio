## Standing Constraints

- [C1] MODELS: sonnet on ALL agents (owner ruling 2026-09-18). Pass no opus/fable override; promote no one.
- [C2] Pass explicit timeout: 600000 on every Bash call that can run hooks, sbt, jest, or CI. Never end turn waiting; poll inside turn. Never wait via pgrep -f pattern matching.
- [C3] Hardware: 6c/12t desktop. Cap parallel work at 3 workers and nice -n 19.
- [C4] Frontend: DESIGN.md binding. Skeptic/evaluator must check visual cohesion against the RUNNING app in BOTH themes AND mobile stack, not just token compliance; check every render path. a11y AC inline: keyboard-operable, labelled, announced. Verify dev servers serve THIS worktree (readlink /proc/<pid>/cwd). Screenshots never at repo root.
- [C5] Any flake in any suite: record test name + assertion message verbatim in evidence dir before cleanup.
- [C6] If NodeSnapshotRepository is touched, run the node-root guard locally and audit any allowlist line remap before gates.
- [C7] Any commit after a final CONFIRM that changes code or tests needs a fresh final verdict. For each post-CONFIRM commit, state whether it's code or archive-only.
- [C8] Running out of any budget (executor cycles, gate rounds, auditor attempts) is a MANDATORY escalation to the driver, never a self-approval.
- [C9] Standalone follow-ups: include origin_kind: followup / origin_ticket: HEL-1189 in the description, relatedTo, and the Follow-up label on the same save_issue call, then read it back.
- [C10] Use git -C <path>; don't cd the session.

## 1. Backend: domain model + persistence

### Backend
- [x] 1.1 Add `OutputControlSpec`/`OutputControlEligibility` (domain/panels or services/pipelines) with closed-key strict decode, `ValidKinds`, and `kindsFor(column, operators, fieldType)` per design.md D2/D3; verify with a unit spec covering each kind's eligibility boundary.
- [x] 1.2 Extend `OutputPanelConfig` with `controls: Vector[OutputControlSpec]`, update its wire format, `Patch`, `decode`/`decodeCreate`, and `applyPatch`; verify round-trip encode/decode unit tests pass.
- [x] 1.3 Add migration `V112__add_output_panel_controls.sql` (`output_controls JSONB NULL`, mirroring V108's NO FORCE/FORCE RLS bracket); verify `sbt run` applies it cleanly against a fresh dev DB.
- [x] 1.4 Wire `output_controls` read/write into `PanelRowMapper` (mirror `form_config`'s tolerant-decode-with-log-fallback pattern); verify a `PanelRepository` integration test persists and reads back a control list.

## 2. Backend: validation + API surface

### Backend
- [x] 2.1 Add `PanelService.rejectInvalidControls` (design.md D4), wired into `buildForCreate` and the PATCH path, validating only entries that are new or whose column/kind changed (id-diff against the persisted list — an untouched, already-orphaned entry never blocks an unrelated save); verify a `PanelServiceSpec`/route spec asserts the defined 400 naming column+kind, and a second spec asserts an unrelated save succeeds despite a drifted, untouched control.
- [x] 2.2 Add read-time `orphaned` projection for each control (design.md D5) surfaced on the panel/output response; verify a spec asserts a drifted column is reported orphaned, not dropped or 500'd.
- [x] 2.3 Update `schemas/panels/panel.schema.json`'s `OutputConfig` def (and `create-panel-request.schema.json`/`update-panels-batch-*` if they reference it) for the new `controls` field, closed additionalProperties; verify `npm run` schema-drift/openspec hygiene checks pass.

## 3. Frontend: service + editor

### Frontend
- [x] 3.1 Add `getFilterCapabilities(outputId)` to `outputService.ts`; verify a service test asserts the request shape against `schemas/outputs/output-filter-capabilities-response.schema.json`.
- [x] 3.2 Port `OutputControlEligibility.kindsFor` to TypeScript with the same C4-style drift-guard test that parses the Scala literal (mirrors `CONTROL_FITNESS`/`FittingControls`); verify the drift-guard test fails if one side is edited without the other.
- [x] 3.3 Add `OutputControlsEditor` (new component, sibling to `OutputPanelSection` in `PanelDetailModal.tsx`): controls list, Add control (kind picker filtered to eligible kinds, generates the new entry's `id` client-side via `crypto.randomUUID()` per design.md D2), auto-bind on add, rebind, remove, label/default-value inputs — implements `PanelEditorHandle`; verify with a component test covering add/rebind/remove and the orphaned-control indicator.
- [x] 3.4 Extend `frontend/src/features/panels/types/panel.ts` output-panel config type with `controls`; verify `npm run typecheck` passes.
- [x] 3.5 Style the Controls section per DESIGN.md tokens, both themes; verify visually against the running dev app in light and dark theme, desktop and mobile stack.

## 4. Tests

### Tests
- [x] 4.1 Backend: `OutputControlEligibilitySpec` covering every kind × operator-set boundary from design.md D3, including the two-Outputs-same-type-different-cardinality AC scenario.
- [x] 4.2 Backend: route/service spec covering create/update rejection (400 naming column+kind), successful add, and orphan-on-drift (column removed, column retyped).
- [x] 4.3 Backend: migration test/smoke check that `output_controls` defaults to empty list for pre-existing panels.
- [x] 4.4 Frontend: `OutputControlsEditor.test.tsx` covering the two-click add flow, kind-offering parity with a mocked capability contract, rebind, remove, and keyboard-only operation (Testing Library `userEvent`, not `toHaveFocus()` per MISTAKES.md — use Playwright for any rendered-focus assertion).
- [x] 4.5 e2e (Playwright): add a date-range control to an Output panel in two clicks, auto-bound to its date column; verify against both themes.
- [x] 4.6 Full verification pass: `npm run lint`, `npm run typecheck`, `npm test`, `sbt test`, `openspec validate output-panel-control-config --type change` all green before requesting evaluation.
