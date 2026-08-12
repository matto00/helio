## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- All four ticket ACs addressed explicitly:
  1. Metric CRUD (create/edit/deprecate/delete) with DataType-constrained measure/dimension pickers —
     `MetricEditorForm.tsx` + `AllowedDimensionsPicker.tsx`, verified live (create/edit render correctly,
     `fieldOptions(selectedType)` scopes both pickers).
  2. Panel bind-to-metric mode setting `metricId`, showing resolved measure/aggregation/format, persisted
     via 418-C — `useMetricBindingState.ts` / `MetricPicker.tsx` / `MetricBindingFields.tsx` /
     `BindingEditor.tsx`; verified live end-to-end (selected a metric on a chart panel, saved, reloaded,
     confirmed `metricId` persisted and field-mapping stayed independently editable per D6).
  3. DESIGN.md-following UI, lint zero-warnings + format:check — confirmed via fresh gate run (Phase 2).
  4. Redux slice + component Jest coverage, `npm test` passing, no unjustified `any` — confirmed (fresh
     run: 1485 frontend + 112 helio-mcp tests passing; grep for `any` found none outside a doc comment).
- No AC silently reinterpreted.
- All 24 `tasks.md` items marked done match what's actually implemented (spot-checked 1.1–4.6 against the
  diff).
- No scope creep: diff is entirely `frontend/**` + `openspec/**`; no backend/schema changes, matching the
  proposal's explicit "no backend changes" claim (HEL-493/HEL-500 already ship the wire contract).
- No regressions found to existing behavior: `PanelDetailModal.test.tsx` /
  `PanelDetailModal.aggregation.test.tsx` were correctly updated for `updatePanelBinding`'s new trailing
  `metricId` arg rather than left to bit-rot.
- No API/schema changes needed or made (correct — this ticket is UI-only, per design.md's stated
  Non-Goals).
- Planning artifacts (design.md D1–D6) reflect the final implemented behavior: nav wiring (D1), paginated
  `.items` unwrap (D2), `AllowedDimensionsPicker`/`Toggle` as new-but-minimal primitives (D3/D4), the
  `useMetricBindingState`/`MetricPicker` extraction (D5), and chart/table's no-materialization mode (D6)
  all match the diff exactly.

### Phase 2: Code Review — FAIL

**Fresh gate run** (all commands run independently in `WORKTREE_PATH`, not trusting the executor's report):
- `npm run lint` → 0 warnings, clean.
- `npm run format:check` → clean.
- `npm test` → 112/112 (helio-mcp) + 1485/1485 (frontend) passing.
- `npm --prefix frontend run build` → succeeds (`vite build`, PWA precache 15 entries / 2248.35 KiB).//
  Confirms the executor's `vite.config.ts` `maximumFileSizeToCacheInBytes` fix is real and holds.

No `backend/**` files changed, so `sbt test` was not required (confirmed via
`git diff --name-only main...HEAD`).

**Issues:**

1. **[Bug, found live] `AllowedDimensionsPicker.tsx` does not contain the Escape key to its own popover —
   pressing Escape while it is open closes the entire parent modal, discarding all in-progress form
   state.** `frontend/src/features/metrics/ui/AllowedDimensionsPicker.tsx:52-70` — the trigger `<button>`
   has no `onKeyDown` handler. Contrast with `frontend/src/shared/ui/Select.tsx`'s trigger button (`onKeyDown={handleKeyDown}`,
   ~line 122), whose `handleKeyDown` explicitly does `event.preventDefault()` on Escape before calling
   `closePanel()` — that `preventDefault()` is what suppresses the native `<dialog>`'s own Escape-to-close
   default action (Modal.tsx is built on native `<dialog>` + `showModal()`, "ESC closes (native
   behaviour)" per its own doc comment). `usePortalPopover`'s shared `document`-level keydown listener
   (which both components use) does not call `preventDefault()`, so nothing stops the native dialog
   dismissal from also firing whenever the *trigger* itself doesn't intercept the key first.
   Design.md D3 explicitly states this component "match[es] `Select`'s existing portal pattern" — it
   copied the portal/positioning/scrim mechanics but not the keyboard-containment half of that pattern,
   so the parity claim is incomplete. See Phase 3 for the live reproduction/probe. This is newly-written
   code for this ticket, not inherited debt (`Select.tsx` itself does not exhibit the bug — verified by
   direct comparison in the identical modal).
   **Fix:** add an `onKeyDown` handler to the trigger button in `AllowedDimensionsPicker.tsx` that, on
   `Escape` while `isOpen`, calls `event.preventDefault()` and `close()` — mirroring
   `Select.tsx`'s `handleKeyDown`.

**Non-blocking suggestions** (do not block this cycle):

- **DESIGN.md [mechanical] spacing-token rule** ("All margin/padding/gap use a `--space-*` token; small
  optical tweaks ≤4px may be literal", DESIGN.md line ~110) is violated by literal px values in three new
  files: `frontend/src/features/metrics/ui/MetricEditorForm.css:4,10` (`gap: 14px`, `gap: 5px`),
  `frontend/src/features/metrics/ui/MetricsPage.css:5,12,29,35,36,83,164`, and
  `frontend/src/features/metrics/ui/MetricDetailPage.css:5`. However, every one of these values is a
  byte-for-byte match of pre-existing sibling files this ticket was explicitly directed to mirror
  (`frontend/src/features/pipelines/ui/PipelinesPage.css`, `CreatePipelineModal.css`,
  `frontend/src/features/sources/ui/AddSourceModal.css`, `PipelineDetailPage.css:557` — same `gap: 14px`/
  `gap: 5px`/`padding: 20px 24px`/`padding: 2px 7px` pattern predates this ticket in at least 4 other
  files). Flagging this here without also flagging the pre-existing sibling files would arbitrarily
  penalize this ticket for faithfully following its own design.md-directed precedent; treat as pre-existing
  repo-wide debt, out of this ticket's scope, and a candidate for a follow-up repo-wide token-alignment
  ticket. (The genuinely new `PanelDetailModal.binding.css` block added by this ticket, lines 259–284, is
  fully token-compliant — no violation there.)
- **File-size soft budgets** (CONTRIBUTING.md: "~250 lines per source file... if a file you're editing
  crosses ~400 lines, propose a split in the PR description"): `frontend/src/features/panels/ui/editors/BindingEditor.tsx`
  is now 520 lines (up from 493 pre-ticket, already past the 400-line threshold before this ticket
  started); `frontend/src/features/metrics/ui/MetricEditorForm.tsx` is 323 lines (over the 250 soft budget,
  under 400). Design.md D5 already anticipated and minimized `BindingEditor.tsx`'s growth via the
  `useMetricBindingState`/`MetricPicker` extraction — the file still needed ~27 net new lines to wire the
  extracted hook into its existing save/dirty/reset plumbing, which is a reasonable minimal footprint, not
  scope creep. No PR exists yet at this workflow stage (PR creation happens at Phase 3 Delivery), so the
  "propose a split in the PR description" instruction cannot yet have been followed — flag for the PR
  description at delivery time rather than blocking here.

### Phase 3: UI Review — FAIL

Servers started via `scripts/concertino/start-servers.sh` (reused already-healthy instances) and confirmed
via `assert-phase.sh servers` → `PASS servers`.

**Checks:**

- [x] Happy path works end-to-end for most flows: Metrics list loads and renders existing data
      (`Eval Test Metric` → Netflix Data / user_rating_score / sum / active); "New metric" modal opens,
      DataType picker/measure-field picker/aggregation picker/allowed-dimensions picker all function and
      correctly scope to the selected DataType's fields; panel bind-to-metric mode on a chart panel: selected
      "Eval Test Metric", saved, reloaded the page, re-opened the panel editor, and confirmed `metricId`
      persisted while the chart's own X Axis/Y Axis field-mapping controls remained independently editable
      (design.md D6) — network tab confirmed `PATCH /api/panels/:id` → 200.
- [ ] **FAIL — Unhappy path / keyboard support: reproducible data-loss bug.** Opening the "Allowed
      dimensions" popover inside the "Create metric" modal and pressing Escape — even without touching any
      checkbox — closes the *entire* Create metric modal (not just the popover), discarding the metric name,
      selected DataType, measure field, and any other in-progress edits. Reproduced twice, deterministically.
      **Probe**: opened "Create metric" → selected DataType "Netflix Data" → opened "Allowed dimensions" →
      confirmed via `document.activeElement` evaluation that focus was on the trigger button (a descendant of
      the `<dialog>`) → pressed Escape → entire dialog vanished (confirmed via snapshot: no `dialog` node
      present, `list` showed "New metric" trigger button active again, all entered data gone). **Control**:
      repeated the identical open+Escape sequence on the *pre-existing* "Aggregation" `Select` dropdown in the
      same modal (same portal-into-dialog target, same focused-trigger-button pattern) — Escape correctly
      closed only the Select's own dropdown; the modal and all entered data remained intact. This isolates the
      defect to `AllowedDimensionsPicker.tsx`'s missing keyboard handling (see Phase 2 issue 1), not to the
      shared `usePortalPopover` hook or `Modal.tsx`.
- [x] Loading/empty/error states present in code (`MetricsPage.tsx`'s `status === "loading"`/`"failed"`/
      empty-with-`MetricEmptyState` branches; `MetricDetailPage.tsx`'s loading/error guards) — reviewed via
      diff, not independently forced (would require injecting a fetch failure), but the code path
      structurally matches `PipelinesPage.tsx`'s established, already-verified pattern.
- [x] No console errors during any tested flow (checked after every major interaction; 0 errors, 0
      warnings from this ticket's own code — one pre-existing unrelated warning present throughout the
      session, unrelated to this change).
- [x] Feature reachable from all relevant entry points: top nav `Metrics` link, sidebar `Metrics` section
      (fetches on nav per `SidebarBody.tsx`), and breadcrumb — all confirmed live.
- [x] Interactive elements have accessible names (all comboboxes/buttons/checkboxes have proper
      `aria-label`/label text, confirmed via accessibility snapshot throughout) — **except** the keyboard
      *support* half fails for `AllowedDimensionsPicker` per the bug above (Escape is a standard, expected
      keyboard affordance for any picker/popover, and here it does something destructive instead of the
      expected "close this control only").
- [x] Breakpoints 1440/1100/768/375 (mobile) all render without new layout breakage. At 375px the metrics
      list table overflows horizontally with no scroll affordance — but this is byte-for-byte the same
      pre-existing behavior as `/pipelines`'s list table at the same width (confirmed via screenshot
      comparison), not a regression introduced by this ticket.

### Overall: FAIL

### Change Requests

1. **Fix the Escape-key data-loss bug in `AllowedDimensionsPicker.tsx`.** Add an `onKeyDown` handler to
   the trigger `<button>` (currently `frontend/src/features/metrics/ui/AllowedDimensionsPicker.tsx:52-70`)
   that, when `event.key === "Escape"` and the popover `isOpen`, calls `event.preventDefault()` then
   `close()` — mirroring `frontend/src/shared/ui/Select.tsx`'s `handleKeyDown` (its `Escape` branch,
   ~line 94-97). Without `preventDefault()`, the key event's native default action still reaches
   `Modal.tsx`'s underlying `<dialog>` element and triggers its native Escape-to-close behavior, closing
   the whole modal and discarding all in-progress form state. Add a regression test to
   `frontend/src/features/metrics/ui/` (a new or extended test file) asserting that pressing Escape while
   the Allowed-dimensions popover is open, inside a `Modal`, closes only the popover and leaves the modal's
   other field values intact (e.g. render `MetricEditorForm` inside a `Modal` in the test, fill the name
   field, open Allowed dimensions, press Escape, assert the modal is still present and the name field
   still holds its value).

### Non-blocking Suggestions

- DESIGN.md spacing-token literal-px values in `MetricEditorForm.css`, `MetricsPage.css`,
  `MetricDetailPage.css` mirror pre-existing debt in `PipelinesPage.css`/`CreatePipelineModal.css`/
  `AddSourceModal.css`/`PipelineDetailPage.css` — consider a follow-up repo-wide token-alignment ticket
  rather than fixing in isolation here.
- `BindingEditor.tsx` (520 lines) and `MetricEditorForm.tsx` (323 lines) are past/approaching
  CONTRIBUTING.md's file-size soft budgets — call out a split proposal in the eventual PR description per
  CONTRIBUTING.md's own instruction (no action needed pre-PR).
