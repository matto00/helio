## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**1. The five claimed measurements — RE-DERIVED INDEPENDENTLY, ALL CORRECT.**
Parsed hexes straight out of `frontend/src/theme/theme.css` (light block lines 208-242,
dark block 149-189) and computed the WCAG 2.x formula (sRGB linearisation, 0.2126/0.7152/0.0722,
`(L1+.05)/(L2+.05)`) in a throwaway python probe. Full light matrix:

```
  text     bg=14.96 surface=16.33 soft=14.20 raised=16.74 strong=16.74
  muted    bg=5.14  surface=5.61  soft=4.87  raised=5.75  strong=5.75
  success  bg=4.48* surface=4.89  soft=4.25* raised=5.01  strong=5.01
  warning  bg=4.56  surface=4.97  soft=4.32* raised=5.10  strong=5.10
  error    bg=4.62  surface=5.04  soft=4.38* raised=5.16  strong=5.16
  accent   bg=3.18* surface=3.47* soft=3.02* raised=3.56* strong=3.56*
```
Dark worst pair = `--app-text-muted` on `--app-surface-strong` = **5.21**, matching the claim;
dark is clean. Every one of the five claimed figures (4.25 / 4.48 / 4.32 / 4.38 / 4.87)
reproduces exactly. The premise validation's arithmetic is sound.

**2. D1 / the seven-guard mechanism — VERIFIED.** `frontend/src/theme/` contains eight
`*.css.test.ts` guards; five of them `readFileSync` `theme.css` by name
(`accentTextSourceSyncGuard` 20 refs, `focusRingTokenGuard` 15, `themeParityGuard` 8,
`theme.css.test.ts` 3, `elevationTokenGuard` 1), with `tokenAuditSweep`,
`motionTokenGuard` and `accentTextClosureGuard` sweeping CSS more broadly. A Jest test
parsing `theme.css` is unambiguously the established pattern. D1 is correct.

**3. Capability scoping — VERIFIED, no overlap.** `openspec/specs/accessible-accent-text/spec.md`
holds four requirements about `--app-accent-text`; `accessible-focus-indicator/spec.md`
holds six about the focus indicator. Neither mentions `--app-accent-ink`
(`grep -n "accent-ink"` returns nothing in either), and neither covers a plain
intent-token-on-surface text pair. `accessible-token-contrast` is correctly scoped and
does not re-litigate a live requirement.

**4. Token-set completeness — GAP FOUND.** See Change Request 1.

### Verdict: REFUTE

One material defect. The rest of the plan is unusually well-grounded and I am not asking
for it to be reworked — CRs 2 and 3 are small, bounded additions.

### Change Requests

**1. The surface enumeration is incomplete in the one way that changes the answer: the
intent tokens are rendered as text on their OWN tint surfaces, and those composites are
worse than every neutral surface the plan measures.**

`design.md:3` and `tasks.md:1.1/5.2` scope the matrix to "every text-capable foreground x
every *neutral* surface token" — the five neutrals. But `--app-*-surface` tints are used as
backgrounds under matching intent-coloured text throughout the app. Concrete rendered
instances found by grep of `frontend/src/**/*.css`:

* `shared/chrome/StatusMessage.css:16-17` — `background: var(--app-error-surface); color: var(--app-error);` at `font-size: var(--text-sm)`
* `features/settings/ui/ApiTokensSection.css:31-32` — `background: var(--app-warning-surface); color: var(--app-warning);` at `--text-xs`
* plus ~18 further `--app-{error,warning,success,danger}-surface` background sites
  (`AgentMemoryList.css:34,121`, `MfaSecuritySection.css:31,96`, `PipelineScheduleDialog.css:130`,
  `PanelGrid.css:151,206`, `ToolCallIndicator.css:71,84`, `MessageTurn.css:45`,
  `RunHistoryModal.css:73,92`, `UserMenu.css:136`, `DashboardList.css:445`, ...)

Composited (light theme; tint pct read from `theme.css:244-246`):

| pair | over `--app-surface` | over `--app-bg` | over `--app-surface-soft` |
| --- | --- | --- | --- |
| `--app-error` on `--app-error-surface` (10%) | 4.37 | 4.03 | **3.81** |
| `--app-warning` on `--app-warning-surface` (11%) | 4.31 | 3.97 | **3.79** |
| `--app-success` on `--app-success-surface` (11%) | 4.22 | 3.89 | **3.71** |

(Dark composites are clean: 5.11-8.13.)

Why this is blocking rather than a note: D4/tasks 3.1 says darken "until it clears 4.5:1
against **the worst surface it renders on**". Under the plan's own enumeration the worst
surface is `--app-surface-soft` at 4.25-4.38, so the executor would darken by ~2-6% and
declare victory — while the actual worst *rendered* backdrop is 3.71-3.81, needing a
substantially larger correction. The plan as written produces a fix that is measurably
insufficient and a guard that certifies it. This is also the exact principle the sibling
capability already states: `accessible-accent-text/spec.md:25`, "The obligation is scored
against every background the text can land on."

Required revisions:
1a. Extend the surface enumeration in `design.md` Context, `tasks.md` 1.1, and `tasks.md`
5.2 to include the `--app-*-surface` tint tokens, resolved as composites over each neutral
surface they can sit on (the tint is `color-mix(... , transparent)`, so its rendered value
depends on the parent — enumerate the parents that actually occur rather than assuming one).
1b. Add the composite resolution to the guard's remit (D2 stays: parse the mix percentage
and the base from source, do not transcribe), or state explicitly why the composite is
measured in the rendered walk instead — but it must be measured somewhere, and the number
must reach the table.
1c. Restate D4's remediation target so "worst surface it renders on" unambiguously includes
the tint composites.

**2. D4's "documented exception" clause needs one more constraint to not be a loophole.**
The three-way classification is sound and I am not asking for it to be replaced — a blanket
4.5 genuinely would force unjustified churn, and the "renders only as large text / border /
fill" branch is a legitimate WCAG reading. The abuse risk is narrower than a general
loophole: the third branch, "never renders on that surface at all", is a **universal
negative** justified by a failed search, and `tasks.md:2.4` already concedes this is the
class of claim that failed three cycles on HEL-444. `design.md:73`'s mitigation ("an
unjustified exception is visible as an empty reason") does not discriminate a confident
wrong reason from a right one.

Required revision: in D4, require that a "never renders" exception name the specific
enumeration that was run (the DOM query, the routes/dialogs visited) — not a conclusion —
so the evaluator can re-run it. An exception whose evidence is not independently re-runnable
is a defect. Exceptions of the "large text / non-text role" kind are fine as-is, since those
carry a positive, checkable measurement (the instance's computed font-size/weight).

**3. Two thin-margin pairs need to be in the table and pinned by the guard, not dropped.**
`--app-warning` on `--app-bg` = 4.56 and `--app-error` on `--app-bg` = 4.62 pass today by
0.06 and 0.12. `tasks.md:3.4` only checks "no previously-passing pair regressed" after the
edits, and since 3.1 darkens these tokens they will improve, not regress — so nothing is
wrong. But they are exactly the pairs a future token edit will break silently. Confirm the
guard's covered set is the full matrix rather than only today's failures, and that all
passing pairs appear in the table with their ratios (the plan implies this at 5.2 but
`design.md`'s D-list never says the guard covers passing pairs).

### Non-blocking notes

* **D5 is a legitimate reading, not scope evasion.** AC3's verb is "verified", and the
  ticket's AC1 explicitly admits "a justified, documented exception". The light-theme
  accent-on-surface shortfall reproduces in my own matrix (3.02-3.56 across all five
  surfaces, worse than the 1.78-3.71 range `DESIGN.md:150-190` records) and is plainly
  pre-existing and app-wide. Repainting the brand inside an accessibility fix is precisely
  what HEL-1048 required owner sign-off for. Measure-and-document with an explicit FAIL
  verdict and a tracking pointer is the right call. One ask: D5/tasks 5.2 says "a pointer
  to its tracking ticket" — that ticket does not appear to exist yet. Per the repo's own
  rule that a deferral must name a real task, either file it or say in the table that it is
  untracked; do not emit a dangling reference.
* `design.md:3` says "29 `--app-*` tokens per block" and C3/D1 say "seven Jest guards".
  I count eight `*.css.test.ts` files, five of which read `theme.css` by name. The counts
  are close enough not to matter for the decision, but `tasks.md:6.3` asks the executor to
  re-confirm "the existing seven theme guards" — it should say "all theme guards" so a
  miscount does not silently skip one.
* `--app-overlay` (light `rgba(33,29,25,0.42)`, dark `rgba(10,9,8,0.62)`) is a translucent
  scrim whose composite depends on arbitrary page content; excluding it from a source-parsed
  matrix is correct. Worth one line in the table saying so, so a future reader does not
  think it was forgotten.
* The `--app-danger` / `--app-info` aliases resolve to `--app-error` / `--app-accent`
  respectively (`theme.css:190,194,243,247`), so covering the targets covers the aliases.
  `accentTextClosureGuard`-style transitive resolution would make that automatic rather than
  assumed — worth considering, not required.
