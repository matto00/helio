# Evaluation Report — Cycle 3 (evaluation-3.md)

**Commit reviewed: `a760e09826c0d244c658821e6d3763e12be1dfe4`** ("HEL-866 Fix the
remediation's own regression (CR6), seed real data for the guard (CR7), and stop a
silently-skipped view (CR8)"), parent `51c96e3f` (cycle 2). A commit landing after
this report is reviewed by nobody.

## Phase 1: Spec Review — PASS

Every cycle-2 change request verified by independent measurement, not accepted:

**CR6 — the remediation's own regression, fixed.** Measured live in the running app,
both themes, using the real rendered backdrop:

| call site | dark | light |
|---|---|---|
| `.source-list-table__row:hover` (my named example) | **1.161** (`--app-surface-raised` on `#121110`) | **1.119** (`#ffffff` on `#f4f2ed`) |

Both are back above 1.10, from 1.034/1.054 at cycle 2. The three-family split holds up
against the real DOM:
- family 1 (`--app-surface-strong` interiors, `soft`, 1.167/1.179) — re-verified on the
  modal/menu surfaces;
- family 2 (`--app-surface`, dark-scoped `strong`) — re-verified by hovering the sidebar
  `.actions-menu__trigger` in dark: painted `rgb(38,35,32)` on `rgb(26,24,22)` = **1.133**;
- family 3 (`--app-bg` canvas, `raised`) — the four reverted rows/toggle.

The `PanelList` self-correction is **genuine**: `.panel-list__zoom-widget` really does
declare `background: var(--app-surface-strong)` (`PanelList.css:33`), so its buttons are
family 1 and `--app-surface-soft` is the correct rung there — the earlier revert would
have recreated the ticket's own defect.

One correction to my own cycle-2 report, made after re-measuring rather than re-asserting:
the in-page `.ui-icon-btn--secondary` / `.actions-menu__trigger` / `.popover__trigger`
instances I cited at 1.030 are **sidebar-rail** elements, and `App.css`'s
`:root[data-theme="dark"] .app-sidebar …` override outranks `DashboardList.css` on
specificity, so they actually paint at 1.133. That part of CR6 was my overreach; the
table-row family — the part the executor fixed — was the real defect.

**CR7 — seeding works.** Per-view counts, both themes identically:
`/sources 1 → 8`, `/pipelines 1 → 10`, `/settings 19 → 24`, `actions-menu 0 → 5`;
total probes 256 → **360**. Table rows are now genuinely in the population (the failure
output below names a `tr`).

**CR8 — the silently-skipped view runs.** `actions-menu` appears in both themes' logs,
and the conditional skip is replaced by `toHaveCount(1)` assertions plus the row-hover
needed to un-clip the trigger — a missing overlay now fails loudly.

**CR9 — exemption keying matches the documentation.** All three now key on the bracketed
`[class]` token; the run prints exactly 20 lines = 3 documented categories × the real
element counts (8 accent swatches + 1 palette row + 1 type tab, × 2 themes), each with a
written justification I checked against the component CSS.

**The two population bugs are real, and I verified both independently and by consequence:**

- `<main class="app-content">` computes
  `background-image: radial-gradient(rgba(33,29,25,0.09) 1px, rgba(0,0,0,0) 1px)` over
  `background-color: rgba(0, 0, 0, 0)` — so the old unconditional bail marked any
  in-`<main>` element with a state change "unresolved" instead of measuring it. The
  unresolved count went **14 → 0** on an otherwise larger population.
- `.source-list-table__row` is a `<tr>` with **no `role` attribute**
  (`matches('[role=row]') === false`, `matches('tbody tr') === true`). It was never in
  the population in any cycle, independent of seeding. Scoping to `tbody tr` rather than
  bare `tr` is the right call — a `<thead>` row would score as a D4a absence and be pure
  noise.

The `.pipeline-list-table__share-btn` fix (`--app-surface` against an `--app-surface`
backdrop — literally identical, 1.065/1.091 as measured) is **in scope**: it is the same
defect class this ticket exists to close, it was found by this ticket's own guard rather
than opportunistically, it is one line, and it is measured and commented. Routing it out
would leave a known-invisible state shipping behind a guard that just caught it.

`DESIGN.md` now documents the three-backdrop rule and says plainly that cycle 1's blanket
rule was wrong — and uses the split as evidence for the dedicated-token recommendation
(AC4), still recommended and not adopted. Accurate.

## Phase 2: Code Review — PASS

Gates re-run by me, fresh, in `WORKTREE_PATH`:

| gate | result |
|---|---|
| `npm run lint` | PASS |
| `npm run format:check` | PASS |
| `npm test` | PASS — 295 suites / 3105 tests |
| `npm --prefix frontend run build` | PASS (cycle-3 CSS compiles) |
| `npm run check:e2e-types` | PASS |
| `npm run check:state-contrast:selftest` | PASS — 30/30 (incl. the `#232019` on `#262320` = 1.040 must-fail case) |
| `DEV_PORT=6298 npx playwright test e2e/state-surface-contrast-guard.spec.ts` | PASS — 360 probed, **resolved=360, unresolved=0**, pass=148, fail=20 (all exempted), advisory=192 |

**Mutation proof, re-run at this SHA against the exact regression this cycle fixed.**
Reverting `.source-list-table__row:hover` to `--app-surface-soft` takes the guard
GREEN → RED in **both** themes:

```
[dark]  /sources :: tr "HEL-866 Guard Source…" [source-list-table__row] (#5) (hover) — ratio=1.0342208678516902
[light] /sources :: tr "HEL-866 Guard Source…" [source-list-table__row] (#5) (hover) — ratio=1.0538655293965835
```

Those are the same two ratios I measured by hand in cycle 2 (1.034 / 1.054). That single
result closes the loop the whole ticket turned on: the guard now catches, mechanically,
the exact defect that shipped past it twice. Mutation reverted; `git status` clean.

Structural checks: `frontend/src/theme/theme.css` diff vs `main` is **0 lines**. Every
cycle-3 CSS edit is inside a `:hover` rule — I re-parsed both images of all six changed
stylesheets and enumerated every changed/added/removed rule; no resting style was
touched. The `tokenAuditSweep.css.test.ts` edit is a `+4` line shift for two
`PipelinesPage.css` entries, matching the 4-line comment inserted above them — a
line-pinned baseline following an insertion, not a masking edit.

## Phase 3: UI Review — PASS

Rendered against the running app at `http://localhost:6298`, both themes,
`location.href` re-checked before each reading. Evidence in
`.concertino/runs/HEL-866/evidence/`:

- `eval3-dark-source-row-hover.png` — the hovered row now reads as a clear, warm lighter
  band. Compare `eval2-dark-source-row-hover.png` from cycle 2, where the same hover was
  imperceptible. This is the visible proof of CR6.
- `eval3-light-source-row-hover.png` — white row against the warm-grey table, clearly
  visible.
- Cycle-1/2 surfaces re-checked and unchanged: chrome hovers, `.active:hover`
  accent-mid, modal Cancel (light and dark), command-palette rows.
- No console errors during any flow; no layout breakage.

Judged against the running app in both themes, the states read as one coherent family:
rows lift on the canvas, controls deepen on chrome, modal interiors soften. Final
subjective cohesion judgment remains the skeptic's.

## Overall: PASS

## Non-blocking Suggestions (route out or note in the PR; none block)

- **`/connectors` and `/chat` still contribute 1 element each** — no connector or
  conversation is seeded. Same class as CR7 and cheap to extend later; the per-view log
  makes the gap self-reporting rather than hidden, which is the property that matters.
- **`advisory = 192 of 360 (53%)`** — mostly focus states expressing themselves via
  outline. Deliberate per D4a/D7, but the PR should state the number so "148 pass" is not
  read as full coverage.
- **The three-backdrop rule is now load-bearing tribal knowledge.** It is documented in
  `DESIGN.md`, but the dedicated `--app-state-hover`/`--app-state-selected` token pair is
  the durable fix, and this ticket has now produced direct evidence for it (a blanket
  rule was applied and was wrong for two of three backdrops). Worth filing as its own
  ticket with this evidence attached rather than leaving it as a recommendation.
- The even-stride sampler still never triggers (no view exceeds 24), so that path stays
  unexercised in practice.
- D6's known-open items (equal-luminance hue shifts; coverage bounded by visited views)
  remain accurate and should be named in the PR as the honest scope of AC2's "complete".
