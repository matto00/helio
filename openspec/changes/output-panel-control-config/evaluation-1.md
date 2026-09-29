## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit `fba7c629948cf06404d2cdafa10a93169e46ccc6` on
`feature/output-panel-control-config/HEL-1189`, diffed against LIVE-resolved
base `a6e603a1229cb1c7d1737c08d2ac88ff5355a92f` (`resolve-review-base.sh`).

### Phase 1: Spec Review — FAIL

- [x] Ticket ACs mostly addressed: two-click add ✔ (live-verified), kind
  offering exactly matches HEL-1188's contract per Output ✔ (live-verified: a
  60-row Output with a 58-distinct `label` string column correctly excluded
  Dropdown; `revenue`, the only integer column, was correctly the sole
  Numeric-range target), server 400 on invalid config ✔ (unit + route
  coverage), a11y inline AC ✔ (live-verified keyboard-only add, ARIA live
  region announcement, non-color-only orphan badge).
- [ ] **"A schema drift that orphans a control has defined, visible
  behaviour" AC / Requirement 3 in `output-panel-placement`'s spec delta is
  only PARTIALLY implemented — a genuine spec violation, not a legitimate
  implementation choice.** The spec delta's literal text: *"An orphaned
  control ... SHALL be reported as orphaned **wherever the panel's controls
  are read**."* design.md D5 gives exactly two alternatives, both
  server-computed: *"`OutputResponse`'s control-list projection (or a
  lightweight sibling used by the editor) computes `orphaned: Boolean` per
  control at READ time."* The implementation does **neither**: there is no
  `orphaned` field anywhere in any backend wire response
  (`OutputPanelConfig.format.write` in `OutputPanel.scala:109-116` emits only
  `outputId`/`controls`; grepped every route/protocol file — zero hits for
  an `orphaned` wire key; `schemas/panels/panel.schema.json`'s
  `OutputControlConfig` def has no `orphaned` property). Orphan status is
  computed **exclusively client-side**, inline inside
  `OutputControlsEditor.tsx:117-121` (`isColumnEligibleForKind`, re-deriving
  from a second `/filter-capabilities` fetch + `output.schema`), consumed
  only by `OutputControlRow.tsx`'s `orphaned` prop. Any OTHER consumer of a
  panel/output read — a public/shared-dashboard viewer, HEL-1190's future
  viewer control bar, HEL-1193's future MCP surface, or simply a second
  editor instance that hasn't independently re-implemented this fetch+derive
  dance — has **no way to know a control is orphaned**. This is exactly the
  silent-inconsistency failure mode the spec's own scenario text guards
  against ("not... applying it to the read as if still valid").
  `tasks.md` 2.2 is checked off (*"Add read-time `orphaned` projection for
  each control (design.md D5) surfaced on the panel/output response"*) but
  this was not done as literally specified, and no backend test anywhere
  asserts an `orphaned` field on any read response (confirmed: zero `grep
  orphan` hits in `PanelServiceOutputControlsSpec.scala`, `OutputPanelSpec.scala`,
  `PanelRowMapperSpec.scala`). The executor's own report frames this as
  "within design.md's stated alternatives" — it is not; D5 states two
  alternatives and both require server computation, neither of which this
  implementation does.
- [x] D4's id-diff, non-blocking-on-drift behavior (the design gate's
  hardest-won finding) is genuinely and correctly implemented — see Phase 2.
- [x] No unrelated scope creep found; `DashboardApplyProposalConfigSpec`
  update is a legitimate enumeration-site hit (verified: `controls: []` now
  appears in every output-panel wire response, correctly caught).
- [x] Schemas/openspec updated in the same change; `openspec validate` passes.
- [x] `workflow-state.md` CONSTRAINTS honored (C2 timeouts respected by
  reviewer; C6 N/A — `NodeSnapshotRepository.scala` not touched, confirmed
  by diff; C9/C10 N/A for this role).

### Phase 2: Code Review — FAIL

Gates run fresh, in `WORKTREE_PATH` (no `CLEAN_WORKTREE` for this cycle):
- `npm run lint` — clean, zero warnings.
- `npm run format:check` — clean.
- `npm test` — 363 suites / 3906 tests passed.
- `npm --prefix frontend run build` — succeeds.
- `sbt test` — 334 suites / **4913/4913 tests passed**, 0 failed.
- `npx openspec validate output-panel-control-config --type change` — valid.

All claimed numbers verified independently and match the executor's report.

Findings:

1. **DRY violation / contradicts design.md D3's stated single-source-of-truth
   architecture (mechanical: CLAUDE.md "Keep code modular and reusable" +
   CONTRIBUTING.md's DRY expectation).** D3 explicitly states:
   *"`OutputControlEligibility.kindsFor(column, operators, fieldType)` is the
   SINGLE source of truth, called by both the server validator (D4) and
   mirrored on the frontend (D6) — exactly the 'shared logic, not a parallel
   copy' discipline `OutputFilterCapability` itself documents."* In fact,
   `OutputControlsValidator.controlEligible`
   (`backend/src/main/scala/com/helio/services/panels/OutputControlsValidator.scala:83-114`)
   **never calls `kindsFor`** — it reimplements the same per-kind
   eligibility decision inline via a hand-written match on `c.kind`, using
   `OutputFilterCapability.staticOperatorsFor(fieldType)` and direct
   `DataFieldType` checks. Grepped the whole backend: `kindsFor` is called
   **only from its own test file**
   (`OutputControlEligibilitySpec.scala`) — it is dead code in production.
   This happens to be behaviorally equivalent today (verified by hand-tracing
   both implementations against `OutputFilterCapability.staticOperatorsFor`'s
   cases), but it means there are now **two independent backend
   implementations** of the same eligibility rule, and the C4-style drift
   guard (`outputControlEligibilityDriftGuard.test.ts`) only cross-checks
   `OutputControlEligibility.KindRequirements` (Scala) against
   `outputControlEligibility.ts` (TS) — it does **not** cover
   `OutputControlsValidator`'s inline logic at all. A future change to
   `KindRequirements` (or to `OutputFilterCapability.staticOperatorsFor`)
   could silently diverge from the actual write-time validator with nothing
   catching it. Fix: have `OutputControlsValidator.controlEligible` build the
   real operator set for the column (already has `output`/`fieldType` in
   scope) and call `OutputControlEligibility.kindsFor(...).contains(c.kind)`
   directly, exactly as D3 specifies, instead of re-deriving per-kind logic.

2. **Task 2.2 checkbox in tasks.md is marked `[x]` but the work described was
   not done** (see Phase 1) — the read-time `orphaned` projection was never
   added to any backend response. This should be reopened, not left checked.

Everything else reviewed cleanly:
- D4's id-diff validation (the design gate's hardest-won finding) is
  correctly wired in both `buildForCreate` and `update`
  (`PanelService.scala:586-608`), using the EFFECTIVE post-patch config
  (`effectiveOutputConfig`, C2 convention) diffed against the PRE-patch
  persisted list. `PanelServiceOutputControlsSpec.scala`'s
  `"an untouched, already-orphaned control ... does not block an unrelated
  save"` test (lines 188-213) is a real, correctly-constructed regression
  test: it drifts a column's type, resubmits the SAME control unchanged
  alongside an edit to a DIFFERENT control, and asserts success — this is
  exactly the AC and exactly what D4 requires. No regression here.
- The `nodeSnapshotRepo`-null-guard bug fix is real and complete: I traced
  `OutputControlsValidator.reject`/`controlEligible` — a `null`
  `nodeSnapshotRepo` now only short-circuits the `"dropdown"` branch (line
  103-104); `text`/`numeric-range`/`date-range` all resolve purely from
  `output.schema` + `staticOperatorsFor`, independent of `nodeSnapshotRepo`.
  No residual hole for the other three kinds under any configuration.
- Migration V112 correctly mirrors V108's RLS bracket; `PanelRowMapper`'s
  tolerant-decode-with-fallback is consistent with `form_config`'s pattern.
  `PanelRepository`'s `configColumnsOf`/`configColumnValuesOf` tuple was
  correctly extended (verified — HEL-909/HEL-1083 discipline honored).
- `updatePanelOutputControls` thunk (vs. literal `accumulatePanelUpdate`
  D7 text): verified legitimate — `PanelUpdateFields`
  (`frontend/src/features/panels/types/panel.ts:372-376`) genuinely only
  carries `title`/`appearance`/`type`, confirming the claimed architectural
  boundary is real, and `FormEditor.tsx` already establishes exactly this
  precedent (`updatePanelForm`, its own dedicated thunk, not
  `accumulatePanelUpdate`) for an analogous per-subtype config editor. The
  two-click AC is satisfied regardless of mechanism since `editor.add()` is
  a synchronous local-state update independent of the save thunk. Not a
  defect.
- `OutputControlsEditor.css` uses only `--app-*`/`--space-*`/`--text-*`
  tokens; no hardcoded values.
- File-size budget: `PanelService.scala` is 763 lines (pre-existing, well
  over CONTRIBUTING.md's informational ~400-line trigger), but this ticket's
  net addition to it is small (~67 lines) precisely because validation logic
  was extracted into `OutputControlsValidator.scala` — a reasonable
  mitigation, not a new violation. Non-blocking.

### Phase 3: UI Review — PASS

Triggers matched (`frontend/**`, `schemas/**`). Servers started via
`scripts/concertino/start-servers.sh` (reused, healthy); confirmed BOTH
serve this worktree via `readlink /proc/<pid>/cwd`:
- port 6621 (frontend) → `.../worktrees/feature/output-panel-control-config/HEL-1189/frontend`
- port 9528 (backend) → `.../worktrees/feature/output-panel-control-config/HEL-1189/backend`

Live-verified against a real Output panel ("Revenue table", schema
`idx:string`, `label:string`, `revenue:integer`):
- Two-click add: clicked "Add control" → "Numeric range" → control appeared
  immediately, auto-bound to `revenue` (the only integer column — correctly
  the sole eligible one; `idx` is declared `string` despite looking numeric
  in the grid, verified via `GET /api/outputs/:id`).
- Kind-offering parity: only "Numeric range" and "Text" offered; "Dropdown"
  correctly excluded ("label" has 58/60 distinct values, over the 50 cap)
  and "Date range" correctly excluded (no timestamp column) — matches
  Requirement 3's scenario live, not just in unit tests.
- Rebind: column picker correctly offered only the currently-eligible
  column(s) for the control's kind.
- Remove: announced via live region ("Numeric range control removed.").
- Keyboard-only add: Tab → Enter/ArrowDown/Enter added a control with zero
  pointer interaction.
- Orphan indicator (editor-local): confirmed via code
  (`OutputControlRow.tsx:47-67`) as a non-color-only badge (AlertTriangle
  icon + text "Orphaned — bound column no longer fits this control"), and
  the orphaned control's current (now-ineligible) column is still shown in
  the rebind picker labelled "(no longer eligible)" rather than disappearing
  — good defensive touch.
- Both themes: dark (default) and a forced light theme both render the
  Controls section consistent with the rest of the modal — tokens applied
  correctly, no contrast/layout breakage. Evidence:
  `.concertino/runs/HEL-1189/evidence/.evidence-scratch/controls-dark.png`,
  `.../controls-light-attempt.png`.
  Note: light theme was reached by forcing `data-theme`/class attributes
  directly (no visible in-app theme toggle button was found on this page at
  this viewport within my review budget) — visually consistent with the
  rest of the app's existing light-mode styling, but not a click-through of
  the app's own toggle affordance; treat as corroborating, not exhaustive.
- Mobile stack (400×800): Controls section renders correctly as a stacked
  single column, consistent with Appearance/Output sections above it.
  Evidence: `.../controls-mobile-edit.png`.
- No console errors attributable to this change. One pre-existing,
  unrelated 502 on `/api/pipelines/.../run-events` (an SSE/live-events
  endpoint) appeared on initial page load, before any interaction with
  Controls — not touched by this diff, not counted against this review.

Non-blocking note: Playwright's own console-log/screenshot auto-save
defaulted to `/home/matt/Development/helio/.playwright-mcp/` (the MAIN
checkout root, not this worktree) for a couple of incidental captures before
I started pinning explicit `filename` paths — this is the known
"parallel Playwright hazard" (pre-existing tooling behavior, not something
I could suppress via the MCP tool's parameters for every call type). All
screenshots I *cite* as evidence were written under this worktree's
`.evidence-scratch/` and persisted via `persist-evidence.sh`, never at repo
root.

### Overall: FAIL

### Change Requests

1. Implement D5's orphan surfacing server-side, per its literal two stated
   alternatives (`OutputResponse`'s control-list projection carrying
   `orphaned: Boolean`, or a lightweight sibling endpoint) — not exclusively
   client-side. At minimum, the panel/output read path the rest of the app
   (and future leaf 3/5 consumers) actually uses must carry this field per
   `output-panel-placement`'s Requirement 3 ("reported as orphaned wherever
   the panel's controls are read"). Add a backend test asserting the field
   is present and correctly `true`/`false` on a read after schema drift.
   Un-check tasks.md 2.2 until this is done, or amend it/the spec together if
   a narrower scope is truly intended (that would need re-confirmation at
   the design gate, not a unilateral executor call, since D5 was
   adversarially reviewed).
2. Fix `OutputControlsValidator.controlEligible`
   (`backend/src/main/scala/com/helio/services/panels/OutputControlsValidator.scala:83-114`)
   to call `OutputControlEligibility.kindsFor(...)` directly instead of
   re-deriving the same per-kind logic inline, per D3's literal
   single-source-of-truth architecture. This removes the now-dead
   `kindsFor` production entry point's isolation and closes the drift-guard
   gap (today's `outputControlEligibilityDriftGuard.test.ts` does not cover
   the validator at all).

### Non-blocking Suggestions

- Consider a drift-guard (or at least a targeted unit test) asserting
  `OutputControlsValidator.controlEligible`'s per-kind decisions equal
  `OutputControlEligibility.kindsFor`'s, once/if Change Request 2 is not
  taken literally (i.e. even without a full refactor, a characterization
  test would catch future divergence).
