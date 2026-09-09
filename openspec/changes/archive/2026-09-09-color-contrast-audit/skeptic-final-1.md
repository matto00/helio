## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold spawn. Every conclusion below is derived from the diff, my own
recomputation of the matrix, my own mutations of the guard, my own source
and DOM enumerations, and my own screenshots of the running app. The
executor/evaluator reports were read only as claims.

### What I verified (with evidence)

**1. The whole contrast matrix, recomputed independently.** I wrote my own
parser + WCAG implementation (python, from scratch — not the guard's code)
over `frontend/src/theme/theme.css` at HEAD, scoring every text-capable
foreground against the five neutral surfaces and all three intent-tint
composites over every neutral parent, in both themes. Result: **zero
sub-4.5 cells except exactly three** — `--app-error` on
`--app-success-surface` over `--app-surface-strong` (4.47), on
`--app-warning-surface` over `--app-surface-raised` (4.42) and over
`--app-surface-strong` (4.24). That reproduces the shipped claim exactly.

**2. `docs/contrast-audit.md`'s numbers, sampled independently.** light
muted on `--app-surface-soft` 5.43 ✓; light `--app-text` on soft 14.20 ✓;
light error-on-own-tint over soft 4.62 ✓; dark error-on-own-tint over
`--app-surface-strong` 4.63 ✓ and 4.46 pre-edit ✓; dark muted on warning
tint over strong 4.64 ✓; light warning-on-own-tint over soft pre-edit 3.78 ✓;
muted-vs-text separation 2.61 light / 2.15 dark ✓. Every sampled figure is
correct as of this commit. The cycle-1 wrongness is genuinely fixed.

**3. Base-branch comparison (did the change help or just move things?).**
Recomputed the same matrix at `aea1e0cf`: the dark theme had **12** sub-AA
cells (incl. `--app-error` on its OWN tint over `--app-surface-strong` at
4.46 — the design's "dark intent tokens measure comfortably above AA"
premise was indeed false), and light had the intent-on-own-tint cells at
3.71–3.82. Post-change: 0 in light, 3 in dark, and **all three residual
cells improved** (4.45→4.47, 4.22→4.42, 4.05→4.24; a fourth, 4.27, left the
sub-AA set entirely). The change is a strict improvement everywhere; it
creates no new sub-AA cell.

**4. The "never renders" cross-intent exception — re-run, not accepted.**
Two independent enumerations, both mine:
- *Source, exhaustive (wider than the doc's 11 cited files):* I extracted
  **all 42** CSS rules in `frontend/src` that set a background to an
  intent tint and paired each with the `color` in force. Every one is
  same-intent, or sets no color and inherits `--app-text`/the same
  intent from its base rule (checked `InlineError.css`,
  `ToolCallIndicator.css`, `MessageTurn.css`, `ActionsMenu.css`,
  `Modal.css`, `IconButton.css`, `ConfirmInline.css` individually). No
  cross-intent pairing exists in the design language.
- *DOM, on the running app:* a computed-style probe walking each
  intent-colored element's ancestor chain, accumulating alpha, and
  classifying the resolved tint backdrop. **cross = 0**, with a working
  positive control (`same = 2` detected on the same page), so the zero is
  not a vacuous probe.
Verdict: this is a justified exception in AC1's sense, not a gap wearing a
justification. It is a composition the app does not build, the cells are
dark-theme only, marginal (4.24–4.47 vs 4.5), *pre-existing*, and *improved*
by this change. Unlike HEL-444's failed claims, the enumeration is stated
concretely enough that I re-ran it and reached the same answer.

**5. Guard soundness — my own mutation battery** (not the evaluator's):
- Revert light `--app-error` to `#c73a2a` → RED (light matrix + negative control).
- *Improvement* (dark muted → `#cfc9c1`) → stays GREEN. Correctly does not punish improvement (the cycle-1 inverted `some(ratio < 4.5)` assertion is genuinely gone; the replacement is a count-coverage assertion).
- Break the tint parse (`11%` → `11.0%`) → 7 tests RED including the vacuity test. Fails loudly on parse breakage; does not pass over an empty set.
- Delete a foreground declaration → RED.
- **Invert `buildAccentTokens`' ink pick in `appearance.ts`** → the accent-ink floor test goes RED. The ink assertion binds to the real function, not a reimplementation (evaluator CR3 genuinely discharged).
Guard is failable, non-vacuous, and correctly signed.

**6. Gates, re-run by me:** `npm run lint` clean, `npm run typecheck` clean,
full `npx jest` **299 suites / 3141 tests, all passing**;
`tokenContrastGuard.css.test.ts` 11/11. `git check-ignore` returns
not-ignored and `git ls-files` confirms `docs/contrast-audit.md` is tracked
(HEL-444's gitignore loss is not repeated).

**7. Tracking reference is real.** Fetched HEL-1061 from Linear — it exists,
Backlog, correctly scoped to the accent-on-surface shortfall and the
`--app-accent-mid` residual. Not a dangling pointer.

**8. Running app, both themes, self-authenticated.** Servers via
`start-servers.sh` (5965/8872); confirmed the dev server serves the BRANCH
token values (`curl` of `/src/theme/theme.css`), so no stale-server trap.
Toggled to light via the Settings control, navigated fresh, waited to
settle, and asserted `data-theme` + resolved token values at measurement
time before trusting any reading (dark: `--app-error #f17b67`, muted
`#aaa49c`; light: `--app-success #166d43`, muted `#645e56`).
Screenshots read: dashboards (dark), settings (dark), pipeline list
(dark + light, incl. element-level zoom of the status row), pipeline detail
(light).
*Design judgement:* the intent colours still read as their intents — the
"Succeeded" chip is unmistakably green, "Failed" unmistakably red, the
"⚠ Partial" warning still reads as amber/ochre rather than as brown-black
in light theme, and each chip's tinted lozenge still reads as tinted rather
than neutral. Muted text still reads as a clear step below `--app-text` in
both themes (2.61 / 2.15 measured; visually distinct in the screenshots, and
dark muted is not so light that it competes with body text). Sibling
screens are consistent; no off-pattern one-off, no hardcoded colour, no
token bypass in the diff (the diff is 4 token values + comments). Only
console error observed is a pre-existing unrelated `404
/api/pipelines/:id/schedule` for a pipeline with no schedule.

**9. AC trace.**
- **AC1** — table exists at a tracked path, both themes, ratio + threshold +
  verdict per pair, exceptions enumerated. Every asserted pair clears AA; the
  three residual cells are justified exceptions I independently re-validated. **Met**, subject to CR1 below.
- **AC2** — invariants preserved: no tint percentage, opacity, or surface
  token changed (diff touches only 4 foreground hexes); Toggle's
  background use of muted improves (4.87→5.43 / 6.08→7.38); visually
  coherent on the running app. **Met.**
- **AC3** — accent-ink floor asserted over all 8 presets × 2 themes against
  the real `buildAccentTokens` (mutation-proven), and accent-on-surface
  measured and published with an explicit FAIL verdict + real tracking
  ticket. AC3 says "verified", and it is. **Met.**
- **AC4** — guard runs inside the existing `frontend` job's `npm test`
  (no new script/husky line/CI job), failable per my own mutations. **Met.**

**10. Was the dark `--app-error` change legitimate?** Yes — good catch, not
scope creep. I confirmed the base value measured **4.46** on its own tint
over `--app-surface-strong`, i.e. the design's own Non-Goal premise was
factually false, and the ticket's Scope says to fix failing pairs. It is a
4% lightness step, disclosed in the `theme.css` comment, in the table, and
in the commit body. Exactly the "measurement falsifies the plan → correct
the plan" behaviour this workflow wants.

### Verdict: REFUTE

Everything above is CONFIRM-quality. The single blocker is narrow and
documentary — but it lands in `DESIGN.md`, which this repo treats as
binding, and it is the *same false claim* the evaluator already forced out
of `docs/contrast-audit.md`, surviving in the file a contributor is more
likely to read.

### Change Requests

1. **`DESIGN.md:104-109` asserts the table is generated; it is not, and the
   file it points at says so.** DESIGN.md currently reads: the audit "is a
   committed artifact: `docs/contrast-audit.md`, **generated by the same
   parse-and-compute logic as** `frontend/src/theme/tokenContrastGuard.css.test.ts`".
   `docs/contrast-audit.md:3-16` retracts precisely this: "no emitter
   exists, the numbers below were hand-transcribed... It CAN drift if a
   future token edit changes `theme.css` without this file being
   regenerated." I confirmed by search that **no emitter exists anywhere**
   (no npm script, no `scripts/` entry, no non-test producer of
   `contrast-audit`). A maintainer reading the binding standard will
   conclude the table self-maintains and will not update it — which is
   exactly the drift the audit doc warns about, and the same
   confidently-false-documentation failure cycle 1 already shipped once.
   Fix either way, but fix it: (a) correct DESIGN.md's wording to match the
   audit doc's honest status and point at its "How to regenerate" recipe,
   or (b) build the emitter the claim describes. (a) is sufficient for this
   ticket; I am not requiring the emitter.

2. **Make the change record honest about the same thing.**
   `openspec/changes/color-contrast-audit/tasks.md` 5.1 is ticked `[x]`
   ("Emit the contrast table from the same computation the guard uses, so
   the two cannot disagree"), and `design.md` D7 still states "It is emitted
   by the same computation the guard uses, so the two cannot disagree; a
   hand-maintained table would rot on the first token edit." Neither is what
   shipped. Annotate D7 (and 5.1) with the deviation and the reason it was
   accepted — a hand-transcribed table whose numbers are guard-verified —
   rather than leaving an artifact that describes work that was not done.
   (No spec change needed: the spec delta's "committed artifact" requirement
   is worded honestly and IS satisfied.)

### Non-blocking notes

- The hand-maintained table is acceptable *as AC1's artifact* — it is
  tracked, correct today (I verified the whole matrix and eight sampled
  cells), and the accessibility guarantee is carried by the guard, not by
  the doc. The residual risk is one-directional and cosmetic: a future
  *improving* token edit leaves the doc's numbers stale silently. Worth a
  small follow-up to add the emitter as a real `it()` that writes the file
  (or a `--update` script), but not worth blocking this ticket.
- `docs/contrast-audit.md` §4 cites 11 CSS files as the source enumeration;
  there are in fact **27 files / 42 rules** with intent-tint backgrounds. I
  checked all 42 and the conclusion holds, but the doc's phrasing ("see
  ...") reads like a complete list. Consider stating the count and the
  reproducible grep instead of a sample.
- Shipping rather than closing as already-satisfied was the right call:
  AC1 was genuinely unmet (no committed table anywhere), and the audit
  found 12 dark + 5 light real sub-AA cells that no prior sibling ticket
  covered, plus an unasserted accent-ink floor. The rescoping was honest.
