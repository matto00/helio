## Context

See proposal.md — Why. Current copies (tree at f3113ed45):

| Location | Visibility | Guard | Query | Read style | Callers |
|---|---|---|---|---|---|
| `frontend/src/utils/chartAppearance.ts:89` | exported | `typeof window === "undefined" \|\| typeof window.matchMedia !== "function"` → `false` | `(prefers-reduced-motion: reduce)` | one-shot | `chartAppearance.ts:253` (default param of `applyHoverEmphasis`), `features/panels/ui/buildChartOption.ts:233` |
| `frontend/src/shared/ui/Toast.tsx:18` | private | identical | identical | one-shot | `Toast.tsx:48` (inside `dismiss` callback) |

`frontend/src/hooks/useIsNarrowerThan.ts` is not a third copy: it queries `(max-width: ${breakpointPx - 1}px)`, is a reactive hook with a `change` listener, and shares only the guard expression. Its doc comment says it matches "`Toast.tsx`'s `prefersReducedMotion` guard convention" — a pointer that becomes stale once Toast's private copy is deleted.

No test mocks/spies `prefersReducedMotion` via a module namespace (`grep -rn "spyOn(chartAppearance" frontend/src` hits only `resolveChartTheme`), so moving the export does not break any `jest.spyOn`/`jest.mock`.

## Goals / Non-Goals

**Goals:** exactly one `prefersReducedMotion` implementation in `frontend/src`; every caller imports it; behaviour identical at each call site.

**Non-Goals:**
- A reactive `usePrefersReducedMotion()` hook. Neither caller needs one (Toast reads at dismiss time; the chart reads at option-build time), so adding one would be unused code.
- A generic `matchesMediaQuery(query)` helper shared with `useIsNarrowerThan`. That hook's guard is used in two places with different shapes (one returns `false`, one early-returns from an effect); generalising it is a separate refactor with no ticket.
- Any CSS rule or `@media (prefers-reduced-motion: reduce)` block — CSS is out of scope except the one comment in D5.
- Editing archived openspec changes that mention the old locations.

## Decisions

**D1 — New module `frontend/src/utils/prefersReducedMotion.ts`, one-shot function.** The body is copied verbatim from `chartAppearance.ts:89-92` (identical in behaviour to Toast's). `utils/` is the right home per `frontend/src/utils/README.md` ("utilities actually imported by more than one feature"): after this change it is imported by `features/panels/ui/buildChartOption.ts`, `utils/chartAppearance.ts`, and `shared/ui/Toast.tsx`. Alternative considered: keep it exported from `chartAppearance.ts` and have Toast import from there — rejected because it couples a toast to chart-theming code and hides a general helper inside a chart module.

**D2 — No re-export from `chartAppearance.ts`.** The only external importer (`buildChartOption.ts`) is retargeted directly. A re-export would leave two import paths for one helper.

**D3 — Tests move with the code.** The existing `describe("prefersReducedMotion")` block in `chartAppearance.test.ts` (two cases: matches true / false) moves into `frontend/src/utils/prefersReducedMotion.test.ts` unchanged, plus one new case: `matchMedia` absent → returns `false` and does not throw. The `typeof window === "undefined"` (SSR) branch is not unit-testable under jsdom (window always exists) and is kept by verbatim copy. `Toast.test.tsx`'s reduced-motion case and `chartAppearance.test.ts`'s `applyHoverEmphasis` cases are untouched and act as call-site regression tests.

**D4 — `useIsNarrowerThan.ts` code unchanged.** Only its doc comment pointer is updated to name `utils/prefersReducedMotion.ts`.

**D5 — One comment-only CSS edit (design-gate round 1, CR1).** `frontend/src/shared/ui/toast.css`'s HEL-535 D4 comment says "`Toast.tsx`'s own `matchMedia` check"; after Toast's private copy is removed that sentence is false. It is reworded to name the shared helper. No CSS rule changes.

## Risks / Trade-offs

- [A caller silently changes semantics] → Body copied verbatim; call-site tests (`Toast.test.tsx` reduced-motion D4 case, `applyHoverEmphasis` tests, ChartPanel tests) run unchanged.
- [Stale doc pointers] → tasks.md requires a zero-hit grep for the old locations' prose, including toast.css's comment (D5).

