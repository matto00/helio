## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `f563daab` (base `aea1e0cf`). All measurements below are my own
re-derivations from source and from the running app, not the executor's figures.

### Phase 1: Spec Review — FAIL

**AC2 (invariants/design language) — PASS.** No tint percentage changed
(11%/11%/10% light, 14% dark all intact); the diff is lightness-only on five
hex values. DESIGN.md §3 opacity invariants untouched.

**AC3 (accent) — PASS on measurement.** §6 ink-floor and §7 accent-on-surface
tables independently reproduce exactly (all 16 ink values and all 16 accent
minima match my computation to 2dp). D5's "measure, don't repaint" is honoured.

**AC4 (repeatable guard) — PASS.** See Phase 2.

**AC1 (documented contrast table) — FAIL.** The table is the ticket's headline
deliverable and four of its blocks are numerically wrong. Details in CR1.

**Task-list accuracy — PASS with one note.** Every task is ticked and every one
has real work behind it, including the expensive ones (2.3a parent resolution,
3.4c Toggle, 6.4 screenshots). Task 3.4b requires the `--app-text-muted` change
be called out in the PR body — that is a delivery-phase obligation, not yet
verifiable here; flagging so it is not lost.

**Scope — PASS.** No changes outside the ticket. The one out-of-plan change
(dark `--app-error`) is adjudicated in Phase 2 below and is a good catch, not
scope creep.

### Phase 2: Code Review — FAIL

#### Gates — all re-run by me in `WORKTREE_PATH`, all green

| gate | result |
| --- | --- |
| `npm run lint` | pass (`--max-warnings=0`) |
| `npm run typecheck` | pass |
| `npm run format:check` | pass |
| `npm test` (root) | 25 suites / 248 tests pass |
| `npm test` (frontend) | **299 suites / 3141 tests pass** — matches the executor's claim exactly |
| `src/theme/*` subset | 12 suites / 156 tests pass, incl. `themeParityGuard` and `accentTextSourceSyncGuard` |

`themeParityGuard` (29 tokens/block) and `accentTextSourceSyncGuard` both stay
green against the six changed token values.

#### Item 1 — the unplanned dark `--app-error` change: GOOD CATCH, not scope creep

Re-derived independently from `main`'s `theme.css`:

* `--app-error` `#f07561` on `--app-error-surface` (14%) over `--app-surface-strong`
  `#262320` = **4.460** with float compositing, **4.486** with 8-bit rounded
  compositing. Sub-4.5 either way. The executor's 4.46 is the float figure and is
  correct; the truer rendered value is 4.486. Both fail.
* Does it render as normal-size text? **Yes — I reproduced it by clicking the
  control**, not by reading the record. Signed out via the user menu, submitted
  `matt@helio.dev` + a wrong password at `/login`, and read `.auth-error`:
  `color: rgb(241,123,103)` (= `#f17b67`), `background-color:
  color(srgb 0.945 0.482 0.404 / 0.14)` (the 14% error tint), `font-size: 14px`,
  `font-weight: 400`. Normal-size text on its own tint, confirmed live.
* Is the new value sufficient? `#f17b67` clears **>= 4.63** against every neutral
  surface and its own tint composite over all five parents. Sufficient with margin.
* Visually sound? Verified on the running app in dark theme — the `Failed` chip
  still reads as red, distinct from `Succeeded` green, from the amber `Partial`,
  and from `--app-text`.

Verdict: a real defect that design.md's Non-Goals asserted did not exist, found
by the executor's own remeasurement and fixed minimally. This is the behaviour the
plan asked for.

#### Item 2 — full cross-product re-derivation (D10)

Own parser, own WCAG implementation, both themes, all text-capable foregrounds x
(5 neutral surfaces + 3 tints composited over each of the 5 neutral parents) =
200 cells, before and after:

* **Light theme: 0 sub-4.5 cells remain** (worst 4.60, `--app-error` on the
  success tint over `--app-surface-soft`). Every intended pair clears.
* **Dark theme: 3 sub-4.5 cells remain**, all cross-intent
  (`--app-error` on the success/warning tints over `-raised`/`-strong`; worst
  4.24). These are D10's documented-exception class — see item 3.
* **0 previously-passing cells regressed** in either theme.
* **0 already-failing cells degraded further** — the round-2 finding is satisfied,
  and in fact all three residual cells *improved* (4.29→4.49, 4.25→4.45,
  4.05→4.24) because the tint moves with its token, as the plan predicted.
* Thin-margin pairs from task 3.4 both improved: `--app-warning` on `--app-bg`
  4.56 → 5.67, `--app-error` on `--app-bg` 4.62 → 5.65.
* `--app-text-muted` remains a distinct step from `--app-text`: 2.61 light,
  2.15 dark.

#### Item 3 — "never renders" enumerations re-run independently

I did not accept the conclusion. I re-ran it two ways, one of them a method the
executor did not use:

1. **Running-app DOM walk (mine, different method).** For every element with a
   text node, resolved the *painted* backdrop by walking the ancestor chain and
   compositing accumulated alpha, then matched the resolved backdrop against every
   `tint x neutral-parent` composite to identify which tint it is. Ran over
   `/`, `/pipelines`, `/sources`, `/connectors`, `/settings`, `/settings/security`
   and the signed-out `/login`, in **both** themes. Result: **zero** cross-intent
   instances, and zero sub-4.5 normal-size-text instances, in either theme.
2. **Mechanical source sweep.** Parsed every declaration block in all 28 CSS files
   that reference an intent `-surface` (the doc cites 11 as examples; the full set
   is 28, and includes the `--app-danger-surface` alias). Zero blocks pair an
   intent tint background with a different intent's `color`. 16 blocks set a tint
   background with no `color` in the same block — I chased those (they inherit
   `--app-text-muted` or the same-intent token, e.g.
   `ToolCallIndicator.css:70-90`), and none is cross-intent.

The executor's "never renders" claim for the cross-intent cells **holds under
independent re-run**. This is the class of claim that failed three cycles on
HEL-444; here it survives.

The walk also surfaced positive evidence the doc does not cite, which
*strengthens* the light-theme fixes: `.ui-status-chip--error` ("Failed") and
`.ui-status-chip--success` ("Succeeded") render at **12px / weight 500** — normal
size — on their own tints over `--app-surface-soft`, i.e. exactly the 3.82 / 3.71
worst-case cells. Measured live post-change: **4.86** and **4.87**.

#### Item 4 — guard failability: PASS, verified by real on-disk mutation

I mutated the real `frontend/src/theme/theme.css` five times and re-ran the guard
each time (file restored after each; `git diff` clean at the end):

| mutation | result |
| --- | --- |
| light `--app-success` → `#1a7f4e` | RED — "Found 7 sub-AA light-theme pair(s)" |
| dark `--app-error` → `#f07561` | RED — "Found 1 sub-AA dark-theme pair(s)" |
| light `--app-text-muted` → `#6c655c` | RED — "Found 6 sub-AA light-theme pair(s)" |
| rename `--app-surface-soft` | THROWS "could not parse … as a literal hex" — no vacuous pass |
| tint `10%` → `10.0%` | THROWS "could not parse … as a color-mix(...) tint" — the percentage parse fails loudly rather than defaulting |

It parses the `color-mix` percentage and base token from source and resolves the
composite (`compositeMix`), rather than transcribing a precomputed hex. Vacuity
refusal pins 5/5/3 counts and asserts `percent > 0`.

**Mechanism**: no `package.json` script, no `.husky` line, no `.github` workflow
in the diff — the only changed files are the four listed plus openspec artifacts.
It runs inside the existing `frontend` job's `npm test`; I confirmed it executes
by name via `--runTestsByPath`.

#### Item 5 — `docs/contrast-audit.md`

Not gitignored (`git check-ignore` exit 1) and tracked (`git ls-files` confirms).
Covers the full cross-product including passing pairs, states the D9 boundary and
the residual. But its numbers are wrong in four places — CR1.

#### Code-quality / canonical-standard findings

CONTRIBUTING.md: no inline fully-qualified names, no `any`, no dead code, no
TODO/FIXME, imports clean. DESIGN.md [mechanical] rules: no raw colour literals
introduced outside `theme.css` (the guard's two hexes are test constants, one of
which is nonetheless a defect — CR3). File sizes within budget.

### Phase 3: UI Review — PASS

Servers: `start-servers.sh` reported both healthy on 5965 / 8872 (reused).

* **Theme self-authentication (settle trap handled).** Measured
  `data-theme` and the live computed token values at every reading. Dark reading:
  `--app-error #f17b67`, `--app-text-muted #aaa49c`. Light reading taken after a
  *fresh reload with light already in effect* plus a 3s settle:
  `--app-error #af3325`, `--app-success #166d43`, `--app-warning #85551a`,
  `--app-text-muted #645e56`, inline accent `#eab308` (the live seeded accent, not
  the dead `#ea580c` — the HEL-444/HEL-1048 misread did not occur).
* **Intent colours still read as their intent, both themes.** Screenshots of
  `/pipelines` in light and dark: `Succeeded` reads green, `Failed` reads red,
  `Partial` reads amber, all three mutually distinguishable and clearly distinct
  from `--app-text`. The darkened light-theme values are deeper but unmistakably
  chromatic, not "neutral dark text".
* **`--app-text-muted` still reads as a muted step.** Confirmed visually in both
  themes; measured 2.61 (light) / 2.15 (dark) from `--app-text`.
* **`Toggle.css:53` is the toggle *thumb*** (`.ui-toggle__thumb`, a 14px dot on a
  `--app-surface-soft` track), a non-text 3:1 boundary. Measured against its
  track: light **4.87 → 5.43**, dark **6.08 → 7.38**. Both move further from the
  surface; the 3:1 boundary is comfortably clear and improved. The checked state
  uses `--app-accent-ink`, untouched.
* Happy path, error path (`.auth-error`), empty/loading states walked; **zero
  console errors** across the whole session.
* Breakpoints 1440 / 1100 / 768 render without layout breakage. (The diff is
  colour-token-only; no layout property changed.)

### Overall: FAIL

The engineering is strong — the remediation is correct and complete against the
full matrix, the guard is genuinely failable, and the two hardest claims (the
unplanned dark `--app-error` finding and the cross-intent "never renders"
negative) both survive independent re-derivation. What fails is the committed
artifact that *is* AC1, plus three guard defects.

### Change Requests

1. **`docs/contrast-audit.md` — four blocks of numbers are wrong, and the header
   makes a claim the file cannot support.** The header says "Every number below is
   generated by the same parse-and-compute logic … this file cannot silently drift
   from the guard". No emitter exists; the numbers are hand-transcribed, and four
   blocks are already wrong at commit time — which is exactly the drift D7/task 5.1
   said was impossible. Fix the numbers **and** resolve the claim (either commit
   the emitter that D7 actually specifies, or reword to "transcribed from the
   guard's computation at `<sha>`" and stop claiming they cannot disagree):
   * **§1 dark theme, `--app-error` `#f17b67` row** reads `6.75 / 6.33 / 6.53 /
     5.80 / 5.58`. Correct values are **`6.98 / 6.55 / 6.75 / 6.01 / 5.78`**.
     (These match neither `#f07561` nor `#f17b67` — they are not a stale "before"
     row, they are simply wrong.)
   * **§2 dark theme, `--app-error` "after" column** reads `5.72 / 5.27 / 5.47 /
     4.80 / 4.63`. Correct: **`5.74 / 5.30 / 5.50 / 4.81 / 4.63`**.
   * **§3 dark theme, error-tint "after" column** reads `6.33 / 5.84 / 6.06 /
     5.32 / 5.11`. Correct: **`6.28 / 5.80 / 6.01 / 5.27 / 5.06`**.
   * **§4 dark cross-intent table is entirely pre-remediation values** presented
     as current, under a heading that says "cells that measure below 4.5:1".
     Listed `4.45 / 4.27 / 4.22 / 4.05`; post-change actuals are
     **`4.66 / 4.47 / 4.42 / 4.24`**. Consequently the first row
     (`--app-error` on `--app-success-surface` over `--app-surface-raised`,
     now **4.66**) no longer belongs in a sub-4.5 table at all — the correct
     post-change set is three cells, not four.

2. **`docs/contrast-audit.md` §7 — cite HEL-1061.** The accent-on-surface
   shortfall follow-up has now been filed as **HEL-1061**, so the "currently
   untracked" resolution of D5/task 5.2a is stale. Update all three places: the
   §7 "Tracking status: currently untracked" paragraph, the §7 prose about
   `DESIGN.md`'s identifier-less reference, and the §8 exceptions-table row
   ("currently untracked"). Cite it by identifier; D5's honesty requirement is now
   satisfied by a real ticket rather than by an admission.

3. **`frontend/src/theme/tokenContrastGuard.css.test.ts` (the `--app-accent-ink`
   floor block) — assert `buildAccentTokens`' output, not a reimplementation.**
   The block redeclares `READABLE_LIGHT` / `READABLE_DARK` and reimplements the
   max-pick in a local `pickInk`. The stated reason — "that module is
   browser-runtime code with no CSS parse step of its own" — is refuted by
   `accentTextSourceSyncGuard.css.test.ts:7`, which already imports
   `buildAccentTokens` in a Jest test in this same directory. As written, editing
   `appearance.ts:59-60` or the tie-break at `appearance.ts:585-590` leaves this
   guard green, which is the transcription drift D2 forbids and precisely what the
   spec's "Selecting the better of two candidate inks without asserting a floor
   SHALL NOT satisfy this requirement" is aimed at. Import `buildAccentTokens` and
   assert the floor on `buildAccentTokens(preset.hex, theme)["--app-accent-ink"]`
   for both themes.

4. **`frontend/src/theme/tokenContrastGuard.css.test.ts` — the cross-intent test
   asserts that a defect keeps existing.** The test
   `"re-derives at least one dark-theme cross-intent cell below 4.5:1"` asserts
   `cells.some((c) => c.ratio < TEXT_TARGET)`. A future change that lifts every
   cross-intent cell above 4.5 turns this test **red** — the guard would punish an
   improvement. Replace the failure-persistence assertion with a coverage
   assertion (e.g. pin `cells.length` to the expected 30 per theme), keeping the
   numbers derived for the table without pinning a shortfall in place.

5. **`frontend/src/theme/theme.css` (dark `--app-error` comment) — the claim is
   false as written.** The comment states `#f17b67` "clears >=4.63:1 against every
   neutral surface and every intent-tint composite in this theme." It measures
   **4.24** against `--app-warning-surface` over `--app-surface-strong` and 4.47
   against `--app-success-surface` over `--app-surface-strong`. The intended claim
   is about its *own* tint; scope the sentence to "its own intent-tint composite
   over every neutral parent" so the next maintainer is not misled by a
   confidently-wrong comment.

### Non-blocking Suggestions

* §5 "Rendered confirmation" says `.auth-error` "is the exact composition
  section 2's dark-theme `--app-error-surface` row measures". I measured that
  instance live: its resolved backdrop is the tint over **`--app-surface`**
  (5.30), not over `--app-surface-strong` — which is the 4.46 row that actually
  drove the token change. Sizing against the worst possible parent is correct and
  the fix stands, but the sentence claims an observation that was not made. Say
  the pair renders as normal-size text on its tint, and that the correction was
  sized against the worst parent that tint can composite over.
* §4's source enumeration cites 11 files; the full set matching an intent
  `-surface` is 28 (and `--app-danger-surface` is an alias worth naming). I swept
  all 28 and reached the same conclusion, so this is completeness of the recorded
  evidence, not a wrong answer.
* §2 light "before" for `--app-error` on its tint over `--app-surface-soft` reads
  3.82; design.md and tasks.md both say 3.81 (float vs 8-bit rounding). Harmless,
  but pick one convention and state it, since the whole table's third decimal
  depends on it.
* Task 3.4b's PR-body callout for the `--app-text-muted` change (it reopens
  F-049's deliberate tuning) is still owed at delivery.
