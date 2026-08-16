## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- AC1 (real added/dropped/retyped diff, placeholder gone): confirmed. `computeSchemaDiff`
  (`frontend/src/features/pipelines/state/schemaDiff.ts`) computes all four buckets from
  `inputSchema`/`outputSchema`; `StepCard.tsx` now renders `<StepSchemaDiffChips>` once, above
  the op-kind editor branch (line ~256), so it applies to every op kind including the fallback.
  The hardcoded `+ col_a` / `− col_b` / `~ col_c` block is fully deleted from the fallback branch
  (verified via diff and `grep -rn col_a frontend/src` returns only test assertions that it's
  absent).
- AC2 (rename shown as rename where determinable): confirmed. Rename pairing is gated on
  `step.opType.id === "rename"` passing `renamesOf(step)`; the algorithm only pairs a `from`/`to`
  entry when `from` is in raw-dropped and `to` is in raw-added, otherwise leaves both as add/drop
  — matches spec.md's "Rename op pairs..." and "Non-rename ops never report renames" scenarios
  exactly, and both are covered by tests.
- AC3 (diff helper unit-tested): confirmed, 8 cases in `schemaDiff.test.ts` covering
  added/dropped/retyped, paired rename, unpaired rename stays add/drop, rename+retype still
  pairs, identical schemas, empty arrays — all four spec.md scenarios have a directly
  corresponding test.
- AC4 (DESIGN.md + backward compatible, no wire change): confirmed. No backend/schema files
  touched; `git diff main...HEAD --stat` shows frontend + openspec-artifact files only. New CSS
  is token-only (see Phase 2).
- Tasks 1.1–3.4 all marked `[x]` and match the diff: helper, component, CSS modifier, StepCard
  wiring, both test files, files-modified.md notes, and all four gates run clean (independently
  re-verified in Phase 2, not just trusted from the executor's own report).
- No scope creep: `git diff main...HEAD --stat` touches exactly the six files design.md/tasks.md
  anticipated (helper, helper test, component, StepCard, StepCard test, one CSS rule) plus the
  planning-artifact files themselves. No backend or schema files touched, matching the ticket's
  explicit out-of-scope note.
- No regression to other specs: `pipeline-step-preview` (HEL-404's preview tray) is untouched;
  the diff strip is a new, structurally separate render call above the op-editor branch, not a
  modification of the preview code path. Full Jest suite (1768 tests) passes, including all
  pre-existing StepCard/PipelineDetailPage tests, so nothing broke silently for other op kinds
  whose default test props (`analyzeSchema: []`, `analyzeOutputSchema` with 2 fields) now also
  render a diff strip — no prior assertion was invalidated by that.
- New capability spec (`specs/pipeline-step-schema-diff/spec.md`) matches the implemented
  behavior scenario-for-scenario; no spec/implementation drift found.
- API contracts: none affected (frontend-only, no wire change), consistent with the ticket.

### Phase 2: Code Review — PASS

Issues: none.

**Gates (freshly re-run by me, not trusted from the executor's report), all from
`WORKTREE_PATH/frontend` (no `CLEAN_WORKTREE` — `EVALUATOR_CLEAN_WORKTREE: false` in
workflow-state.md):**
- `npm run lint` → clean (0 warnings/errors)
- `npm run format:check` → "All matched files use Prettier code style!"
- `npm test` → 176 suites / 1768 tests, all passed
- `npm --prefix frontend run build` → succeeds (pre-existing >500kB chunk-size warning, unrelated
  to this change)

Backend gate not applicable — no `backend/**` files changed.

**CONTRIBUTING.md compliance:**
- File-size budgets: new files are small (`schemaDiff.ts` 69 lines, `StepSchemaDiffChips.tsx` 61
  lines), well under the ~250-line soft budget. `StepCard.tsx` net **decreased** 440 → 434 lines
  (verified via `wc -l`), matching files-modified.md's claim exactly. It remains past the
  400-line soft budget, but CONTRIBUTING.md only requires *proposing a split* when a file you're
  editing crosses ~400 — the ticket's delivery notes explicitly scope that split to HEL-682 and
  direct not to bundle it here; correctly honored (no unrelated restructuring of StepCard.tsx).
- Imports & qualifiers: no inline FQNs; `renamesOf` and `StepSchemaDiffChips` are proper
  top-of-file imports.
- Frontend rules: `computeSchemaDiff` is a pure function under `state/`, `StepSchemaDiffChips` is
  a presentational component — matches "move reusable behavior into hooks/selectors/utilities"
  and "components primarily presentational." No `any` usage; `SchemaField`, `RenamedField`,
  `RetypedField`, `SchemaDiff` are all explicitly typed.
- Hooks bypass: commit 8077eba7 used `-n` and explicitly called out why (`check:openspec` only,
  because the change isn't archived yet — a known workflow-stage false-positive, not a real gate
  failure) and stated all other hooks were independently verified clean before committing. This
  satisfies CONTRIBUTING.md's "any bypassed checks must be... called out explicitly" requirement.

**DESIGN.md compliance (mechanical rules, frontend change):**
- Token usage: the new `--renamed` chip rule (`PipelineDetailPage.css:445-449`) uses
  `var(--app-warning-surface)`, `var(--app-warning)`, and
  `color-mix(in srgb, var(--app-warning) 35%, transparent)` — all real, themed tokens (confirmed
  present in both `:root[data-theme="dark"]` and `:root[data-theme="light"]` blocks of
  `theme.css`). No hardcoded hex/rgb. Mirrors the `--removed` sibling's exact
  `color-mix(...35%...)` border pattern.
- No new literals: the rule reuses the existing `.pipeline-detail-page__step-card-diff-chip` base
  class for `font-family`/`font-size`/`padding`/`border-radius` (all already token-based except
  the pre-existing `2px 7px` padding literal, which design.md explicitly and correctly defers to
  HEL-680 rather than propagating to a new recipe).
- Shared-component reuse: chips are plain `<span>` elements matching the three existing sibling
  chips' structure — no new ad-hoc UI primitive introduced where a shared one exists (chips
  aren't a cataloged shared component in DESIGN.md §6, and the executor correctly reused the
  existing bespoke recipe rather than inventing a new one).
- UI-state pattern (§7): `StepSchemaDiffChips` returns `null` (no empty container) when all
  buckets are empty — correctly implements "never render nothing [for empty]... render `EmptyState`"
  is for page-level empty states; for a decorative diff strip with genuinely no content, rendering
  nothing (no container) is the documented behavior per spec.md's own "no empty diff container"
  requirement, not a violation.
- Breakpoints: untouched, no new media queries.

**DRY / Readable / Modular / Type safety:** `computeSchemaDiff` reuses `Map`-based name→type
lookups cleanly, no duplication with any existing diff logic in the codebase (grepped — this is
genuinely new logic, not a copy of something else). Naming is clear (`added`/`dropped`/`renamed`/
`retyped`, `RenamedField`/`RetypedField`). No magic values. The component/helper split correctly
respects the file-size constraint from design.md Decision 2.

**Security / Error handling:** No new I/O, no user input reaching this code path beyond
already-validated analyze-response data; nothing to sanitize. Pure functions with no side
effects; `undefined` renames map handled via an `if (renames)` guard rather than throwing.

**Tests meaningful:** Both test files exercise real regression-catching paths — e.g. the
"renders diff chips for an op WITH a dedicated editor (select)" test would fail if a future edit
moved the diff strip back inside a per-op-kind branch; "never renders col_a/col_b/col_c" would
catch a reintroduction of the placeholder; the "renamed even when type also changes" test would
catch a regression to the type-taken-from-input-side alternative. Assertions use
`toHaveTextContent`/`toEqual` against concrete values, not snapshot rubber-stamps.

**No dead code / no over-engineering:** No leftover TODO/FIXME/console.log. No premature
abstraction — the helper takes exactly the inputs the one caller needs, no speculative options
(e.g., no "+k more" truncation, correctly deferred per design.md Decision 4 as YAGNI).

**Behavior-preserving where expected:** N/A — this is new behavior (replacing a hardcoded
placeholder is the ticket's explicit intent, not a refactor expected to be behavior-preserving).

### Phase 3: UI Review — PASS

Triggered by `frontend/**` changes. Servers started via
`scripts/concertino/start-servers.sh WORKTREE_PATH 5837 8744 HEL-405`, confirmed healthy via
`assert-phase.sh servers` (`PASS servers`), and stopped afterward (verified via `lsof` on both
ports returning empty after `kill`).

- **Happy path:** Navigated to the existing `HEL-454 eval smoke` pipeline, added a temporary
  "Rename column" step (`amount` → `amount2`), expanded the card. The `--renamed` chip
  ("amount → amount2") rendered correctly in both dark theme (default) and light theme
  (screenshots taken and reviewed, then deleted — see below). Chip styling is legible with clear
  contrast in both themes and visually distinct from the three sibling chips (accent-family
  `--added`/`--changed`, error-family `--removed`) — the amber/warning tone reads as its own
  category, resolving the skeptic's design-gate non-blocking note #1 about visual distinctness.
- **Existing op kinds unaffected:** the "Assert / validate" step (pre-existing, 1 step) rendered
  normally with no diff chips (identical input/output schema in this case — correct per spec).
- **No console errors attributable to this change:** one pre-existing 404 on
  `/api/pipelines/.../schedule` (no schedule set — expected REST semantics, unrelated to
  schema-diff chips, present before any interaction with the new feature).
- **No blank screens / unhandled exceptions** during step-add, rename-config-edit, or
  step-removal.
- Cleanup: removed the temporary "Rename column" test step (pipeline back to its original 1-step
  state), deleted the two screenshot PNGs (`hel405-light.png`, `hel405-dark.png`) I created at
  the repo root, and stopped both dev-server processes bound to ports 5837/8744 (confirmed via
  `lsof`). No lingering worktree/server state left behind.
- Breakpoint/accessibility/loading-state judgment calls are the skeptic's domain per the
  guardrails; the objective checks above (renders, no console errors, both themes, entry point)
  all passed.

### Overall: PASS

### Non-blocking Suggestions

- (Carried from skeptic-design-1.md, already effectively resolved by implementation) The
  `renamed` bucket's computed `type` field has no UI display — a column that is both renamed and
  retyped in the same step won't show its type change in the chip (`name → newName` only, no
  `fromType→toType`). This is a defensible, explicitly-acknowledged simplification per design.md,
  not a defect, but could be called out as a documented non-goal in the spec if it comes up again.
