## 1. Establish the measured baseline

- [x] 1.1 Re-derive the surface token values for every theme from `frontend/src/theme/theme.css` **by parsing the file**, never by hand-copying (HEL-444 produced wrong dark-theme numbers from a hand-copied value and had to discard the pass). Record the contrast matrix for all surface pairs in both themes.
- [x] 1.2 Confirm the four numbers design.md D3 derives its threshold from: `raised` on `strong` = 1.000 (light) / 1.040 (dark); `soft` on `strong` = 1.179 (light) / 1.167 (dark). If any differs from design.md, **stop and report** — the threshold's justification depends on them.
- [x] 1.4 Measure the **accent-family** state backgrounds (`--app-accent-dim`, `--app-accent-surface`; 45 of 161 declarations) as they RESOLVE AT RUNTIME **and after alpha compositing over their backdrop**, in both themes (design gate CR6, round 2 CR1). **Re-derive the population figures at runtime and correct D3/D4/this task in place** — the previously stated "45 of 161 / 28%" does not reproduce under a static parse (19 of 155 at rule level, 37 at declaration level). These tokens are alpha 0.15/0.10 in dark and 0.11/0.08 in light; confirming the threshold against their declared rgba rather than their composited value would validate nothing. Their declared values never render — the accent is written inline on `<html>` by `applyAccentTokens` and outranks both theme blocks, the trap HEL-444 recorded. Confirm 1.10 separates them as it does the surface family, or report that the threshold needs revisiting **before** the guard is written.
- [x] 1.3 Enumerate the reference set: files under `frontend/src` referencing `--app-surface-raised` (expected **58** — correct in place if it differs, do not transcribe the ticket's stale 54).

## 2. The guard — rendered, CI-gated (highest-value deliverable, AC5)

- [x] 2.1 Write a reusable measurement module (contrast computation, **alpha compositing**, painted-backdrop accumulation, state-delta classification) with **pure exported functions**, separate from the Playwright spec that drives it, so the core can be self-tested without a browser.
- [x] 2.2 **Enumerate the population from the rendered DOM** (design.md D4.1), **opening overlay surfaces — modals, menus, and the command palette — not only navigating routes**; this ticket's canonical defect lives in a modal and in the palette, which no route navigation renders: query interactive elements per view (`a`, `button`, `[role=option]`, `[role=menuitem]`, `[role=row]`, `[tabindex]`, plus the repo's list/card/item conventions). **No file list, no component list anywhere in the input path.** A newly added component must be included with no inventory edit.
- [x] 2.3 **Resolve the parent surface by walking the rendered ancestor chain, accumulating alpha** until total opacity reaches 1 (design.md D4.2). A partially transparent ancestor contributes to the backdrop and does **not** terminate the walk — "first non-transparent ancestor" is undefined for alpha in (0,1). This is the change request that killed the static design — the element's own background is transparent for 72% of state declarations, including `.command-palette__item`, the call site HEL-496 fixed. Verify explicitly that `.command-palette__item` now resolves to a real ancestor surface.
- [x] 2.4 Force each state (real hover/focus; selection where the app exposes it) and re-measure, **including pseudo-element backgrounds** via `getComputedStyle(el, '::before'/'::after')` — a state can be expressed entirely by a pseudo-element (real instance: `DataGrid.css`'s `.ui-data-grid__resize-handle:hover::after`). Settle transitions before reading.
- [x] 2.4a **Alpha-composite the state colour over the resolved backdrop before computing any ratio** (design.md D4.3). `getComputedStyle` returns colour WITH alpha; `--app-accent-surface`/`--app-accent-dim` are alpha 0.15/0.10, so comparing them as though opaque overstates the difference and silently passes 45/161 of the population. The ratio is always taken between two opaque colours.
- [x] 2.5 Evaluate per theme, at the viewports the stylesheet defines breakpoints for, against threshold **1.10**, with the derivation from tasks 1.2/1.4 recorded at the constant.
- [x] 2.6 **Classify per design.md D4a**: below-threshold background change → FAIL; no background change but border/outline/shadow moved → **ADVISORY** (HEL-1044's call, not ours); nothing changed at all → FAIL. Do not collapse the advisory/failure split in either direction.
- [x] 2.7 **Report resolved/unresolved and pass/fail/advisory counts BEFORE any remediation** (design gate CR2). State a ceiling above which the walk is treated as defective rather than the tree, in both directions: a collapsed count means the query under-collects; a first run red on a large fraction means the walk or the threshold is wrong, **not** that ~116 exemptions should be added. Any exemption is a reviewed diff entry with a written reason.
- [x] 2.9 State a runtime budget for the walk (elements x themes x viewports x routes) and keep it inside it. A guard that times out in CI gets disabled as surely as a flaky one.
- [x] 2.8 Failure output names the element, the resolved parent surface, the theme, the viewport, and the measured ratio — actionable from output alone.

## 3. Prove the guard is failable — and keep proving it

- [x] 3.1 Write a self-test for the measurement core on the `check-tokens.selftest.mjs` pattern (pure-function cases; fixtures under `mkdtemp` in `os.tmpdir()` only if any are needed, never in the tracked tree, removed in `finally`, with an idempotent startup sweep).
- [x] 3.2 **Mutation case A — the light defect:** `#ffffff` on `#ffffff` goes red.
- [x] 3.3 **Mutation case B — the dark defect:** `#232019` on `#262320` (1.040) goes red. This proves the guard tests *contrast*, not inequality — a guard written as `!==` passes this pair. **The single most important case in the file.**
- [x] 3.4 **Must-pass case:** `--app-surface-soft` on `--app-surface-strong` (1.179 / 1.167) goes green, so the threshold is not merely "fails everything".
- [x] 3.5 **Per-theme case:** a pair clearing the threshold in one theme and failing in the other goes red and names the failing theme.
- [x] 3.6 **Absence case:** an element whose state changes nothing goes red; one that changes only box-shadow is classified ADVISORY, not FAIL. This is D4a, and it is what makes the guard able to see the shape that made the surface undercountable.
- [x] 3.9 **Alpha-compositing case:** a state at alpha 0.15 over a known backdrop must be evaluated on its composited value, and a case that would pass uncomposited but fails composited must go red. This is the round-2 CR1 defect; without this case the guard silently false-passes 28% of the population.
- [x] 3.10 **Pseudo-element case:** a state expressed only by a `::after` background is detected and classified.
- [x] 3.7 Every case asserts on the **pair/element named in the output**, never on exit code or error count alone — otherwise a guard pointed at an unrelated corpus passes its own selftest vacuously.
- [x] 3.8 **Live mutation on a REAL, RESOLVED call site (design gate CR3).** Pick a call site the guard **resolves and reports green**, revert it to `--app-surface-raised`, run the guard, and capture the transcript showing it go **green → red, naming that element, its measured ratio, and the theme** — not merely red, and not red-for-unresolved. Restore afterwards. The selftest uses fixtures; this proves the guard fires on the live tree.

## 4. Wire into CI

- [x] 4.1 Add the spec to the CI `e2e` job's spec set. Confirm it is genuinely gated — this repo has previously had e2e specs silently ungated by a narrow filter (`openspec/changes/wire-orphaned-e2e-specs/`); verify by inspecting the job's actual selection, not by assuming `testDir` covers it.
- [x] 4.2 Add a `package.json` script entry for running it directly.
- [x] 4.3 `.husky/pre-commit` is **not** modified (design.md D4 dropped the static guard). If that changes, design.md's Gate-Chain Implications Checklist applies and per-script isolation transcripts become required (CON-132).

## 5. Rendered sweep and remediation (AC1, AC2, AC3)

- [x] 5.1 Start the dev servers via `scripts/concertino/start-servers.sh` with the worktree path passed **explicitly**. Never invoke `npm`/`vite`/`npx playwright` bare — a bare invocation inherits an ambient default and can silently measure another worktree's server (CON-165).
- [x] 5.2 Before every reading, re-check `location.href` and self-authenticate the page content. A parallel Playwright session may steal the shared tab; trusting a port is not sufficient.
- [x] 5.2a **Record the visited routes AND overlay surfaces, with per-surface element counts** (design.md D6.2). AC2 claims a *complete* sweep; the walk is complete within the routes it visits, and that scope must be legible in the PR rather than implied.
- [x] 5.3 **Independently of the guard's own CLASSIFIER** (though drawing on the same selector families, so this is independence of judgment, not of population — it catches a correct query with a broken classifier), enumerate "states that should be visible" from the rendered app — rows, options, menu items, cards, list items in each view — and check whether each conveys a visible state (design gate CR4). Starting from the guard's reported pairs would leave the guard's own blind spots untested by both mechanisms.
- [x] 5.3a **Remediate modal-hosted ADVISORY states too, or report AC1 as partially unmet.** AC1 requires a visibly distinct *background* for modal-hosted states, so a modal-hosted shadow-only state is not covered by the advisory bucket (which exists only to avoid absorbing HEL-1044's non-modal panel-card decision). Do not let it ship silently as advisory with AC1 claimed met.
- [x] 5.4 Fix every failing state, moving it to `--app-surface-soft` (design.md D5). Change **no value** in `theme.css`.
- [x] 5.5 **Rendered verification, both themes**, on the running app: capture each remediated state and confirm a visibly distinct background. Computed style alone is insufficient for AC1 — the ticket mandates rendered screenshots, because green tests and a PASS UI review both missed the original instance. Write screenshots to the run's evidence directory, never the repo root.
- [x] 5.6 Cover the modal-hosted sites named in the ticket (`Modal.css`, `ActionsMenu.css`) explicitly, re-locating them rather than trusting the stale line pins.
- [x] 5.7 **Confirm AC3 in dark theme specifically** — each remediated pair must measure meaningfully above 1.040, not merely differ.
- [x] 5.8 Record the sweep result for the PR: which call sites were found, which changed, which were already safe, and which are advisory (AC2).

## 6. Record decisions and route findings out

- [x] 6.1 Update `DESIGN.md`: record design.md D1 (the light ramp saturates, so the ramp does not govern interactive state backgrounds) and the AC4 recommendation — a dedicated `--app-state-hover`/`--app-state-selected` pair, **recommended and explicitly not adopted**, with the reason (visual-identity change requiring owner sign-off; escalation raised, no dashboard attached, conservative path taken).
- [x] 6.2 **Correct artifacts in place.** If any finding contradicts this plan, rewrite the affected text. Do **not** append a "CORRECTION" section beneath stale analysis — `.concertino/runs/HEL-444/evidence/premise-validation.md` demonstrates that defect and must not be copied.
- [x] 6.3 Report any acceptance criterion that could not be verified as **unmet**, plainly. Closing honestly on an unmet AC is correct; manufacturing evidence is not.
- [x] 6.4 Report findings outside scope for routing to new tickets — naming the **obligation**, not the component. Expected from design.md D6's open list: **D6.1** (equal-luminance hue shifts clear a luminance-only ratio and can still be invisible) and **D6.2** (coverage is bounded by the routes the walk visits, which qualifies AC2's word "complete"). These two are what the design itself says qualify this ticket's claim to close the class.

## 7. Gates

- [x] 7.1 `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test` — all green, run against this worktree explicitly.
- [x] 7.2 Full `.husky/pre-commit` chain green (unchanged by this ticket), plus the new rendered guard green against the running app in both themes.
- [x] 7.3 Commit with the `HEL-866` prefix. Write `files-modified.md` listing every file touched.
