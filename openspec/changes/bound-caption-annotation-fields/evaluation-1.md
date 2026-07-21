## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 4 ACs addressed explicitly, none reinterpreted:
  1. Chart annotation bound to a DataType field via `fieldMapping.annotation`, resolved reactively
     through `usePanelData`'s existing per-slot loop (no new fetch path) — verified live (see Phase 3).
  2. Static `config.annotation` unchanged; literal-wins confirmed in `PanelContent.tsx`
     (`config.annotation ?? data?.annotation ?? null`) and covered by
     `PanelContent.test.tsx` + `BindingEditor.annotation.test.tsx`.
  3. Image-caption binding explicitly deferred with a documented reason in
     `openspec/changes/bound-caption-annotation-fields/specs/image-panel-type/spec.md`
     ("Image caption binding is out of scope" — infra-prerequisite rationale). Correctly not treated
     as a gap.
  4. All gates green (see Phase 2); create/PATCH/read round-trip verified both via backend
     `PanelSpec.scala` (decode/patch/applyPatch/query-selected-fields) and live browser round-trip
     (save → full page reload → re-fetch → value persists).
- Tasks 1.1–3.4 all marked done and match the diff; no partially-implemented items found.
- No scope creep: diff is confined to the chart-annotation field-or-literal wiring + doc/schema
  notes; no unrelated refactors.
- No regressions: `usePanelData`, `ChartRenderer`, and the metric/text field-or-literal precedent
  are unchanged; full test suite (1194 frontend + 1466 backend) passes.
- Schema (`schemas/panel.schema.json`) and MCP docs (`helio-mcp/src/tools/write.ts`) updated in the
  same change as the code, consistent with the `fieldMapping` free-form-object contract already in
  place (no backend domain change required, confirmed no slot allowlist in `ChartPanelConfig`/`Panel`).
- Planning artifacts (proposal/design/tasks/spec deltas) match the final implementation; no drift
  found between design.md's Decisions (D1–D4) and the diff.

### Phase 2: Code Review — PASS
Issues: none blocking. Two items specifically scrutinized per the executor's request:

1. **`BindingEditor.tsx` save-path asymmetry (`selectedTypeId !== null` vs. `selectedType !== null`)
   — confirmed intentional and correct.** `isBound` (passed to `ChartDisplayFields`, gating whether
   "Bind to field" mode is even offered) correctly requires the *loaded* `selectedType` object
   (`dataTypes.find(...)`) because it needs live field options. The save-path `annotationBound` gate
   uses `selectedTypeId` (set synchronously from the panel's initial data) specifically to avoid a
   race: if a user saves an unrelated change (e.g. refresh interval) before the async `dataTypes`
   fetch resolves, gating on `selectedType !== null` would spuriously delete an existing
   `fieldMapping.annotation` binding, since `fieldMapping` is replaced wholesale on every chart save.
   This mirrors the existing `selectedType &&` gating used for scatter/aggregation field displays
   elsewhere in the same file (lines ~357, 377, 389), while reserving the more permissive
   `selectedTypeId` specifically for the persistence path. No defect found; well-reasoned and
   defensible.
2. **`BindingEditor.tsx` at ~460 lines (over the ~400 soft budget) — non-blocking, pre-existing.**
   Confirmed via `git show main:...BindingEditor.tsx | wc -l` → 417 lines *before* this change (i.e.
   already over budget). This change added ~43 lines. `check:scala-quality` file-size warnings are
   explicitly informational-only per CONTRIBUTING.md and apply to backend files only; there's no
   frontend-file-size lint gate. Per CONTRIBUTING.md's refactor-discipline guidance ("keep refactors
   behavior-preserving... flag latent issues as separate spinoff tickets"), splitting this file is
   correctly treated as out-of-scope for this ticket. Recommend the executor/orchestrator file a
   spinoff ticket (e.g. extract a `ChartAnnotationBindingFields`-style hook block mirroring
   `MetricBindingFields`) rather than growing this further in future annotation/binding work.
- **DRY**: annotation reuses `BoundOrLiteralField`/`useBoundOrLiteralState`/`defaultBoundOrLiteralMode`
  verbatim — no re-derivation of the mode-toggle or default-heuristic logic.
- **Readable**: naming (`annotationState`, `annotationBound`) and inline comments clearly document
  the literal-wins/merge-vs-delete logic.
- **Type safety**: no `any`/untyped escape hatches introduced.
- **No dead code**: no leftover TODO/FIXME; `check:scala-quality` and ESLint both clean.
- **No over-engineering**: no new abstractions beyond the already-established pattern.
- **Tests meaningful**: `BindingEditor.annotation.test.tsx` exercises both save directions
  end-to-end (mocking only `panelService.updatePanelBinding`); `PanelContent.test.tsx` covers all
  four literal/bound/both/neither permutations; `PanelSpec.scala` covers decode, patch,
  applyPatch/duplication, and query-selected-fields on the backend. These would catch a real
  regression (e.g. reverting literal-wins order, or dropping the `annotation` merge).
- Ran fresh: `npm run lint`, `npm run format:check`, `npm run check:schemas`, `npm run
  check:scala-quality`, `npm test` (1194 passed), `frontend/ npm run build` (succeeded),
  `backend/ sbt test` (1466 passed) — all green, no reliance on the executor's self-report.

### Phase 3: UI Review — PASS
Issues: none.

Verified live against `HEL-248 Chart Config Eval` dashboard's "Mobile Title Test" chart panel
(bound to the "Profit" DataType, fields `date`/`profit`):

- **Happy path (AC1)**: switched Annotation to "Bind to field", selected `profit`, saved — panel
  rendered `2000000` (the bound row value) beneath the chart. Reloaded the full page and
  re-navigated to the dashboard — the bound annotation and its "Bind to field"/`profit` selection
  persisted (fresh GET after PATCH, confirming round-trip).
- **Backward compatibility (AC2)**: switched back to "Fixed text", typed "Static fallback note",
  saved — panel immediately rendered the static text, `fieldMapping.annotation` cleared to
  undefined and `config.annotation` set. Confirms literal-wins and mutual exclusivity end-to-end.
- **No console errors** across the whole flow (0 errors throughout the session; only pre-existing,
  unrelated ECharts "can't get DOM width" warnings during modal-open transitions, not introduced by
  this change).
- **Accessible names / keyboard support**: mode toggle buttons are native `<button>`s with
  `aria-pressed`; the field/text controls carry `aria-label`s (`"Annotation field"` /
  `"Annotation text"`) — all discoverable via role-based queries, consistent with the existing
  Metric label/unit pattern.
- **Breakpoints** (1440 / 1100 / 768 checked — the annotation control has no custom CSS, reusing
  `BoundOrLiteralField`'s existing shared markup): mode toggle + field/text control render cleanly
  with no overflow or clipping at any width; the modal's existing scroll container handles the
  extra row without layout breakage. (0-width/narrow-mobile not separately re-checked beyond 768,
  since the control introduces no new CSS — DESIGN.md mechanical rules are satisfied by construction,
  no new tokens/hardcoded values added.)
- Dev servers started via `scripts/concertino/start-servers.sh` / `assert-phase.sh` (both PASS);
  no environmental issues.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- Consider filing a spinoff ticket to split `frontend/src/features/panels/ui/editors/BindingEditor.tsx`
  (currently ~460 lines, over the ~400-line soft budget, already over-budget pre-change at 417 lines)
  — e.g. extracting a dedicated chart-annotation/display binding block mirroring the existing
  `MetricBindingFields` decomposition. Not a blocker for this ticket; flagged by the executor and
  independently confirmed as pre-existing debt, not something this change should absorb per the
  behavior-preserving/no-drive-by-refactor discipline in CONTRIBUTING.md.
