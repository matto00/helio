## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**1. Actual diff (not any report's characterization)** — `git show 2a328ff7` / `git diff origin/main...HEAD`.
Code surface is exactly 6 source files + 1 new test + the token-audit baseline: `TypeDetailPanel.{css,tsx}`,
`PanelCard.tsx`, `PanelGrid.css`, `PipelineDetailFooter.tsx`, `PipelineDetailPage.css`,
`frontend/src/test/rawElementGuardHel440.test.tsx`, `frontend/src/theme/tokenAuditSweep.css.test.ts`.
Working tree clean apart from the untracked `evaluation-1.md`.

**2. CSS vs design.md Decisions — transcribed verbatim.** I compared each of the three replacement blocks
declaration-by-declaration against design.md's Decisions section. All three match exactly, including declaration
order, token names (`--app-accent`, `--app-accent-strong`, `--app-accent-mid`, `--app-border-subtle`,
`--app-surface`, `--app-surface-soft`, `--app-radius-sm`, `--text-sm`, `--text-base`, `--weight-semibold`), the
compound `.ui-input.<local>` specificity raise on base *and* state rules, `line-height: inherit`,
`min-height: auto`, `display: inline-block`, and the `width: auto` fix on the footer input.
So the transcription task was done correctly — **but the transcribed design itself carries a state-precedence
defect (see Change Requests).**

**3. Guard test vs `specs/raw-element-guard/spec.md`.** The spec requires the element with accessible name
`"Panel title"` / `"Pipeline name"` / `"Data type name"` to carry `ui-input`, with an explicit carve-out for
unrelated raw inputs. `rawElementGuardHel440.test.tsx` renders each of the three components in edit/rename mode
and asserts exactly that via `getByRole("textbox", { name: ... })` + `toHaveClass("ui-input")` — one test per
scenario, no over-broad "no raw input anywhere" assertion. `ui-input` is added only by `TextField.tsx`
(verified: it is the sole producer of that class on these elements), so a regression to a bare `<input>` would
fail the assertion. Spec satisfied.

**4. Gates re-run fresh by me (not the evaluator's word):**
- `npx tsc --noEmit -p frontend/tsconfig.json` → exit 0.
- `npx jest` (frontend) → **257 suites / 2833 tests passed**.
- `npm run lint` (eslint `--max-warnings=0`) → clean, no output.

**5. Live app, independent Playwright pass** (`start-servers.sh` + `assert-phase.sh servers` → `PASS servers`;
dev 5872 / backend 8779). Computed styles read directly off the running DOM, both themes:
- PanelCard title input, dark, rename mode: `class="ui-input panel-grid-card__title-input"`,
  `display:inline-block`, `min-height:0`, `padding:2px 0`, `background:transparent`,
  `border-bottom:1px solid <accent>`, `border-radius:0`, `box-shadow:none`, height 18.4px — matches design.
- Same control in light theme (`helio-theme=light`, real reload): border-bottom accent, transparent bg,
  text `rgb(33,29,25)`, no halo — light/dark parity holds. Screenshots:
  `.playwright-mcp/hel440-panel-rename-1440.png`, `hel440-panel-rename-light-1440.png`.
- TypeDetailPanel name input: `ui-input type-detail-panel__name-input`, `min-height:auto`, `padding:2px 6px`,
  `border-radius:6px`, transparent chrome idle; on focus → `border-color: rgba(33,29,25,0.11)`
  (`--app-border-subtle`) + `background: rgb(239,236,230)` (`--app-surface-soft`), `box-shadow:none`.
  (First read showed transparent — **re-ran**; that was a mid-transition sample, the stable value is the above.)
  Screenshot `.playwright-mcp/hel440-typedetail-light-1440.png`; also checked at 768px (w 678, h 26, 16px).
- PipelineDetailFooter output input: `width` computes to **216px intrinsic**, not stretched to the 850px flex
  parent — the `width:auto` fix works and the footer row does not wrap.
- Console: only a pre-existing `404 /api/pipelines/:id/schedule` (no schedule configured) — unrelated.

**6. Scope discipline.** `DashboardList.tsx` untouched (not in the diff at all). No files outside tasks.md's
list. Token-audit baseline changes are line-number-only shifts on the two edited CSS files, consistent with the
inserted lines (TypeDetailPanel 181→186; PipelineDetailPage +12 then +4 offsets).

**7. Reconciliation (HEL-725 / HEL-708 / HEL-720)** as recorded in design.md still holds against the diff:
HEL-708's `DashboardList.tsx` is genuinely excluded, no page-shell/route-container work (HEL-725), no
source-form work (HEL-720).

### Verdict: REFUTE

**Reproduced, stable defect: the newly-added `:hover:not(:disabled)` rules out-specify their own focus rules,
so the focus emphasis is suppressed whenever the pointer rests on the field being edited — which is the normal
case (you click the field, then type without moving the mouse).**

Specificity: `.ui-input.<local>:hover:not(:disabled)` = **(0,4,0)**; `.ui-input.<local>:focus` /
`:focus-visible` = **(0,3,0)**. Hover wins. Before this change neither element had *any* hover rule, so
hover+focus resolved to the focus rule. This is therefore a **new, user-visible regression**, and it directly
contradicts design.md's own stated "zero-visual-diff" goal.

Live evidence (both re-read to confirm stability, not a one-off sample):
- Pipeline name input, focused **and** hovered → `border-color: color(srgb .976 .451 .086 / 0.26)`
  (`--app-accent-mid`, i.e. the idle border). Same element focused with the pointer moved off →
  `border-color: rgb(249,115,22)` (`--app-accent`). Only the hover presence changes the result.
- Panel title input, focused (`:focus-visible` true) **and** hovered → `border-bottom-color: rgb(249,115,22)`
  (`--app-accent`, the idle color) instead of `--app-accent-strong`
  (`color-mix(in srgb, #f97316 76%, black)`).

`TypeDetailPanel` is **not** affected: its hover and focus selectors are one grouped rule with identical
declarations, so precedence is moot there.

This also weakens the focus indicator for keyboard/pointer users (no halo — deliberately suppressed — *and* now
no border emphasis while hovered), so it is not purely cosmetic.

### Change Requests

1. **`frontend/src/features/panels/ui/grid/PanelGrid.css`** — stop the hover rule from overriding the focus
   rule on `.panel-grid-card__title-input`. Preferred minimal fix: exclude focus from the hover selector, e.g.
   `.ui-input.panel-grid-card__title-input:hover:not(:disabled):not(:focus)`. (Equivalently, raise the
   `:focus-visible` rule's specificity to at least (0,4,0).) Verify live that focused+hovered yields
   `border-bottom-color: var(--app-accent-strong)`.

2. **`frontend/src/features/pipelines/ui/PipelineDetailPage.css`** — same fix on
   `.pipeline-detail-page__footer-output-input`: make the hover rule
   `...:hover:not(:disabled):not(:focus)` (or raise the focus rule's specificity). Verify live that
   focused+hovered yields `border-color: var(--app-accent)`, not `--app-accent-mid`.

3. **`openspec/changes/shared-component-coverage/design.md`** — update the two corresponding CSS blocks in the
   Decisions section so the design artifact and the shipped CSS stay byte-identical, and add one sentence
   recording the state-precedence reason (hover at (0,4,0) outranks focus at (0,3,0); the `:not(:focus)` guard
   is what preserves the pre-migration hover+focus appearance).

4. **Extend the regression evidence** for this specific failure mode: since the guard test only asserts the
   `ui-input` class, add a live-verification line to the re-evaluation that records computed
   `border-color` / `border-bottom-color` for each control in the **focused+hovered** state (not just focused),
   for both themes. A styles check that never exercises hover+focus together would not have caught this.

### Non-blocking notes

- `TypeDetailPanel.tsx:157`'s per-field `Display name for …` raw `<input>` remains raw; already dispositioned in
  design.md and deferred to HEL-833. Fine.
- The three controls now inherit `.ui-input`'s multi-property `transition` (border-color, box-shadow,
  background) where two of them previously had none or border-color only. Visually imperceptible and it did make
  one of my computed-style reads unstable, but it is a real (accepted) behavioral difference worth knowing.
- The worktree's gitignored `scripts/concertino/` copy contains only 6 of the 23 canonical scripts
  (`emit-event.sh`, `next-report-number.sh`, `persist-evidence.sh` are absent), which makes
  `start-servers.sh`/`assert-phase.sh` emit `No such file or directory` on every event emission. Environmental,
  not this change's doing; I used the canonical repo-root copies instead.
- A stray screenshot `hel440-dash-1440.png` was written to the repo root by the Playwright MCP default path
  before I redirected output to `.playwright-mcp/`; left in place for the user to dispose of.
