# Design: fix-legacy-divider-fallback

## Context

`DividerPanel.tsx` resolves the rule color as `color ?? "var(--color-border)"`. The theme system
(`frontend/src/theme/theme.css`) defines no `--color-border`; its border tokens are `--app-border-subtle` and
`--app-border-strong`, each with light/dark values (DESIGN.md "Border" row). An unset CSS custom property makes
`background-color: var(--color-border)` invalid at computed-value time, so the rule paints nothing — legacy dividers
with no explicit `dividerColor` are invisible in both themes. `DividerPanel.test.tsx:33` pins the dead value.

## Goals / Non-Goals

**Goals:**

- Colorless legacy dividers render a visible neutral line in both light and dark themes.
- Explicitly-colored dividers are unaffected.
- Fallback is bound to a token that exists in DESIGN.md / theme.css.

**Non-Goals:**

- No backend, schema, or contract changes; no divider-creation reinstatement; no token additions.

## Decisions

1. **Fallback token: `--app-border-subtle`** (over `--app-border-strong`).
   - DESIGN.md's Border row documents `--app-border-subtle` as the **default hairline** and `--app-border-strong`
     as **hover/emphasis**. A codebase trace (design-gate round 0) found every `--app-border-strong` usage gated
     behind `:hover`/`:focus`/`:active` — no static/resting precedent — while the directly analogous shipping
     static 1px separator `.app-command-bar__sep` (`App.css:55-59`) and the visible skeleton line
     `.panel-content__text-line` (`PanelContent.css:59`) both use `--app-border-subtle`. The divider default
     follows that convention. Alternative considered: `--app-border-strong` for stronger visibility — rejected:
     it would be the first static usage of an emphasis token, diverging from design-language convention; the
     subtle token is proven visible at 1px in production chrome. Verification tasks (4.1/4.2) still require
     visual evidence of visibility in both themes; if that evidence fails, the token choice returns here.
2. **Fix location: the existing `??` fallback in `DividerPanel.tsx`** — one-line change; no new indirection,
   no CSS-side default. Alternative considered: defining the fallback in `DividerPanel.css` — rejected; the inline
   style already owns `backgroundColor`, and splitting the default across files adds a second source of truth.
3. **Test update:** `DividerPanel.test.tsx` assertion changes to the new token. Add/keep a case covering an explicit
   color to lock the no-regression criterion.
4. **Probe-confirm protocol (Iron Law):** before fixing, the executor renders a legacy divider with
   `dividerColor` unset (seed or PATCH one via the API) and captures evidence of invisibility (computed
   `background-color` empty/invalid, screenshot); after fixing, captures visible-line evidence in both themes,
   plus an explicit-color divider unchanged. UI evidence is verified again by the evaluator with Playwright.

## Repro-widening evidence (session directive)

Sweep of `var(--*)` usage in `frontend/src` (css/ts/tsx) diffed against tokens defined in `theme.css`:
the only reference to a nonexistent theme token is `--color-border` in `DividerPanel.tsx` + its test. The other
theme-undefined vars are runtime-assigned, not stale: `--dashboard-background-override` (`app/App.tsx`),
`--dashboard-grid-background-override` (`PanelList.tsx`), `--mobile-panel-height` (`MobilePanelStack.tsx`),
`--panel-surface-override`/`--panel-text-override` (`PanelCard.tsx`), `--toast-intent-color` (`toast.css`).
No spinoff candidates.

## Risks / Trade-offs

- [Dividers previously invisible become visible again] → intended behavior per ticket; no mitigation needed, but
  note in PR that legacy dashboards will visibly change.
- [`--app-border-subtle` renamed later] → same failure class would recur; the updated spec now names the live token,
  so a rename sweep catches it.
- [Subtle hairline reads faint at 1px over some dashboard surfaces] → it is the documented default-hairline role and
  proven in shipping chrome; explicit `dividerColor`/`dividerWeight` remain available per panel for emphasis.

## Planner Notes

- Self-approved: token choice `--app-border-subtle` (convention rationale above, adopted from design-gate round 0
  change request 1(a)); spec delta wording.
- Scope: 2 frontend files + 1 spec delta. No escalation triggers present.
