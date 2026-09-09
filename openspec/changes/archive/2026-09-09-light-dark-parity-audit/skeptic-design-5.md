## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Scope per orchestrator: the currency revision (design.md D9, tasks.md §8) plus the parked guard
draft. I verified every CR against the tree, not against the orchestrator's summary.

### What I verified (with evidence)

**CR1 (guard family / Jest vs script) — DISCHARGED, and the chosen form is independently correct.**
`ls frontend/src/theme/*.test.ts` returns nine tests, of which **seven** parse `theme.css` with
`readFileSync`: `accentTextClosureGuard`, `accentTextSourceSyncGuard`, `elevationTokenGuard`,
`focusRingTokenGuard`, `motionTokenGuard`, `theme.css.test.ts`, `tokenAuditSweep`. D9.2's list is
accurate (it names all seven, two more than round 4 found). The "zero new wiring" claim holds:
root `package.json` `"test": "jest && npm --prefix frontend test"`, `.husky/pre-commit:21` runs
`npm test`, and `.github/workflows/ci.yml:96` runs `npm test` in the merge-blocking job — so a
`frontend/src/theme/themeParityGuard.css.test.ts` is enforced without a husky line, an npm
`check:*` pair, a `.selftest.mjs`, or a gate-chain section. Dropping all four is right.

**CR2 (dead `appearance.ts:305-326` citation) — SUBSTANTIVELY discharged, but D9.4 misreports its
own scope.** Ground truth on `f20ea8f6`: `buildAccentTokens` is at `appearance.ts:575`,
`FOCUS_RING_SURFACES` at `:320`, `resolvePanelTextColor` at `:245` — so the corrected anchors in
D9.4 and tasks.md 8.6 are right, including the newly-caught stale `255-265`. However
`grep -n "305-326\|255-265"` shows the old citations **still present** at `design.md:32`,
`design.md:66` and `tasks.md:21` (task 3.2). D9.4's parenthetical — "re-anchored here, in D3, in
task 3.2 and in task 7.2" — is false as to D3 and task 3.2. See note 1; not blocking because
tasks.md §8 is declared binding over the boxes above it and 8.6 carries the correct symbol-based
anchors explicitly.

**CR3 (vacuous pass on a zero-token block) — DISCHARGED.** tasks.md 8.7 states the failure mode
correctly (refusal only on `darkBlock === null`), requires a non-vacuity floor, and requires the
new arm be **mutation-proved** alongside the two arms 2.4 already plans. That is the right shape:
a floor without a mutation proof would be exactly the evidence-shaped non-evidence this ticket is
about.

**CR4 (two shipped defaults) — DISCHARGED, and D9.4's account is accurate.** Verified line by line:
`theme.ts:13` `DefaultAccentColorByTheme = { dark: "#f97316", light: "#ea580c" }` (D9.4 says `:12`
— off by one, harmless); `getInitialAccentColor(theme)` (`theme.ts:72-79`) returns
`DefaultAccentColorByTheme[theme]` only when `localStorage[AccentStorageKey]` is null;
`ThemeProvider.tsx:52-53` seeds `accentColor` once in a `useState` initializer and the effect at
`:94-96` re-*applies* the same value on theme change. So "one accent in both themes" really is a
persisted-profile artifact, and the asymmetry really does live in `theme.ts`. D5 is correctly
corrected rather than quietly patched. One methodological gap in the remedy — note 2.

**CR4b (8× against the DERIVED tokens) — DISCHARGED.** D9.4 and tasks.md 8.9 now put the 8× on
`--app-accent-text` / `--app-focus-ring-color` as 16 real computations and demote the raw
`--app-accent` × surface matrix to context, while keeping task 3.3's "sub-4.5 count is not a defect
count" guard. This is the change that stops the plan from spending its budget on a pairing that no
longer determines legibility.

**Round-4 non-blocking notes — both landed** as tasks.md 8.10 (the parked `DESIGN.md.diff` asserts
a false standard and must be rewritten, not re-applied) and 8.11 (29/29, not 30/30).

**Cohesion mandate.** I read D9 specifically for whether it mistakes token coverage for cohesion.
It does not: D9.1 narrows the live question to "does anything still RENDER the raw `--app-accent`
where a threshold applies", answered per surface by computed style; task 4.4 (D6) hunts what no
declaration expresses; the parity guard is scoped honestly to AC1's source-level coverage question
and is explicitly distinguished from the rendered-contrast guard rather than sold as covering it.
The token table is context, the running-app walk is the deliverable. That is the correct division.

### Verdict: CONFIRM

Sound enough to implement. Nothing remaining is blocking: the two inaccuracies below are localized,
cheap, and already contradicted by binding text elsewhere in the same artifacts.

### Non-blocking notes

1. **`design.md:32` and `:66` still carry `appearance.ts:305-326` and `:255-265`, and `tasks.md:21`
   (task 3.2) still instructs the executor to cite `305-326`** — contrary to D9.4's own claim that
   it re-anchored them. Fix all three by symbol (`buildAccentTokens`, `resolvePanelTextColor`) as
   8.6 requires, and correct D9.4's parenthetical so the artifact stops asserting a state it is not
   in. This ticket has now been bitten twice by confidently-false documentation of its own base;
   do not let the fix-note become the third instance.

2. **Clearing `localStorage["helio-accent"]` is necessary but not sufficient — a reload is
   required.** `ThemeProvider.tsx:52` seeds the accent only in a mount-time `useState` initializer,
   and `:95` re-*writes* `localStorage` on every apply. So clearing storage in the console, or
   toggling the theme after clearing, both leave the already-seeded value in state and re-persist
   it — reproducing exactly the artifact CR4 identified. To observe `#ea580c`, the page must be
   loaded fresh **with theme already light and no stored accent**. Add "and reload" to 8.8/D9.4;
   task 8.8's "record per surface which default is in force" is a good backstop but should not be
   the only thing standing between the walk and a repeat of the same measurement error.

3. **D9.2's "Jest already runs in pre-commit and in CI" is half-true in a delivery worktree.**
   `.github/workflows/ci.yml:47-53` records (HEL-846) that "`npm test` inside the hook is vacuous
   in the linked worktrees where every delivery runs (HEL-768/HEL-880)". CI enforcement is real and
   merge-blocking, which is what the decision rests on, and this is identical to the situation of
   all seven sibling guards — so the choice stands. But the executor must not treat a green
   pre-commit as evidence the new guard fired; run `npx jest` from `frontend/` explicitly, as tasks
   1.2 and 6.2 already require. Worth one clause in D9.2 so the next reader is not misled.

4. `theme.ts:12` in D9.4 is `theme.ts:13` on the current tree (the preceding comment block shifted
   it). Prefer the symbol `DefaultAccentColorByTheme`.
