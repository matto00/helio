## Why

`--app-surface-raised` and `--app-surface-strong` are byte-identical (`#ffffff`) in light theme, so every hover/active state that layers `raised` on a `strong` surface — the Modal's own background — renders with **zero** visible feedback in the app's default theme. Dark theme is no better in practice: `#232019` on `#262320` measures **1.040:1**. HEL-496 found and fixed exactly one call site and deliberately scoped out the rest; **58 files** under `frontend/src` reference the token.

The class cannot be closed by sweeping call sites alone, because the defect's mature form is an **absence**: a component that worked around the invisible state by conveying it another way (shadow-only elevation, border-only, opacity) has no token left for a grep to find. HEL-1044 is a live instance — it has *no* `--app-surface-raised` reference at all, which is precisely its defect. So the only thing that scales to this surface and prevents reintroduction is a mechanical guard on the *relationship* between a state background and its parent surface, not on any token's name.

## What Changes

- **New mechanical guard, rendered rather than static**: a Playwright spec in the repo's existing CI-gated `e2e/` harness that walks the **running app in every theme** and fails when an interactive state background does not differ **measurably** from the surface it actually composites against. "Measurably" is a contrast threshold, not an inequality — the broken dark pair (1.040) must FAIL, not pass for being non-identical.
- **The population is enumerated mechanically from the rendered DOM**, and the parent surface is resolved by walking the rendered ancestor chain. A static parse was designed first and rejected at the design gate: it resolved the element's own background, which is transparent for **72%** of state declarations — including the very call site HEL-496 fixed — and would have required a ~116-entry allowlist, i.e. the hand-curated population this ticket exists to forbid.
- **The guard detects an ABSENCE**, not only a bad value. Comparing each element before and during its state catches the component that conveys nothing at all — the shape that made this surface undercountable and that no grep and no static check can see. Shadow-only/border-only states are reported as **advisory, not failures**, because adjudicating them is HEL-1044's decision, not this ticket's.
- **A self-test proving the guard's failability**, driving the real broken values (`#ffffff` on `#ffffff`, `#232019` on `#262320`) through the contrast core and asserting on the **pair named in the output**, never on exit code alone — plus a live mutation of a real remediated call site, captured green-to-red.
- **Call-site remediation**: every failing state moves to `--app-surface-soft` (the token HEL-496 correctly chose), verified by rendered screenshots in both themes.
- **A recorded recommendation** on a dedicated hover/selected token, per AC4 — recommended, explicitly **not adopted** this run.

**Not in scope, deliberately:** HEL-1044's panel-card decision, and changing any value in `theme.css`. Both are visual-identity changes requiring owner sign-off.

## Capabilities

### New Capabilities
- `state-surface-contrast-guard`: the mechanical guarantee that an interactive state's background differs measurably from the surface it renders on, in every theme, with the guard's input set derived from the tree and its failability continuously demonstrated.

### Modified Capabilities
- `helio-design-tokens`: adds the requirement that an interactive state background must be chosen for measurable contrast against its parent surface rather than by position on the elevation ramp, because the light-theme ramp saturates at `#ffffff` and cannot express an "elevated" state on a top surface.

## Impact

- **New**: a state-contrast spec under `e2e/`, plus a reusable contrast/measurement module and its self-test.
- **Modified**: `package.json` (script entry) and the CI `e2e` job's spec set; CSS call sites under `frontend/src` that layer a state on a colliding surface; `DESIGN.md` (records the ramp-saturation rule and the dedicated-token recommendation).
- **Unchanged**: `frontend/src/theme/theme.css` token *values* — no visual-identity change is made without owner sign-off.
- **Downstream**: unblocks HEL-1044, which is blocked in practice on this ticket by its own statement.
