# HEL-683: Fix pre-existing tsc --noEmit errors (toastListeners/listenerMiddleware) and close the type-check gate gap

## Description

HEL-405's final-gate skeptic (PR matto00/helio#358) ran `npx tsc --noEmit -p .` in
`frontend/` and surfaced ~30 pre-existing type errors concentrated in
`frontend/src/features/toasts/state/toastListeners.ts` and
`frontend/src/store/listenerMiddleware.ts` — wholly untouched by that diff. No
enforced gate currently catches them: `npm run build` uses `vite build`, which
transpiles without type-checking, and neither the pre-commit hooks nor CI run `tsc`.

This is two problems, not one: the errors themselves are real debt, and their
existence proves the enforced gate set has a hole — type errors can land silently today.

## Measured state at planning time (2026-08-21, base 8432f280)

Planning re-measured the ticket's premise rather than trusting its description
(the ticket predates several merges, including HEL-535's rewrite of `toastListeners.ts`).

1. **The debt was real.** Taking `12fae281`'s `frontend/` **source** (main's tip when
   this ticket was filed, 2026-08-16) and checking it against **today's**
   `node_modules`, `tsc --noEmit` exited 2 with **60 error lines**: 58 in
   `toastListeners.ts`, 1 in `listenerMiddleware.ts`, 1 in `src/config/env.ts`. This
   matches the ticket's "~30 errors". (Precisely: this is a source-isolating
   measurement, not a claim about what CI would have printed on that commit's own
   lockfile.)
2. **The debt is already gone.** On the current base (`8432f280`), the same
   command exits **0** with zero errors. `npx tsc --noEmit -p frontend` from the
   repo root — the exact AC command — also exits **0**.
3. **It was fixed incidentally, by source changes, and nothing noticed.** The
   historical run above used *today's* `node_modules` against old source, which
   isolates the change to source rather than dependency drift. The errors were
   already absent by `d7815d15` (HEL-535's parent), so some commit in the
   49-commit window `12fae281..d7815d15` fixed them as a side effect. No gate
   observed the debt appearing, and no gate observed it disappearing.

**Consequence for scope:** acceptance criterion 1 is already satisfied by prior
work. There are no type errors left to fix. The remaining — and, per the ticket's
own framing, the more important — deliverable is the gate. Finding (3) is the
strongest possible argument for it: this class of debt has already demonstrated
that it can both appear and vanish in this repo entirely unobserved.

## Gate gap, precisely located

- `.husky/pre-commit` runs: `lint`, `format:check`, `check:schemas`,
  `check:openspec`, `check:scala-quality`, `test`. No `tsc`. (`ts-jest` type-checks
  modules reachable from a test, so the uncovered surface is precisely the
  un-test-imported one — where the historical errors sat.)
- `.github/workflows/ci.yml` frontend job runs: `npm run lint`,
  `npm run format:check`, `npm test`. No `tsc`.
- `frontend/package.json` has no `typecheck` script. (`helio-mcp/package.json`
  already has `"typecheck": "tsc --noEmit"` — an in-repo naming precedent.)
- `frontend/tsconfig.json` has `"include": ["src", "tests"]`. **`frontend/tests`
  does not exist**, and `vite.config.ts` / `pwa-assets.config.ts` sit outside
  `src`, so they are type-checked by nothing today.

## Acceptance criteria

> **Provenance note.** The filed Linear ticket lists **four** acceptance criteria. Planning made two disclosed edits:
> it **added** the third item below (red-before-green proof), which is strictly stronger than anything filed and is
> the operator's stated priority for this ticket; and it **reworded** the filed "No behavioral changes — type-level
> fixes only" to "type-level/tooling changes only", because AC 1 is already satisfied and the remaining work is
> tooling. No filed criterion was removed or weakened.

- [ ] `npx tsc --noEmit -p frontend` exits clean.
- [ ] A type-check gate is enforced (pre-commit and/or CI) so new type errors fail before merge.
- [ ] The gate is proven to fail on a real type error (red-before-green), not merely proven to pass.
- [ ] No behavioral changes — type-level/tooling changes only; existing tests pass unmodified.
- [ ] Lint/format/tests clean.

## Origin

Standalone follow-up triaged out of HEL-405 (coordinator decision: track as its own
ticket — real debt plus an enforced-gate-set gap, not something to accept silently).
