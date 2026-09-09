## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Scope per orchestrator: gate the CURRENCY REVISION (design.md D9, tasks.md §8) and the
never-reviewed parked guard draft — not a re-litigation of D1–D8.

### What I verified (with evidence)

**Base / diff (item 5) — CONFIRMED.** `git diff --stat origin/main...HEAD` returns 8 files, all under
`openspec/changes/light-dark-parity-audit/`. No `scripts/`, no `.husky/`, no `package.json`, no
`DESIGN.md`, no `frontend/` file. Sections 2–7 are correctly unticked; §8.1's premise is accurate.
Rebase confirmed: HEAD `3e8d2167` on top of `f20ea8f6`.

**D9.1 (item 1) — SUBSTANTIALLY CORRECT, and correctly hedged.** On the current tree:
- `frontend/src/theme/theme.css:369-370` declares `--app-focus-ring-color: #db6513` and
  `--app-focus-ring: 2px solid var(--app-focus-ring-color)` in the theme-invariant `:root` block
  (lines 368–405), no longer `var(--app-accent)`. `appearance.ts` `buildAccentTokens` (l.575-600)
  writes a derived `--app-focus-ring-color` inline.
- `--app-accent-text` is derived per theme (`deriveAccentTextColor(hex, theme)`) to clear 4.5:1,
  and `accentTextClosureGuard.css.test.ts:125` asserts "no `color: var(...)` anywhere in the corpus
  reaches `--app-accent`, zero exceptions" — strong static evidence the accent-as-text failure class
  (the "Create one" link) is closed.
D9.1 is right to call these *presumed* fixed and to demand re-measurement rather than assert it.

**D9.2 (item 2) — the blindness claim is TRUE; the chosen FORM is not.** `e2e/state-surface-contrast-guard.spec.ts:20`
states in its own header that it "Walks the RUNNING app (not a static parse of theme.css…)"; it
carries no `readFileSync` of theme.css and no `:root[data-theme=…]` parse. It cannot answer a
definition-coverage question. Claim verified — extending it would be wrong. **But** D9.2 justifies the
new `scripts/check-theme-parity.mjs` only against `check-tokens.mjs` and `state-surface-contrast-guard.spec.ts`,
and never against the guard family it is actually a sibling of. See CR1.

**D9.3 (item 3) — factually correct.** `--app-focus-ring-color`/`--app-accent-text`/`--app-selection-bg`
are declared at `theme.css:369, 403, 404` inside the plain `:root` block, absent from both
`:root[data-theme=…]` blocks (146–203 dark, 205–255 light). The draft guard's `extractThemeBlock`
only matches `:root[data-theme="X"]`, so "declared in neither" is a non-violation by construction
and cannot swallow "declared in exactly one" (the set-difference is computed over the two theme
blocks only). Not a loophole. Verified by running it: see below.

**Parked guard draft — reviewed and executed.** `node check-theme-parity.mjs frontend/src/theme/theme.css`
against the CURRENT file: `OK -- 29 --app-* token(s) in the dark block, 29 in the light block…` exit 0.
Construction is sound: brace-depth block matching, declaration-position-anchored regex (no
`.foo--bar:hover` false positive), comment stripping, exact-token-name exceptions with an
active staleness check that makes the list expire. One real hole — CR3.

**D9.4 (item 4) — restatement is defensible in principle, but built on two now-false premises.** The ink
selection inside `buildAccentTokens` is genuinely theme-independent (it compares only the two fixed
inks against the accent), so declining to walk it 8× is not scope-shaving. What breaks it is CR2 and CR4.

**Cohesion mandate.** This report's blocking findings are all about whether the plan measures the
*rendered* app on the *current* base, not about token tables. I did not run the app — this is the
design gate, and the objections below are all resolvable in the artifacts.

### Verdict: REFUTE

Four specific, cheap-to-fix defects. None re-opens D1–D8; all are currency defects D9 missed.

### Change Requests

1. **D9.2 picks the wrong guard family, and it contradicts the construction D2 cites.** The plan adds a
   `scripts/*.mjs` + a new `.husky/pre-commit` line + a selftest + a whole gate-chain isolation
   ceremony (design.md "Gate-Chain Implications Checklist") for a check whose sole input is one file:
   `frontend/src/theme/theme.css`. That file already has **five** guards that parse it with
   `fs.readFileSync` from Jest, in `frontend/src/theme/`: `focusRingTokenGuard.css.test.ts`,
   `accentTextSourceSyncGuard.css.test.ts`, `elevationTokenGuard.css.test.ts`,
   `motionTokenGuard.css.test.ts`, `theme.css.test.ts`. Notably `elevationTokenGuard.css.test.ts` **is
   HEL-442** (`6800583e`) — the exact ticket D2/task 2.3 cite as "the construction" — and HEL-442 chose
   Jest, not a script. `check-tokens.mjs` is a script because it scans the whole repo's CSS; this guard
   does not. Either re-form the guard as `frontend/src/theme/themeParityGuard.css.test.ts` alongside its
   four siblings (dropping the husky line, the two npm scripts and the gate-chain section entirely —
   Jest already runs in pre-commit), or record in D9.2 an explicit, argued reason to diverge from the
   five nearest neighbours. As written D9.2 rules out the two comparators that were never the real
   alternative and never names the one that is.

2. **The `appearance.ts:305-326` citation is stale and now points at unrelated code — and tasks.md
   instructs the executor to paste it into the deliverable.** On the current tree lines 310–326 are
   `FOCUS_RING_SURFACES` (HEL-1046's literal surface list). `buildAccentTokens` is at
   **`appearance.ts:575-600`**. D3, D9.4 and task 3.2 ("citing `theme/appearance.ts:305-326`") all carry
   the dead citation; task 7.2 puts it in the PR body. Re-anchor all three. (D3a's
   `appearance.ts:255-265` for the second ink site *is* still correct — `resolvePanelTextColor` — leave it.)

3. **The draft guard reports a vacuous pass on a zero-token block; task 2.5 asks the question and the
   draft answers it wrongly.** `checkThemeParity` refuses a vacuous pass only when a block is *absent*
   (`darkBlock === null`). If either block is found but yields zero declarations — a regex change, a
   refactor into `@media`/`@layer`, a selector rewrite to `[data-theme=dark]` without `:root` — the set
   difference is empty, `errors` is empty, and it prints `OK -- 0 --app-* token(s) in the dark block, 0
   in the light block, every one declared in both` and exits 0. Add a non-vacuity floor (a minimum
   expected declaration count, or a hard failure at zero in either block) and mutation-prove that arm
   under task 2.4 alongside the two arms already planned.

4. **D9.4's "walk … at the shipped default" is ambiguous because there are TWO shipped defaults, and D5's
   headline claim is overstated on the current tree.** `frontend/src/theme/theme.ts:12`
   `DefaultAccentColorByTheme = { dark: "#f97316", light: "#ea580c" }`, and `getInitialAccentColor(theme)`
   (l.74/78) returns the theme-specific default whenever `localStorage["helio-accent"]` is unset. D5
   asserts "There is NO per-theme accent asymmetry; there is one accent in both themes" and attributes
   the whole asymmetry to `theme.css`'s runtime-overridden defaults. That is true only *after* a
   dark-first mount persists `#f97316` — `ThemeProvider.tsx:52` seeds `accentColor` once at mount and
   never re-derives it on theme change (l.94 re-*applies* the same value), so the observed
   "`#f97316` in both themes" is a property of the walk's browser profile, not of the app. A profile
   whose first mount is light gets `#ea580c`. Fix two things: (a) state in D9.4 which default is being
   walked in which theme, and clear `localStorage["helio-accent"]` before each theme's walk so the walk
   measures the real initialization path rather than a persisted artifact; (b) correct D5/§D9 to place
   the surviving asymmetry at `theme.ts:12`, not only in `theme.css`'s dead blocks.

   Related and un-addressed anywhere in D9: post-HEL-1048 the 8-preset question is no longer mainly
   about raw `--app-accent` × surface. What paints text is the **derived** `--app-accent-text`, and what
   paints the ring is the **derived** `--app-focus-ring-color`. Task 3.1's matrix as written now measures
   a largely decorative relationship. Say explicitly that the 8× is discharged against the derived
   tokens per preset × theme (the derivations are per-preset, so this is 8 real computations, not one),
   and keep the raw matrix only as context — otherwise the plan spends its analytic budget on the pairing
   that no longer determines legibility.

### Non-blocking notes

- The parked `DESIGN.md.diff` does not merely need "re-verifying" (§8.1) — it asserts as permanent
  standard that the global ring is `--app-focus-ring: 2px solid var(--app-accent)` at 2.38–2.80 in
  light, which is **false on `f20ea8f6`**. It is the binding design doc; name it explicitly in §8.2
  next to tasks 4.2/5.3 rather than leaving it under a generic "recover and re-verify".
- `ticket.md` still says the token counts are 30/30; the current file measures 29/29. Harmless (the
  old-base measurement), but the PR should quote the re-measured number.
- D9.5's routing to HEL-1058/HEL-1059 is correct and needs no change.
