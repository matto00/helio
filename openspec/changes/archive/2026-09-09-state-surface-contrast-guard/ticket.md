# HEL-866: Modal-hosted hover states are invisible in light theme (same token collision as HEL-496)

## Description

`--app-surface-raised` resolves to `#ffffff` in light theme — **identical** to `--app-surface-strong` (`#ffffff`), the background of the Modal itself. Any hover/active state inside a modal that uses `--app-surface-raised` therefore renders with *zero* visible feedback in the app's default theme. Dark theme is not safe either: `#232019` on `#262320` measures ~1.04:1 and is effectively indistinguishable.

Verified in `frontend/src/theme/theme.css` (re-derived from source this run, not transcribed):

```
light:  --app-surface-soft: #efece6;  --app-surface-raised: #ffffff;  --app-surface-strong: #ffffff;
dark:   --app-surface-soft: #161514;  --app-surface-raised: #232019;  --app-surface-strong: #262320;
```

Spun off from HEL-496 (PR #461), where the defect was found and fixed in the command palette **only** — the skeptic gate deliberately scoped that fix to `CommandPalette.css` rather than widening a diff that had already passed its gates.

### Scale: 58 files, not 54

The ticket body says 54, citing HEL-444's parity audit. **Re-measured this run: 58 files** under `frontend/src` reference `--app-surface-raised`. This is a correction in place, not a dispute — the ticket's point stands and is understated.

### Why grep will undercount it again

The symptom is an **absence**, not a token. A component that *should* express a hover/active state and instead expresses nothing looks, in source, exactly like a component that simply has no hover rule. There is no string to match. Workaround-shaped substitutions — shadow-only elevation, border-only, opacity — are invisible to a grep for `--app-surface-raised`, because the workaround *removed* the token. Aliases, `color-mix()` derivatives, and template-constructed class names are likewise invisible to a name-based sweep.

So the sweep must be **rendered**, not textual: enumerate states that should be visible and check whether they are.

### Relationship to HEL-1044 — causal direction CONFIRMED

HEL-1044 (panel card hover conveys elevation by shadow only) is **downstream of this ticket, not parallel to it**. HEL-1044's own body states it "is blocked in practice on HEL-866 — the ramp rung has to be worth moving to before moving to it is an improvement." HEL-866 is the root cause; HEL-1044's shadow-only treatment is the workaround. Root cause is worked first, here. HEL-1044's own scope (whether the panel card should move to the rung, and consistency across the other card surfaces) is **not absorbed** into this ticket.

### How the original instance was found

In the command palette, arrow-key navigation tracked the active row correctly but produced no visible highlight in light theme. Green unit tests passed and a UI review returned PASS; only a rendered-appearance check at the final skeptic gate caught it. **Any verification for this ticket must therefore be a real rendered check in both themes — a passing test or a token-name comparison is not evidence here.**

## Acceptance criteria

- [ ] **AC1** — Every modal-hosted hover/active state renders a visibly distinct background in **both** light and dark themes, confirmed by rendered screenshots, not by token names or passing tests.
- [ ] **AC2** — The `--app-surface-raised` usage sweep is complete and its result recorded in the PR (which call sites were found, which changed, which were already safe).
- [ ] **AC3** — Contrast is real in dark theme too, not merely non-identical — `#232019` on `#262320` does not count as fixed.
- [ ] **AC4** — A recommendation on a dedicated hover/selected token is recorded, adopted or explicitly declined with reasoning.
- [ ] **AC5 (owner rescope, highest value)** — A **mechanical guard** enforcing that a state background (hover/active/selected) differs *measurably* from its parent surface in both themes. Not merely "non-identical": `#232019` on `#262320` must FAIL the guard. The guard must be **mutation-failable** (proven red by mutating a real value back to the broken state), and its **input set must be enumerated mechanically** — a hand-picked component list fed to an automated comparator is a manual check wearing a machine's clothes. If the guard is genuinely larger than this ticket, file it as its own ticket and say so plainly rather than hand-sweeping 58 files with nothing behind them.

## Constraints

- Cohesion is judged against the **RUNNING APP in both themes**, not DESIGN.md token compliance.
- Adding a token to `theme.css` is a DESIGN.md change and a visual-identity decision — recommend and record; adoption requires escalation.
- Never invoke `npm`/`vite`/`sbt`/`npx playwright` bare where a canonical `scripts/concertino/` script exists; always pass the worktree path explicitly (CON-165).
- `scripts/concertino/` is a render target — never hand-edit it.
