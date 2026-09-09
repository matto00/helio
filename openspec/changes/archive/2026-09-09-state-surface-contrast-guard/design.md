# Design — state-surface contrast guard (HEL-866)

## Context

Measured this run, from `frontend/src/theme/theme.css` (values parsed from source, not transcribed):

| pair | light | dark |
|---|---|---|
| `raised` on `strong` (**the defect**) | **1.000** | **1.040** |
| `soft` on `strong` (**the remediation**) | **1.179** | **1.167** |
| `soft` on `surface` | 1.150 | 1.030 |
| `raised` on `surface` | 1.025 | 1.089 |

Two facts fall out of this table and drive every decision below.

**D1 — The ramp saturates, and this is a property of the BACKDROP, not just the top rung.** `--app-surface-raised` and `--app-surface-strong` are both `#ffffff` in light theme, so a state layered on the app's *top* surface cannot be expressed by advancing along the ramp; it must go darker, while in dark theme the same state must go lighter. No single ramp rung expresses both directions **for that one backdrop**. **Corrected in place (evaluation-2.md CR6, cycle 3):** this is not a light-theme-at-the-top-of-the-ramp phenomenon only. It reappears, with a *different pair of rungs*, at every backdrop layer the app actually renders states against:

- **On `--app-surface-strong`** (modal/popover/menu interiors — the ticket's canonical defect): `--app-surface-soft` clears 1.10 in **both** themes (1.179 light / 1.167 dark) with no per-theme split needed. This is the one backdrop where a single token works both directions.
- **On `--app-surface`** (an intermediate card/chrome layer, e.g. the command bar, a step card, a settings-page button): neither `--app-surface-soft` (1.150 light / **1.030 dark, fails**) nor `--app-surface-strong` (**1.025 light, fails** / 1.133 dark) alone clears both themes — soft for light, strong for dark, exactly D1's original two-rung split, just one layer down the ramp.
- **On `--app-bg`** (the outermost page canvas — most table rows, list rows, and page-level buttons actually composite here, once the ancestor walk is corrected to see through the neutral canvas-dot texture on `<main>`, itself painted on a transparent base): `--app-surface-raised` clears 1.10 in **both** themes (1.161 dark / 1.119 light) and was never the ticket's defect there at all — `--app-surface-soft` measures worse on this backdrop (1.034 dark / 1.054 light), so blanket-swapping every `--app-surface-raised` call site to `--app-surface-soft` (the cycle-1 mechanical sweep) silently regressed this entire family, the exact defect class this ticket exists to remove, reintroduced by its own remediation.

The general statement: **which rung clears 1.10 in both themes depends on which backdrop the state actually composites against, and that dependency is not monotonic** — `raised` is right on `--app-bg`, wrong on `--app-surface`, and (in light) collides outright on `--app-surface-strong`. This is why `DESIGN.md`'s ramp — which assigns one rung ("hover") to every backdrop uniformly — is wrong as a general rule, not merely mis-applied at 58 call sites, and why AC4's dedicated hover/selected token recommendation (which would encode this backdrop-dependence at the token layer, where a call site cannot get it wrong) is strengthened rather than weakened by this finding — see `DESIGN.md`'s AC4 section for the measurements.

**D2 — "Non-identical" is not a usable test.** The dark defect (1.040) is not identical, and a guard written as an inequality would pass it. The ticket says so explicitly. The threshold must therefore be a *contrast* threshold, and it must be justified against measured values rather than picked.

## Decisions

### D3 — Threshold: 1.10, derived from the table above
The known-broken pairs measure 1.000 and 1.040; the remediation measures 1.167 and 1.179. **1.10** sits in the gap with headroom on both sides (≥0.06 above the worst broken pair, ≥0.067 below the worst good pair). It is derived from measurement, not chosen for roundness, and the derivation is recorded in the guard source so a later reader can re-check it.

This is deliberately **not** a WCAG threshold. WCAG's 3:1 / 4.5:1 ratios govern *text legibility*, and no adjacent-surface pair in this theme — good or bad — comes close to 3:1. Adopting a WCAG number here would fail every surface in the app, including correct ones, which is how a guard gets disabled. What is wanted is "measurably different", and 1.10 is what the measurements say that is.

**Extended to the accent family (design gate CR6).** The four numbers above are surface-token pairs. **Corrected in place (task 1.4/skeptic-design-3.md note 1) — the previously stated "45 of 161 / 28%" does not reproduce.** A rule-level parse of state selectors carrying a background declaration gives **155** total, of which **19** use `--app-accent-dim`/`--app-accent-surface` (a looser declaration-level count gives 37). These are accent-based, composed with `color-mix()` over a runtime-injected accent, so they have no static value to justify a threshold against. Under D4's rendered guard they resolve to real painted values and are measured on the same footing; task 1.4 records their measured distribution in both themes (re-derived at RUNTIME, alpha-composited over their resolved backdrop, per D4.2/D4.3 — not read from their declared, never-rendered rgba) and **confirms 1.10 separates them the same way** (see `e2e/support/stateContrast.selftest.mjs`'s alpha-compositing case, task 3.9). They are in the population, not exempted from it.

**Known limitation, recorded rather than hidden:** WCAG contrast ratio is a luminance-only metric and is a mediocre proxy for perceptual difference between two large adjacent blocks of similar colour. It is used here because it is the metric this repo already computes and reasons in. A pair that clears 1.10 by a hue shift at equal luminance would pass the guard and still be invisible. See D6.

### D4 — The guard is RENDERED, not static; the population and the parent surface both come from the running app

**This decision was rewritten after the design gate.** The original plan resolved each pair statically, taking the parent surface from "the base rule for the same selector, minus the state". The skeptic measured that heuristic against the tree: it resolves the element's *own* base background, which is `transparent` or absent for **116 of 161 (72%)** of state-background declarations — including `.command-palette__item` (`CommandPalette.css:62-71`), the exact call site HEL-496 fixed and the defect this ticket is named for. Failing closed on 72% of the population produces a ~116-entry allowlist, which is precisely the hand-curated population the ticket forbids. The heuristic was not repairable; it was answering the wrong question.

The invariant is *state versus the surface it renders on*. For a transparent element that surface belongs to an **ancestor**, and which ancestor it is depends on the cascade and the DOM — neither of which exists statically. So the guard runs against the **running app**, under Playwright, in the repo's existing CI-gated `e2e/` harness:

1. **Enumerate mechanically from the DOM.** Query every interactive element in each view (`a`, `button`, `[role=option]`, `[role=menuitem]`, `[role=row]`, `[tabindex]`, and the repo's list/card/item conventions). The population is whatever the app actually renders — no file list, no component list, and a newly added component is included the day it ships.
2. **Resolve the parent surface by walking up the rendered tree, accumulating alpha.** Walk ancestors collecting every background whose alpha is greater than zero, compositing them in paint order until total opacity reaches 1 (the root background terminates the walk by construction). "First non-transparent ancestor" is **undefined for alpha strictly between 0 and 1** and is not the rule: a partially transparent ancestor contributes to the backdrop rather than terminating the walk. The result is the opaque colour the state genuinely composites against — exactly what the static pass could not reach.
3. **Force each state, re-measure, and ALPHA-COMPOSITE before comparing.** Drive real hover/focus, and set selection state where the app exposes it, then read computed style again — **including pseudo-element backgrounds** via `getComputedStyle(el, '::before'/'::after')`, since a state can be expressed entirely by a pseudo-element (real instance: `DataGrid.css`'s `.ui-data-grid__resize-handle:hover::after`).

   `getComputedStyle(el).backgroundColor` returns a colour **with its alpha**, not the composited result. The threshold must never be applied to that value directly: `--app-accent-surface` and `--app-accent-dim` are defined as `color-mix(in srgb, var(--app-accent) 15%/10%, transparent)` — alpha 0.15/0.10 in the dark block and 0.11/0.08 in the light block — so comparing them against the backdrop as though opaque **overstates** the difference and produces silent false passes on every accent-based state. The guard composites the state colour over the resolved backdrop from step 2 and computes the ratio between two **opaque** colours. This applies to every state, not only the accent family; an opaque state simply composites to itself.
4. **Repeat for every theme, at the viewports the stylesheet defines breakpoints for.**

This resolves at runtime the four things a static parse cannot see, and it is why the rewrite is a strict improvement rather than a lateral move:

- **Ancestor backdrops** (the 72%).
- **`color-mix()` over a runtime-injected accent.** a minority of state backgrounds (figure to be re-derived at runtime by task 1.4 — a static parse gives 19 of 155 at rule level and 37 at declaration level; the previously stated "45 of 161" does not reproduce) use `--app-accent-dim` / `--app-accent-surface`, composed against an accent written **inline on `<html>`** by `applyAccentTokens`, which outranks both theme blocks. Their declared values never render — the trap HEL-444 fell into and recorded. At runtime the accent resolves to its real value **and step 3 composites the resulting alpha over the step-2 backdrop**, so D3's threshold is applied to a colour that is actually painted. Runtime resolution alone would not have been enough here: these tokens are alpha < 1, and reading them without compositing is the false-pass mode described in step 3.
- **Pseudo-element-expressed states** (real instance: `DataGrid.css`'s `.ui-data-grid__resize-handle:hover::after`), readable via `getComputedStyle(el, '::after')`.
- **Breakpoint-scoped state overrides** (real instance: `inputs.css:185`), covered by measuring at the relevant viewports.

**The static pre-commit guard is dropped, deliberately.** Keeping a partial-coverage check (resolving only the element's own base background, transparent for 72% of the population — see the population count above this section) would report a coverage number that reads as a guarantee and is not one. The guard runs in CI, where the app can actually be rendered. The honest cost is that it does not fire on `git commit`; that is stated rather than compensated with a weaker check that appears to.

### D4a — The guard detects ABSENCE, which is the shape that made this surface undercountable

Because the guard compares a rendered element **before and during** its state, it can see something no static parse and no grep can: an interactive element that changes *nothing at all* on hover. This is the HEL-1044 shape and the reason the original surface was undercounted, and it was listed in the first draft of D6 as a permanent blind spot. It is not one under a rendered guard. Three outcomes:

- **Background changes, and clears the threshold against its resolved backdrop** → pass.
- **Background changes but falls below the threshold** → **fail** (the HEL-866 defect proper).
An ancestor carrying the `opacity` *property*, or a `background-image`/gradient, makes "the colour the state composites against" ill-defined. Neither is load-bearing for this population; where the walk meets one it classifies the pair as **unresolved** and reports it in the count (task 2.7) rather than guessing a colour.

**AC1 overrides the advisory bucket for modal-hosted states.** AC1 requires every *modal-hosted* hover/active state to render a visibly distinct **background**. The advisory classification exists to avoid absorbing HEL-1044's decision about the panel card, which is not modal-hosted. A modal-hosted shadow-only state is therefore **remediated**, not filed as advisory — or, if it is not remediated, AC1 is reported as partially unmet. The advisory bucket must not silently absorb an AC1 obligation.

- **Background does not change at all** → classify by what else moved. If border, outline, or box-shadow changed, the element conveys its state by another channel: **report as an advisory finding, not a failure** — that is a legitimate design choice and adjudicating it is HEL-1044's job, not this ticket's (D7). If *nothing* changed, the element has no state feedback whatsoever: **fail**.

The advisory/failure split matters. Failing shadow-only states here would silently absorb HEL-1044's decision, which D7 explicitly refuses to do.

### D5 — Remediation reuses `--app-surface-soft`; the dedicated token is recommended, not adopted
`--app-surface-soft` clears the threshold against `strong` in both themes (1.179 / 1.167) and is what HEL-496 correctly chose. It ships as the remediation.

A dedicated `--app-state-hover` / `--app-state-selected` pair is the *better* long-term answer, because it names the intent and encodes D1's direction inversion at the token layer where a call site cannot get it wrong. It is **recommended in `DESIGN.md` and explicitly not adopted this run**: adding a token to `theme.css` is a DESIGN.md / visual-identity change requiring owner sign-off. The escalation was raised (`escalation.raised`, HEL-866, `adopt-token` vs `recommend-only-reuse-soft`) with no dashboard attached and the owner asleep; the conservative option is taken and the open question is recorded rather than the run halting. **No value in `theme.css` is changed by this ticket.**

### D6 — What else could break in this region and still pass this guard

Required by the ticket: a guard is only as good as the invariant someone thought to name. Rewritten after the design gate, because D4's move to a rendered guard **closes** three of the six gaps the first draft listed as permanent, and the gate surfaced two more that were missing.

**Closed by the rendered guard** (listed because the first draft claimed they were unfixable, and that claim was wrong):

- *Ancestor-composited backdrops* — resolved by walking the rendered tree (D4.2).
- *`color-mix()` / opacity-composed states over a runtime-injected accent* — resolved at runtime **and alpha-composited over the accumulated backdrop** before the ratio is taken (D4.2/D4.3). Reading them without compositing was a real defect in the first draft of this design, caught at the second design gate.
- *Absence-shaped states* (shadow-only, border-only, nothing-at-all) — detected by before/during comparison (D4a). **This was the most important gap, and it is the one that made the original surface undercountable.**
- *Pseudo-element-expressed states* — real instance `DataGrid.css`'s `.ui-data-grid__resize-handle:hover::after`; read via `getComputedStyle(el, '::before'/'::after')` in D4.3, tasked at 2.4 and self-tested at 3.10.
- *Breakpoint-scoped state overrides* — real instance `inputs.css:185`; covered by measuring at the relevant viewports.

**Genuinely still open, and routed out rather than papered over:**

1. **Equal-luminance hue shifts.** A state differing only in hue at constant luminance clears a luminance-only ratio and can still be invisible. D3's stated metric limitation. Routed to its own ticket.
2. **Coverage is bounded by which views the walk visits, AND by the per-view sample size.** The walk MUST open overlay surfaces — modals, menus, and the command palette — and not only navigate routes: this ticket's canonical defect lives in a modal and in the command palette, neither of which any route navigation renders. A route-only walk would miss the ticket's own exemplar. The population is mechanical *within* a view, but the set of views is a route list, and an interactive element on a route the walk never opens is unchecked. **Corrected in place (evaluation-1.md CR1, cycle 2):** the original implementation additionally under-collected WITHIN visited views — chrome (command bar/sidebar), identical on every route and first in DOM order, crowded a positional `slice(0, cap)` before visibility filtering, measuring 2 of `/settings`'s 36 real in-`<main>` elements (5.5%). Fixed structurally: chrome is now probed once as its own view (`.app-command-bar, .app-sidebar__nav-row`), every route is scoped to `page.locator("main")`, and the sample (when a view's visible population exceeds the cap) is taken evenly across the full matched set, not the first N — with the true visible total logged alongside the sample (task 5.2a) so a future collapse is visible rather than hidden behind a headline total. AC2's "complete" is scoped to: every visible, non-disabled interactive element within `<main>` on the 6 enumerated routes, the chrome view, and the 3 named overlays, up to `MAX_ELEMENTS_PER_VIEW` (24) per view, sampled evenly when a view exceeds that cap — not the app's entire reachable state space, and not necessarily literally every element when a view's population exceeds 24.

**Corrected in place a third time (skeptic-final-1.md CR3 / skeptic-final-1B.md CR2, cycle 4) — the population was wrong a third time, in a third new way, and the fix is now structural rather than another hand-enumerated list.** `/pipelines/:id` (a route this diff's own `PipelineDetailPage.css` changes render on) and the sidebar's content rail (`SidebarBody`/`DashboardList` — real page content living inside `.app-sidebar`, which the "chrome" view deliberately excludes and no route's `<main>` scope reaches, since the rail renders inside `<aside>`, not `<main>`) were both in **no view at all**. Four of this diff's own changed rules shipped broken there, invisible to a 360-probe green run. A hand-listed view set is the same hand-picked-input-set failure AC5 forbids at the element level, one layer up — enumerating harder a fourth time would not close it. The guard now **asserts** its own coverage instead of trusting the list: every route visit stamps every visible/enabled `INTERACTIVE_SELECTOR` match in the CURRENT document with a unique id, probes chrome + a per-route `sidebar-rail` view (`.app-sidebar` excluding the nav row, which "chrome" already covers) + `<main>`, and fails loudly — naming the uncovered elements — if any stamped id was not covered by one of those views. `/pipelines/:id` was added to the route list as a direct consequence of this gap, not as the fix itself.

**Still-named, deliberately excluded routes** (not silently omitted): `/sources/:id` and the four `*/review` routes. Neither is covered by the partition assertion (which only runs on the enumerated route list) or by any overlay in the current overlay set. This is a real, acknowledged bound on AC2's "complete" — a state on one of these routes is unchecked by this guard as shipped.
3. **States reachable only behind data or permissions** — an empty-state or error-state row that requires fixtures the walk does not create.
4. **Transient/animated states** measured mid-transition. Mitigated by settling before reading, not eliminated.

Items 3 and 4 are known and accepted rather than routed to tickets: both are limits on reach, not undetected defect classes. Items 1 and 2 are the ones that qualify this ticket's claim to close the class, and both are named in the PR rather than left to be discovered.

### D7 — HEL-1044 disposition
HEL-1044 is downstream of this ticket by its own statement ("blocked in practice on HEL-866"). This ticket removes its blocker: after D5, a state on a top surface has a token worth moving to. HEL-1044's own decision — whether the panel card should move to it, and consistency across the other card surfaces — is **not absorbed here**; it is a visible design decision about the app's most-hovered surface. HEL-1044 is updated to record that its blocker is cleared. Leaving a workaround in place for a fixed problem is exactly what the ticket warns against, and the fix for that is to unblock and hand off, not to silently widen this diff.

## Gate-Chain Implications Checklist

**This change no longer modifies `.husky/pre-commit`** — D4 dropped the static pre-commit guard, and the rendered guard is wired into the existing CI `e2e` job instead. The checklist is kept and answered anyway, because CI wiring deserves the same questions and because a later revision that reintroduces a hook change must not have to rediscover them.

- **What does it execute?** A Playwright spec under `e2e/`, run by the existing `e2e` CI job against the app the harness already starts. No new hook child, no new husky line, no git plumbing.
- **What environment does it inherit, and from where?** The `e2e` job's environment and `playwright.config.ts`'s base URL — never an ambient default. It must not read `GIT_DIR`/`GIT_INDEX_FILE` (the HEL-657/HEL-805 poisoned-env mechanism the existing hook comments call out); it has no reason to touch git at all.
- **Does it write anything outside its own sandbox?** Only Playwright's own artifacts under the configured output directory. Screenshots captured as AC1 evidence are written to the run's evidence directory deliberately, never to the repo root — stray root-level PNGs are a known recurring hazard in this repo.
- **Does it behave differently from a linked worktree than from a main checkout?** It must not. It targets a URL, not a path, so the operative risk is not path resolution but **measuring the wrong server**: every invocation passes the worktree's own dev port explicitly, and the spec asserts on page identity before reading, because a parallel session can steal the shared browser tab (CON-165).
- **What happens on its first run?** It runs against the tree as remediated by this same change and passes. No cache, no generated baseline, no bootstrap — deliberately: a regenerable baseline would let the guard be satisfied by regenerating it, which is the fixture-edited-to-pass failure mode.

## Risks

- **The walk under-collects.** If the DOM query misses an interactive convention, or the route list is short, the population is quietly smaller than believed — the original defect relocated into the guard. Mitigation: task 5.2a reports visited routes and per-route element counts; a count that collapses is a defect in the walk, not a pass. The converse is also specified — see the next risk.
- **The first run is red on a large population and the guard gets weakened to land it.** This is what killed the static design. Mitigation: task 2.7 requires resolved/unresolved and pass/fail counts to be reported **before** any remediation, with a stated ceiling above which the walk is treated as defective rather than the tree. Any exemption is a reviewed diff entry with a written reason, not a bulk list.
- **Flakiness.** A rendered guard that fails intermittently gets disabled, which is worse than not having it. Mitigation: settle transitions before reading; assert on page identity before every measurement; no timing-dependent thresholds.
- **The advisory/failure split gets collapsed.** If shadow-only states are made failures, this ticket silently absorbs HEL-1044's decision (D7); if absences are made advisory, the guard stops catching the class. Both directions are wrong and the split is specified in D4a for that reason.
- **Rendered verification is the only evidence that counts** for AC1/AC3. A passing unit test and a token-name comparison both already returned green on the original instance and both missed it.
