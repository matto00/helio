## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit `7b104e84626c93c48fd2dca84cbe941d817eb37f` on `feature/form-field-type-builder/HEL-1084`, diffed against `origin/main` at `ab4cad578d05576beb3a19ef7244799db6953172` (resolved fresh via `resolve-review-base.sh`).

### Phase 1: Spec Review — PASS

- AC1 (author-time schema mismatch, both halves): confirmed. Builder half verified live (see Phase 3). Write-API half: `FormSchemaConsistency.check` implements D1(b)-(e) exactly, `PanelService.rejectInconsistentForm`/`effectiveFormConfig` implement D1(a) and C2 (evaluated on the EFFECTIVE post-patch config, not the incoming patch alone). Backend test suite (4630 tests) includes `FormPanelRoundTripSpec`'s full pinned set (csv-kind rejection, undeclared field, unfit control, bad options, bad initialValue, re-bind re-validation, consistent round-trip) — all green.
- AC2 (declared fields only, fitting controls only): `FormFieldRow.tsx` offers only `availableFields` (declared minus used) and `fitting` controls from `formConfigValidation.fittingControls`; no free-typed `sourceField`.
- AC3 (add/remove/reorder + per-field attributes incl. tighten-only required, step, options): implemented in `useFormEditorState.ts`/`FormFieldRow.tsx`/`FormOptionsEditor.tsx`; Required toggle correctly renders checked+disabled with "Required by the dataset" hint and omits the key when dataset-required (verified live).
- AC4 (form creatable from dashboard UI): `OutputPicker` gained a "Form" content card; verified live — clicking it opens a "Choose a dataset" step, selecting a dataset creates and binds the panel in one action, no auto-open (matches D6).
- AC5 (a11y, derived): computed-accessible-name pattern used throughout (`aria-label`s built from field label, `toHaveAccessibleName` assertions in tests); `role="alert"` issue summary and inline field errors present. One real defect found under rendered measurement — see Phase 3.
- No scope creep found: all touched files are within the ticket's declared impact (FormPanel.scala, FormSchemaConsistency.scala, PanelService.scala, the new editor components, OutputPicker/DatasetStep, PanelDetailModal's two if-chain arms, panel.schema.json). `PanelContent.tsx` D10 placeholder correctly left untouched (out of scope, HEL-1085).
- No regressions: full backend (4630) and frontend/helio-mcp (3520 + 271) suites green; CSS-file-count guards (`elevationTokenGuard`/`motionTokenGuard`) bumped mechanically for the one new CSS file, not a design-language change.
- Schema contract updated in the same change: `schemas/panels/panel.schema.json` `$defs.FormFieldConfig.options` tightened (`minItems: 1`), matching D3; `check:schemas` passes.
- Planning artifacts reflect implemented behavior; tasks.md fully checked off and matches the diff.
- `workflow-state.md` CONSTRAINTS: none found beyond tasks.md's Standing Constraints (C1-C7), all honored — see Phase 2.

### Phase 2: Code Review — PASS

Gates run fresh, in `WORKTREE_PATH` (no `CLEAN_WORKTREE` for this run):
- `npm run lint` — clean (zero warnings).
- `npm run format:check` — clean.
- `npm test` (root, includes helio-mcp) — 28 suites / 271 tests passed; `npm --prefix frontend test` — 327 suites / 3520 tests passed.
- `npm run typecheck` — clean (no C1 lucide-react environmental failure surfaced on this run).
- `npm --prefix frontend run build` — succeeds.
- `npm run check:schemas` — in sync (96 protocol surfaces, panel-type enums, AssistantProposalToolSchemas).
- `npm run check:openspec` — clean.
- `npm run check:scala-quality` — clean (175 pre-existing soft warnings, none newly introduced by this diff).
- `cd backend && sbt test` — 4630 tests, 0 failed, 0 canceled. Matches the executor's claimed count.

Code-quality:
- Canonical compliance: all new files well within CONTRIBUTING's size budgets (largest new frontend file 227 lines; `FormSchemaConsistency.scala` 66 lines). `FormEditor.css` uses only `--app-*`/`--space-*`/`--text-*` tokens, no hardcoded values (DESIGN.md mechanical compliance).
- C4 (single source of truth for the fitness matrix): `controlFitnessDriftGuard.test.ts` genuinely parses `FormPanel.scala`'s `FittingControls` literal via regex from the actual source file (not a hand-copied twin) and diffs it against `CONTROL_FITNESS`; mutation evidence in `mutation-evidence.md` shows it goes RED when a TS cell is mutated.
- C2 mutation evidence: removing the `update` effective-config hook produces exactly one RED test (the re-bind test) while every create-time test stays green — a precise, correctly-scoped mutation.
- C5 mutation evidence: removing the `renderSubtypeEditor` `isFormPanel` arm produces the expected RED (`PanelDetailModal` test) with the other if-chain arm (`activeEditorRef`) also enumerated separately in the diff.
- No dead code, no untyped escape hatches, no magic values found in the reviewed diff.
- DRY: reuses `DatasetRowValidator.validateValue`, shared `TextField`/`Select`/`Toggle`/`IconButton`/`FormField`/`EmptyState`/`Skeleton`/`InlineError` components throughout — no reinvented primitives.
- Error handling: schema-fetch failure surfaces `InlineError` + retry; save failure surfaces inline and re-fetches the schema (per D5); write-API 400s carry field-naming messages.

### Phase 3: UI Review — FAIL

Exercised against the running app on this run's ports (dev 6516, backend 9423), confirmed via `readlink /proc/<pid>/cwd` for both the Vite dev server (PID 1779583) and the backend (PID 1779198) resolving to this worktree, and `location.href` re-checked as `http://localhost:6516/` after every navigation.

Verified working:
- AC1 builder half: opening the sheet on a form panel bound to a dataset whose config has orphaned fields (residue from a prior eval session, 3 undeclared fields) immediately surfaced a field-associated `alert` on each and a `role="alert"` issue summary naming all three — on open, with no interaction needed.
- Save-blocking: after editing (removing one orphaned field, leaving two remaining issues), clicking Save was refused — the modal stayed in edit mode and an inline "Fix every field error before saving." paragraph appeared, matching D5/AC1. After clearing all remaining issues, Save succeeded and returned the modal to view mode.
- AC4: the "Add panel" picker offers an "Add Form panel — choose a dataset" content card; activating it switches to a "Choose a dataset" step (search box, listbox of `dataset`-kind sources, Back button); selecting one creates and binds the panel in a single dispatch with no auto-open, matching D6.
- Required (tighten-only): a dataset-required field rendered its Required toggle checked and disabled with hint "Required by the dataset" (matches D4).
- Both themes: dark (default) and light (toggled via `data-theme`) render the builder with correct contrast and token-consistent styling; no layout breakage.
- Breakpoints 1440/1100/768/0(375): no overflow or breakage at any width; the modal correctly reflows to full-screen at the mobile width.
- No console errors/warnings across the whole flow (`browser_console_messages` reported 0/0/0 for the full session).

**Defect found — AC5/D7 focus management, measured live (not jsdom):**

Design D7 states: "focus moves to the new row's field select after Add and to the next row (or the Add button) after Remove." `FormEditor.tsx`'s `onRemove` handler (lines 192-198) only explicitly moves focus in the one case where the field list becomes empty (focuses the Add button). For every other removal, no explicit focus call exists at all. In practice:
- Removing a row that is **not the last row in the DOM** happens to retain focus correctly, but only as an accident of `key={index}` reuse in `FormEditor.tsx`'s `.map()` (`frontend/src/features/panels/ui/editors/FormEditor.tsx:178`) — React reconciles the same DOM button node into the next field's position, so the browser's focus is preserved on a node that gets relabeled underneath it. Verified: removing the first of three rows left focus on what is now labeled "Remove Note" (the field that shifted into that position).
- Removing the **last row in a list with more than one remaining field** (e.g. removing field 2 of 2) has no DOM node to reuse — the removed button's node is destroyed outright and focus is lost to `document.body`. Verified directly: after removing "attachment" (index 1 of a 2-field list), `document.activeElement` was `<body>`, not the remaining row's "Remove Note" button, the Add button, or any other in-page focusable element.

This is a real, keyboard-user-facing a11y regression against AC5 and design.md D7 — a screen-reader or keyboard-only user loses their place in the form entirely after this specific removal pattern (removing the last field when 2+ remain). It was not caught by the existing test suite because task 3.6 explicitly defers focus/visibility claims to rendered (Playwright) measurement, per C6 — jsdom evidence does not exercise real DOM node identity/reconciliation, so this exact interaction was never actually measured before this review.

### Change Requests

1. **`frontend/src/features/panels/ui/editors/FormEditor.tsx`, `onRemove` handler (~lines 192-198)**: explicitly move focus after every `Remove`, not only the empty-list case. When removing a row that is not the last remaining field, move focus to the new occupant of that row's position (or the next row) rather than relying on `key={index}` DOM-node reuse as an implicit mechanism; when removing the last row in a multi-row list (not reducing to zero), explicitly focus the row that shifted into the removed row's position (or the Add button if none). Add a Playwright-verifiable assertion path, or at minimum note in `mutation-evidence.md`/a follow-up why jsdom cannot catch this class of defect, since it evaded the existing test suite entirely.

### Non-blocking Suggestions

- `FormEditor.tsx`'s `saveError` state (the "Fix every field error before saving." message) is not cleared when the underlying issues are subsequently resolved by further edits — it persists until the next save attempt or a `reset()`. Observed live: after resolving all issues, the stale message remained visible until Save was clicked again (at which point it correctly succeeded). Not blocking — the stale text does not block the functional save path — but it is momentarily misleading to an author who has just fixed the last issue. Consider clearing `saveError` whenever `issues.length` transitions to 0, or whenever the field list changes.
- Consider using `key={field.sourceField}` or a stable synthetic id instead of `key={index}` in `FormEditor.tsx`'s field-row map — this would make the row's DOM identity (and therefore focus behavior) predictable by construction rather than by incidental reconciliation, and would likely resolve the Change Request above as a side effect.

### Critical Path

N/A — this is cycle 1 of the run (not necessarily the final cycle); Critical Path is only appended when `CYCLE` equals the run's resolved `EXECUTION_CYCLES` and the verdict is FAIL. Resolve Change Request 1 (focus management on Remove) and re-request evaluation.
