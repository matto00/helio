## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established (cold read, not trusted from prior reports):**
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/pipeline-step-schema-diff/spec.md`,
  `files-modified.md`, `evaluation-1.md`, `skeptic-design-1.md` in full.
- `git diff main...HEAD --stat` (branch `feature/per-step-schema-diff/HEL-405`, HEAD `8077eba7`):
  matches `files-modified.md` exactly — 6 real source files (`schemaDiff.ts`, `schemaDiff.test.ts`,
  `StepSchemaDiffChips.tsx`, `PipelineDetailPage.css`, `StepCard.tsx`, `StepCard.test.tsx`) plus the
  9 planning-artifact files. No backend/schema files touched, consistent with the ticket's
  "Out of scope: backend analyze changes."

**AC traceability (each ac traced to real code, not asserted):**
- AC1 (real diff, placeholder gone): read `schemaDiff.ts` in full — `computeSchemaDiff` builds
  name→type maps both directions, computes `retyped` (same name, different type, input order),
  raw `added`/`dropped` (output-only/input-only names), then pairs renames. Read
  `StepSchemaDiffChips.tsx` — renders the four chip kinds, returns `null` when all buckets are
  empty. Read the `StepCard.tsx` diff directly (`git diff main...HEAD -- .../StepCard.tsx`):
  `<StepSchemaDiffChips>` is rendered once, immediately inside `expanded && (...)`, **above** the
  giant `step.opType.id === ... ? ... : (...)` ternary covering all 21 op kinds — confirmed by
  reading lines 245-390 of the post-change file, so it fires for every op kind. The old
  `col_a`/`col_b`/`col_c` block is deleted from the fallback `else` arm (only the desc `<p>`
  remains). `grep -rn "col_a\|col_b\|col_c" frontend/src` returns only a doc-comment, a negative
  test assertion (`StepCard.test.tsx:389-397`), and unrelated `pipelinesSlice.test.ts` fixture
  data — the placeholder chip text itself is gone from runtime code.
- AC2 (rename shown as rename): `StepCard.tsx` passes
  `renames={step.opType.id === "rename" ? renamesOf(step) : undefined}`; `computeSchemaDiff` only
  pairs a `from`/`to` entry when `from` is in raw-dropped **and** `to` is in raw-added, otherwise
  leaves both — matches spec.md's two rename scenarios exactly. Verified live in the running app
  (see UI section below): a real rename (`amount`→`amount2`) rendered as a single `amount → amount2`
  chip, not an add+drop pair.
- AC3 (helper unit-tested): read `schemaDiff.test.ts` in full — 8 cases (added/dropped/retyped,
  rename-paired, unpaired-rename-stays-add/drop, rename+retype-still-pairs, identical-schemas-empty,
  empty-arrays), each directly maps to a spec.md scenario. Re-ran independently (below) — all pass.
- AC4 (DESIGN.md + backward compatible): CSS diff (`PipelineDetailPage.css`) adds one modifier rule
  using `var(--app-warning-surface)`, `var(--app-warning)`,
  `color-mix(in srgb, var(--app-warning) 35%, transparent)`. Confirmed these tokens are real and
  themed in `frontend/src/theme/theme.css` (both `:root` (dark) block, lines ~95-115, and
  `:root[data-theme="light"]` block, lines ~129-160) — not hallucinated, not hardcoded hex. No
  wire/schema/backend changes anywhere in the diff.

**Gates — independently re-run by me (not trusted from evaluation-1.md's pasted output):**
```
cd frontend && npm run lint            → clean (0 warnings, eslint src --max-warnings=0)
cd frontend && npm run format:check    → "All matched files use Prettier code style!"
cd frontend && npx jest --testPathPatterns="schemaDiff|StepCard"
                                        → 2 suites / 26 tests passed
cd frontend && npm test                → 176 suites / 1768 tests, all passed
cd frontend && npm run build           → vite build succeeds (pre-existing >500kB chunk warning,
                                          unrelated — confirmed no diff to any bundling-relevant
                                          config in this change)
```
Also ran `wc -l frontend/src/features/pipelines/ui/StepCard.tsx` (434) vs
`git show main:.../StepCard.tsx | wc -l` (440) — confirms files-modified.md's "440 → 434" claim
exactly, not just asserted.

One additional check I ran that surfaced pre-existing unrelated noise: `npx tsc --noEmit -p .`
reports ~30 type errors, all in `frontend/src/features/toasts/state/toastListeners.ts` and
`frontend/src/store/listenerMiddleware.ts` — files this branch never touches
(`git diff main...8077eba7 -- <those files>` is empty, and `git log` shows they were last modified
in HEL-525/HEL-236, unrelated commits). `npm run build` (the project's actual build gate, `vite
build`, which does not type-check) succeeds. This is pre-existing repo debt, not a regression from
HEL-405, and not one of the gates this ticket is bound to (`npm run lint` / `format:check` /
`npm test`) — noted for awareness, not a change request.

**Live UI verification (frontend/** change, DESIGN.md binding) — started servers on this run's
assigned ports only:**
```
scripts/concertino/start-servers.sh <worktree> 5837 8744 HEL-405   → READY backend, READY frontend
scripts/concertino/assert-phase.sh servers <worktree> 5837 8744 HEL-405  → PASS servers
```
- Opened the `HEL-454 eval smoke` pipeline (light theme, the app's default). Added a temporary
  "Rename column" step, typed `amount` → `amount2`: the expanded card immediately rendered a single
  `amount → amount2` chip (screenshot inspected, then deleted) — not an add chip for `amount2` plus
  a drop chip for `amount`, confirming AC2 live, not just from unit tests.
- Added a temporary "Compute column" step (`total = $amount2`): rendered a `+ total` added chip
  alongside the select/table editor for a dedicated-editor op kind — confirms the strip is not
  fallback-only in the *running app*, matching spec.md's "Diff chips appear for ops with dedicated
  editors" scenario.
- Expanded the pre-existing "Assert / validate" step (identical input/output schema): via
  `document.querySelectorAll('.pipeline-detail-page__step-card-diff')` there were exactly 2 diff
  containers on the page (the rename + compute steps I added) — the Assert step correctly renders
  **no** container at all, not an empty one, matching spec.md's "no empty diff container"
  requirement.
- **Light/dark parity, pixel-sampled (not just eyeballed):** cropped and sampled the `--renamed`
  chip vs the `--added` chip in both themes. Backgrounds are similarly pale in both themes
  (light: renamed bg `rgb(244,238,230)` vs added bg `rgb(254,240,229)` — both subtle warm
  off-whites, consistent with the *existing* `--removed`/`--changed` siblings' own "pale surface +
  saturated text/border" recipe, not a regression this ticket introduced), but text/border color is
  clearly distinct: renamed text is a brown/gold (`--app-warning`, `rgb(165,118,58)` in light theme)
  vs added text is vivid orange (`--app-accent`, `rgb(249,115,22)`) — the two chips read as
  different categories at a glance in both themes. This resolves the design-gate skeptic's
  non-blocking note #1 about the `--renamed` token choice; it is real, working, and adequately
  distinct — not the same accent-family color the design gate flagged as underspecified.
- One pre-existing console error: `404` on `/api/pipelines/.../schedule` (no schedule configured —
  expected REST semantics for a pipeline with no schedule row, unrelated to this feature, present
  regardless of any interaction with schema-diff chips).
- **Cleanup performed:** removed both temporary steps via the UI (pipeline back to its original
  1-step state, confirmed via a fresh snapshot showing only "Assert / validate"); killed both dev
  processes bound to 5837/8744 (`lsof -i :5837/:8744` returns empty after `kill`); deleted all
  screenshot PNGs and the `.playwright-mcp/` directory I created at the repo root
  (`find ... -iname "hel405*"` returns nothing); `git status --short` in the worktree shows only
  the pre-existing `workflow-state.md` modification and untracked `evaluation-1.md` — nothing from
  my review session.

**Design-gate carryover check:** `skeptic-design-1.md`'s two non-blocking notes were (1) the
`--renamed` token choice being underspecified at design time — resolved by the actual amber/warning
implementation, verified live above; (2) the `renamed` bucket's computed `type` field having no UI
display (a renamed+retyped column loses its type-change signal) — confirmed still true by reading
`StepSchemaDiffChips.tsx` (renders `{field.from} → {field.to}`, never `field.type`), an
intentional, spec-documented simplification (spec.md's chip vocabulary explicitly lists only
`oldName → newName` for renamed), not a defect against any stated AC.

### Verdict: CONFIRM

### Non-blocking notes

- Same as skeptic-design-1.md's note 2 (carried forward, not new): a column that is both renamed
  and retyped in the same step shows only `name → newName`, not the type change. Spec-documented
  and defensible; worth a one-line non-goal callout in spec.md if it ever comes up in a real
  pipeline, not worth blocking.
- `npx tsc --noEmit -p .` surfaces ~30 pre-existing type errors in
  `frontend/src/features/toasts/state/toastListeners.ts` / `frontend/src/store/listenerMiddleware.ts`,
  wholly unrelated to this change (confirmed via `git diff main...8077eba7` on those files = empty)
  and not part of this repo's enforced gates (`npm run build` uses `vite build`, which doesn't
  type-check). Flagging for awareness only — pre-existing repo debt, out of scope for HEL-405.
