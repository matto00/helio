## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

**1. CR1 (round 4) — "dark is clean" / "do not touch dark"**

`grep -rn "clean throughout|dark is clean|not touch the dark|dark theme is clean"` across the change dir:

- `proposal.md` — no surviving false claim. Line 15 now reads "The dark theme's intent tokens are clean, but the dark theme overall is not: `--app-text-muted` on the dark intent tints measures 3.82 at worst." Correct and correctly scoped.
- `design.md:15` — explicitly states "the dark theme is not clean overall" and forbids generalising. `design.md:39` — the Non-Goal is narrowed to "Changing the dark theme's **intent tokens**", and names the earlier draft's false basis. Closed.
- `tasks.md:4` (1.1a) — carries the "do NOT generalise that to 'dark is clean'" warning inline. Good.
- `ticket.md:43` still contains "Dark theme is clean throughout" — but `ticket.md` is the upstream input artifact (premise-validation transcript), not one of the three artifacts the CR named, and `design.md:39` explicitly overrides it by name. Not a blocker.
- **`tasks.md:23` (3.1) still ends with the literal sentence "Do not touch the dark theme."** This is the one CR1 sub-item that was NOT applied. See non-blocking note 1 for why I am not refuting on it.

**2. D10's stopping rule — is it bounded, or a relocated regress?**

Sound and genuinely closed, for a structural reason rather than a rhetorical one. The backdrop set is *closed by D9*, not by D10: five neutral surfaces plus three intent tints, with everything excluded named and justified (accent-derived backdrops are structurally unscorable by a source parser per C1, and are already covered by `accentTextSourceSyncGuard`; `--app-bg-accent`/`--app-bg-secondary` have zero background call sites). Foregrounds are likewise a closed enumeration from `theme.css`'s 29 tokens. D10 then says: take the *entire* cross-product of those two closed sets.

That is what ends the four-round regress. Rounds 1-4 each found new failures because each prior draft enumerated a hand-picked subset of the matrix; a hand-picked subset can always be widened. A full cross-product over two closed sets cannot — there is no cell left for round 6 to discover. The fix set stays bounded independently, by D4's rendered walk, and the escalate-don't-remediate clause for a rendered cross-intent cell keeps that boundary from silently absorbing scope. This is the correct shape and I regard the regress as closed.

**3. Executability without inventing a threshold, token value, or scope call**

- Thresholds: 4.5 normal text / 3.0 large-text-UI-boundary, assigned by D4's three-way rendered classification. No invention.
- Token values: `#6c655c -> ~#676057` (light muted), `#9b948a -> ~#aba398` (dark muted) given with their target margin (>= 4.6, not the bare 4.51); intent tokens given a target to beat (~3.71-3.81 worst backdrop) rather than a value, which is the right form since the value falls out of the measurement.
- Scope calls: every fork has a pre-decided branch — D5 (measure, don't repaint), D8 (ordered 1/2/3 with option 3 rejected and escalation named), D10 (rendered cross-intent cell -> escalate), 5.2a (file a real ticket or say "untracked").
- Guard mechanism, path, vacuity refusal, mutation arms, CI surface: all specified (D1/D2/D3, tasks 4.1-4.6).

Yes — executable end-to-end.

**4. Measurement spot-check (independent recompute, plain WCAG on sRGB)**

Parsed dark block from `frontend/src/theme/theme.css`: `--app-warning: #f5b944`, `--app-error: #f07561`, `--app-text-muted: #9b948a`, `--app-surface-strong: #262320`, `--app-warning-surface: color-mix(... 14%, transparent)`.

Composite 14% `#f5b944` over `#262320` = `#433825`.

- `--app-error` `#f07561` on that composite = **4.054** -> the plan's **4.05 is correct**.
- `--app-text-muted` `#9b948a` on the same composite = **3.821** -> the plan's 3.82 worst-case is correct, and correctly attributed to `--app-warning-surface` over `--app-surface-strong`.
- Light `--app-text-muted` `#6c655c` on `--app-surface-soft` `#efece6` = **4.875** -> matches the 4.87 thin-margin figure.

Three independent recomputes all land on the plan's numbers. The measurement core is trustworthy.

### Verdict: CONFIRM

### Non-blocking notes

1. **`tasks.md:23` (3.1) still says "Do not touch the dark theme."** — the one unapplied piece of round 4's CR1. It contradicts `tasks.md:27` (3.4a), which requires correcting `--app-text-muted` in BOTH themes, and `design.md`'s D8. I am not refuting because the contradiction resolves correctly on any careful read: 3.1's own subject is "darken the **light-theme** token" for intent tokens (dark intent tokens are legitimately held fixed), 3.4a is later, more specific and unmissable, and `design.md:39` explicitly disclaims the blanket form by name. Worst realistic outcome is an under-delivery (dark muted's 3.82 left unfixed), not a wrong value — and the final gate will catch it, since the dark 3.82 cell must appear in the committed table with a verdict. **Executor: reword 3.1's last sentence to "Do not change the dark theme's intent tokens (`--app-success`/`--app-warning`/`--app-error`); `--app-text-muted` is handled in both themes by 3.4a."** as the first edit of the run.
2. `ticket.md:43`'s "Dark theme is clean throughout (worst 5.21)" is stale in the same way. The 5.21 figure is a neutral-surface-only reading; the real worst dark cell is 3.82 on the tints. Since `ticket.md` is an input transcript, a one-line correction note appended to it (rather than a rewrite) would stop a future reader re-importing the false premise.
3. Task 3.4c (`shared/ui/Toggle.css:53`, `--app-text-muted` used as a background) is a good catch and correctly framed as "verify, do not assume the direction is safe". Worth confirming the toggle's *knob/label* contrast too, not only the track-vs-surface 3:1, since both themes' muted values move.
