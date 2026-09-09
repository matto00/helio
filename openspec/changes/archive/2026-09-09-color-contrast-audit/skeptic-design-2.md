## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Composites re-derived independently from `theme.css` source (not from round 1's report).**
Parsed the light block (`theme.css:208-248`), took each tint's `color-mix` percentage from
source (`--app-success-surface` 11%, `--app-warning-surface` 11%, `--app-error-surface` 10%),
composited over each neutral parent, and applied the WCAG 2.x formula in a throwaway python
probe. Light theme, intent token on its own tint:

| pair | over surface | over bg | over surface-soft | over raised/strong |
| --- | --- | --- | --- | --- |
| success on success-surface | 4.23 | 3.89 | **3.71** | 4.33 |
| warning on warning-surface | 4.31 | 3.97 | **3.78** | 4.41 |
| error on error-surface | 4.36 | 4.01 | **3.82** | 4.46 |

Neutral-surface figures also reproduce exactly (success 4.25 soft / 4.48 bg; warning 4.32;
error 4.38; warning-on-bg 4.56; error-on-bg 4.62). Round 1's headline finding is **confirmed**
— my figures match to within ±0.02 (integer rounding of the composite). The tint composites
really are the binding worst case, and they are materially worse than the neutral figures.

**CR1 — ADDRESSED.** `design.md` Context now defines the backdrop set as "the five neutral
surfaces plus each intent tint resolved as a composite over every neutral parent it actually
occurs on", carries the composite table, and cites `accessible-accent-text/spec.md:25`.
`tasks.md:1.1a` requires parsing the mix percentage from source (not transcribing) and lists
the expected composites; `2.3a` requires resolving the real parent by walking the rendered
ancestor chain; `3.1` restates the remediation target as "~3.71-3.81, not the ~4.25-4.38
neutral-only figure — sizing the correction against the neutral surfaces alone is insufficient
by construction"; `4.2`/`5.2` carry it into the guard and table. The spec delta encodes it
normatively (Requirement 1 + the "rendered on its own semi-transparent tint" scenario).

**CR2 — ADDRESSED and binding.** `design.md:61` (D4 third branch) and `tasks.md:2.7` now
require the "never renders" exception to name the DOM query run and the routes/dialogs/states
visited, "not the conclusion it reached", explicitly so the evaluator can re-run it verbatim.
Crucially this is not only prose in design.md — it is a normative scenario in
`specs/accessible-token-contrast/spec.md` ("An exception rests on a claim that a pair never
renders" → "names the specific enumeration performed ... such that it can be re-run
independently"). That makes it checkable at the final gate rather than evadable.

**CR3 — ADDRESSED.** D4's closing paragraph now states the guard's covered set is "the full
matrix, not only today's failures ... including comfortably-passing ones", names both thin
margins by number (warning-on-bg 4.56 by 0.06, error-on-bg 4.62 by 0.12), and `tasks.md:4.2`,
`3.4` and `5.2` all carry passing pairs explicitly.

**D5 (accent-on-surface measured, not repainted) — I independently agree it is legitimate,
not scope evasion.** AC3's verb is "verified", and AC1 explicitly admits a justified documented
exception. My own matrix reproduces the light accent `#ea580c` at 3.02-3.56 against all five
neutral surfaces — a uniform, pre-existing, app-wide shortfall of the brand colour itself, not
something this ticket introduced. Fixing it means repainting the brand, which HEL-1048
established is an owner-level visual-identity decision. Publishing the numbers with an explicit
FAIL verdict discharges "verified". D5's added no-dangling-reference clause (`tasks.md:5.2a`:
file a real ticket or say "untracked") is the right closure.

**Achievability of the remediation (the question round 1 did not ask) — I checked it, and it
IS achievable.** I solved for the minimum lightness-only darkening (HSL, hue and saturation
held, per D4/3.1) that clears 4.5:1 against the token's own tint composited over the worst
neutral parent — accounting for the fact that darkening the token also darkens its derived
tint:

| token | today | needed | HSL L | worst composite after | vs `--app-text` |
| --- | --- | --- | --- | --- | --- |
| `--app-success` | `#1a7f4e` | `#176f44` | 0.300 → 0.263 | 4.52 | 2.71 |
| `--app-warning` | `#99621e` | `#87571b` | 0.359 → 0.318 | 4.51 | 2.72 |
| `--app-error` | `#c73a2a` | `#b23426` | 0.473 → 0.423 | 4.51 | 2.72 |

So ~4-5 points of HSL lightness (11-13% relative). The results stay plainly chromatic, stay
2.7:1 distinct from `--app-text` `#211d19`, and need **no** change to the tint percentages and
**no** exception. There is no hidden dependency here — the plan's stated approach reaches its
stated target. (Minor: `design.md`'s Risks section calls the correction "small — a few percent
of lightness", and `tasks.md:3.5` calls it "not small". Both are loosely true at 11-13%
relative; the arithmetic above supersedes either adjective.)

**One new material gap found — see Change Request 1.**

### Verdict: REFUTE

Round 1's three CRs are all genuinely closed and the plan is now well grounded. The single
remaining defect is narrow, is a text-only fix, and is the same *class* of error round 1's CR1
was (a correction sized against the wrong worst case) — surfaced now rather than mid-execution.

### Change Requests

**1. `--app-text-muted` on the intent tints is already sub-AA, and this change makes it
worse, with no defined handling.**

Extending the backdrop set to the tints (CR1) does not only add pairs for the intent tokens —
it adds them for every text-capable foreground. Measured from source:

`--app-text-muted` `#6c655c` on `--app-success-surface` / `--app-warning-surface` /
`--app-error-surface`, each composited over `--app-surface-soft`, = **4.25 / 4.27 / 4.25** —
below AA-4.5 today, and comparable to the intent-token failures the plan is built around.

After the darkening in 3.1 (using my hexes above, or any equivalent), those become
**4.19 / 4.21 / 4.21** — the tint gets darker because it is derived from the token, so this
change *degrades* an already-failing pair as a direct consequence of its own remediation.

Neither task catches this. `3.4` checks only that "no previously-passing pair regressed" — this
pair was not passing, so it is out of scope of that check. `3.5` is about visual coherence.
`1.1a` and `1.2` enumerate the expected sub-AA set and neither lists muted-on-tint, so an
executor working the expectation list rather than the generic matrix will not see it; and even
one that does see it via the generic matrix has no defined action for a pair that 3.1 cannot
fix (darkening `--app-text-muted` is a separate token change, not covered anywhere).

Required revisions:
1a. Add the muted-on-tint composites to `design.md`'s Context table and to `tasks.md:1.1a`'s
    expected-figures list (4.25 / 4.27 / 4.25 over `--app-surface-soft`), so the executor is
    looking for them.
1b. Give them a defined action. The options are genuinely different and the plan should pick
    or at least bound them: (i) darken `--app-text-muted` in the light theme too — note
    `theme.css:216-218` already documents that this token was tuned to sit "a hair under" AA
    against `--app-surface-soft` deliberately, so this reopens a prior deliberate decision;
    (ii) reduce the tint percentages so the composites lift; or (iii) run D4's rendered
    classification on these pairs and, if muted text never lands on a tinted block as
    normal-size text, record them as documented exceptions under D4's third branch — which
    then carries CR2's re-runnable-enumeration obligation.
1c. Extend `tasks.md:3.4` so the post-edit re-measure explicitly checks pairs that were
    *already failing* for further degradation, not only previously-passing pairs for
    regression. A remediation that worsens a different sub-AA pair must be visible.

### Non-blocking notes

* `tasks.md:6.3` still says "the existing seven theme guards" (round 1 flagged this; `design.md`
  C3 was corrected to "Eight" but the task was not). There are 8 `*.css.test.ts` files in
  `frontend/src/theme/`. Say "all theme guards" so a miscount cannot silently skip one.
  `proposal.md:22` likewise still says "seven-guard mechanism".
* `--app-overlay` is correctly excluded from a source-parsed matrix (its composite depends on
  arbitrary page content). Worth one line in the table saying so deliberately.
* `--app-danger`/`--app-danger-surface` are `var()` aliases of `--app-error`/`--app-error-surface`
  (`theme.css:194-195,247-248`), and `--app-info` aliases `--app-accent` — covering the targets
  covers the aliases, but the guard resolving `var()` transitively (as `accentTextClosureGuard`
  does) would make that automatic rather than assumed.
