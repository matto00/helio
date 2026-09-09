## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

Cold spawn. Every ratio below re-derived by me from `frontend/src/theme/theme.css`
source with a plain-hex WCAG script (`sRGB` linearise + `(L1+.05)/(L2+.05)`,
tints composited as `fg*p + parent*(1-p)`), not adopted from any prior report.

**Dark block read** (`theme.css:136-180`): surfaces `#121110 / #1a1816 / #161514 /
#232019 / #262320`; `--app-text #f2efe9`, `--app-text-muted #9b948a`; intents
`#4cc38a / #f5b944 / #f07561`; all three tints 14%.

1. **Round 3's CR is closed on all three limbs.**
   (a) `specs/accessible-token-contrast/spec.md:11` now names
   `--app-success-surface` / `--app-warning-surface` / `--app-error-surface`
   explicitly; the `--app-*-surface` glob is gone, and it now matches
   `tasks.md:1.1a` and design.md Context.
   (b) **D9 is present** and states the boundary with its reason (accent tints are
   inline-written at runtime per C1, so a source-parsed guard structurally cannot
   score them; `accentTextSourceSyncGuard` already covers the accent-text case for
   8 presets).
   (c) The residual is recorded honestly in `tasks.md:5.1a` — non-accent
   foregrounds on accent tints and all foregrounds on `--app-accent-mid` (3.17-3.63)
   named as unguarded, under the D5/5.2a file-or-say-untracked rule.

2. **The 3.82 figure is exactly right.** Dark `--app-text-muted #9b948a` over the
   14% intent tints, all 5 neutral parents: worst = **3.821**,
   `--app-warning-surface` over `--app-surface-strong` — precisely the pair and
   value D8/1.1a name. Full set: warning/strong 3.82, success/strong 4.03,
   warning/raised 3.98, success/raised 4.20, error/strong 4.20, error/raised 4.38.
   The claim that this is worse than light's 4.25 is correct.

3. **`#aba398` is sound, and every clause of its claim checks out.** Worst against
   all 5 neutrals and all 15 tint composites = **4.601** (warning/strong) —
   clears the plan's own `>= 4.6` target, by 0.001. Against `--app-text #f2efe9`
   it is **2.17:1**, exactly as D8 states, so it remains a visibly muted step.
   **No new problem is created:** every dark backdrop is darker than the muted
   token, so lightening it is monotonically contrast-improving across the whole
   dark backdrop set — nothing it previously passed can fail. And unlike light,
   the dark intent tokens are *not* being darkened (3.1), so the dark tints do not
   move under remediation and 4.601 is a stable post-change figure, not a
   pre-change one. I checked two neighbours for headroom: `#a9a196` gives 4.49
   (fails), `#b0a89c` gives 4.876 at 2.05:1 from `--app-text`.

4. **Round 3's light-side arithmetic also reproduces**, unchanged: current muted
   worst 4.249 (error tint / soft); post-remediation (darkened intents) `#676057`
   worst **4.520**, `#645d55` worst **4.728**. So the `~#676057` hex still lands
   short of the stated `>= 4.6` post-remediation — same non-blocking note as round
   3, and still adequately governed by "the target governs" plus task 3.4's
   mandatory re-measure.

5. **Two things are still open** — see Change Requests. Both were found by reading
   the artifacts as an executor would, not by extending the matrix for its own sake.

### Verdict: REFUTE

Both requests are text-level and cheap. I found nothing else worth another round;
the measurement core of this plan is now correct and independently reproduced.

### Change Requests

1. **The plan now contradicts itself about whether the dark theme is in scope, in
   the two places an executor is most likely to obey.** `design.md:39` lists as a
   **Non-Goal**: "Touching the dark theme, which measures clean throughout (worst
   pair 5.21)." That sentence is (i) factually false — I measure 3.821 — and (ii)
   an explicit scope exclusion of precisely the correction D8 step 2 and task 3.4a
   now require. `proposal.md` carries the same false claim ("The dark theme is
   clean throughout"). `tasks.md:22` (3.1) ends "Do not touch the dark theme."
   An executor reading Non-Goals + 3.1 skips the dark muted fix; an evaluator
   reading Non-Goals refutes the dark change as scope drift. Either outcome is
   wrong, and it is the exact "decided rather than discovered mid-execution"
   failure D8 exists to prevent. Required:
   (a) delete the dark-theme Non-Goal in `design.md:39`, or replace it with the
   true statement — dark intent-token-on-its-own-tint is clean (5.11-8.13), but
   dark `--app-text-muted` on the intent tints is not (3.82), and correcting it is
   in scope per D8;
   (b) correct the "dark theme is clean throughout" sentence in `proposal.md`;
   (c) narrow `tasks.md` 3.1's closing sentence to what it means — "do not darken
   the dark-theme *intent* tokens (they are clean on their own tints); the dark
   `--app-text-muted` correction in 3.4a is in scope."

2. **"The full matrix" (4.2 / 5.2) is unbounded on the cross-intent cells, and one
   of them fails with no decision to lean on.** 4.2 requires "every foreground x
   backdrop pair (neutral surfaces and tint composites) is asserted", with no
   exclusion. Built literally, that includes an intent token on a *different*
   intent's tint. Measured: dark `--app-error #f07561` on `--app-warning-surface`
   over `--app-surface-strong` = **4.05**, error-on-warning/raised 4.22,
   error-on-success/strong 4.27 — all below 4.5, and all unaffected by anything
   this change remediates (the dark intent tokens are held fixed). The light-side
   cross cells (worst 3.71-3.77) happen to be swept up by 3.1's ~3.71 target, but
   the dark ones are not. So the executor hits a guard failure with no D-decision
   covering it and must invent a scope call mid-execution: drop the cross-intent
   cells, or run a D4 rendered walk plus a 2.7 re-runnable enumeration for pairs
   that are almost certainly compositional nonsense. Required: state the decision
   in D9 (or a D10) and mirror it in 4.2/5.2 — either the matrix is
   foreground x {neutral surfaces, that foreground's OWN intent tint, plus
   `--app-text`/`--app-text-muted` on all three tints} with cross-intent cells
   excluded by construction and the exclusion justified in one line, or
   cross-intent cells are in and are held to 3:1 as non-rendering UI cells. Name
   the dark error-on-warning-tint 4.05 figure explicitly so the executor is not
   surprised by it.

### Non-blocking notes

- `#aba398` clears the stated `>= 4.6` target by **0.001** (4.601). That is
  technically compliant but is the same "passes by a hair" fragility the plan
  itself warns against in D8 ("a pair that passes by 0.01 is a future silent
  break"). Consider `#b0a89c` (4.876,
  still 2.05:1 from `--app-text`).
- Task 3.4a's light hex `~#676057` yields 4.52 post-remediation, short of its own
  `>= 4.6`. Round 3 raised this; it is still worth softening the hex to "expect
  roughly `#645d55` (4.73) once the intent tokens are darkened; the `>= 4.6`
  target governs, not the hex."
- `ticket.md`'s premise-validation section also says "Dark theme is clean
  throughout". It is a historical record of what was known then, so I would leave
  it — but if it is edited, mark it superseded rather than rewriting the history.
- D8 option 3's "DESIGN.md §3 surface/opacity invariants" characterisation is
  still over-claimed (§3 governs opaque structural surfaces, not wash
  percentages); round 3 noted this and it is still carried into `tasks.md:3.4a`.
  The app-wide-repaint reason carries the rejection on its own.
