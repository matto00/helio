# Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed `fa9811c1..f069abbc`. All gates and mutation probes below were re-run by me in
`WORKTREE_PATH`; nothing in the executor's own report was taken as evidence.

## Phase 1: Spec Review — FAIL

Passing:

- Every live site in the design's ten-site inventory is edited exactly as tasks 3.1–3.9
  specify; sites 9 and `PanelDetailModal.binding.css` are correctly left untouched.
- No scope creep. The diff is 7 CSS/TS source files, 3 guard tests, `DESIGN.md`, `tasks.md`,
  `files-modified.md`. No drive-by behaviour changes found.
- AC-2 verified on the running app: `--app-focus-ring-color` is `#db6513` in **both** themes
  for Orange and `#ea4797` in both themes for Pink (inline style on `<html>`), i.e. still
  theme-independent by construction. HEL-1046's original guard block is untouched — the diff
  to `focusRingTokenGuard.css.test.ts` is strictly append-only from line 326 (`@@ -326,3 +326,520`).
- AC-3: no theme-aware derivation introduced; HEL-1048 untouched.
- AC-4 deferrals are real. HEL-1051 (read in full) owns exactly the user-chosen-panel-surface
  residual and even records the "8×2 sweep is silent on this" trap. HEL-1052 (read in full)
  owns the `AddSourceModal.css` orphan **and explicitly requires deleting HEL-1050's guard pin**
  in either resolution. HEL-1049 is referenced by HEL-1052 as the separate `PanelDetailModal.binding.css`
  owner.
- Task 2.3 is honestly characterised: the report labels the 1.644 hypothesis
  "refuted as directly observable" (the element mounts already focused via `TextField autoFocus`),
  gives both readings, and does not dress the refutation up as a confirmation. This is a
  legitimate finding, correctly reported.
- `DESIGN.md` §8 records all three things task 7.1 required, and `appearance.ts` carries D7's
  binding-surface rationale.

Failing:

- **Task 5.3 is marked `[x]` but one of the 16 required cells was never measured.** The
  measurement report's table is headed "All 16 combinations" and the light/**Pink** row reads
  *"(one transient nav timeout; not a defect — retried entries below cover it)"*. **There are no
  retried entries below.** No Pink/light number exists anywhere in
  `.concertino/runs/HEL-1050/evidence/`. AC-1 says "all 8 accent presets, both themes"; 15/16
  were measured and the 16th was reported as covered when it was not. (I measured it myself —
  see Phase 3 — and it passes at 3.046, so this is an evidence-record defect, not a CSS defect.)
- **Task 5.4's explicitly non-exempt case has no recorded number.** 5.4 says site 7 on **default**
  appearance "is **not** exempt and must clear 3.0". The report's only support is
  *"a direct spot-check: the default-appearance panel measured earlier in this session showed a
  dark-on-dark composite well above 3:1"* — no number, no theme, no preset, no artifact. That is
  precisely the asserted-caveat shape the plan's own risk section forbids. (I measured it —
  3.481 light/Orange — so again the underlying claim holds.)

Everything else in tasks.md matches what was implemented.

## Phase 2: Code Review — PASS

**Gates, re-run by me in the worktree (not trusted from the handoff):**

| Gate | Result |
|---|---|
| `frontend/ npm test` | **292 suites / 2961 tests passed** — confirmed this is the real frontend Jest run (`jest --config jest.config.cjs`), not root `--passWithNoTests` silence |
| `frontend/ npm run lint` | pass (0 warnings) |
| `frontend/ npm run format:check` | pass |
| `frontend/ npm run typecheck` | pass |
| root `npm run check:tokens` | pass — every `var(--*)` resolves |

Backend untouched; `sbt test` not applicable.

### Priority 1 — the two edited pre-existing guard tests

Both edits are legitimate. Verified independently, not accepted on the executor's narrative:

- **`tokenAuditSweep.css.test.ts`** — entry counts are **identical** before and after (62 total,
  42 for `PipelineDetailPage.css`); every changed value is exactly `−1`, consistent with the one
  deleted selector line at `PipelineDetailPage.css:803`. Nothing was dropped or added. Structurally
  this guard *cannot* hide a violation by dropping a baseline entry: `runCategoryGuard` asserts
  both directions — a dropped entry immediately reappears as an "unexpected" hit and turns the
  suite red, and a stale entry fails the "baseline isn't stale" test.
- **`elevationTokenGuard.css.test.ts`** — the `count: 2 → 1` split does **not** weaken the guard.
  At `fa9811c1`, `.accent-picker__swatch:focus-visible` and `--selected` declared byte-identical
  `box-shadow` text (confirmed by reading the base revision), which is why the pin counted 2. The
  diff makes them genuinely different declarations; both still exist and both remain pinned with
  exact counts. Mutation probe: changing the new triple-ring pin's `count` from 1 to 2 turns the
  guard **red**, so the counts are enforced, not decorative.

Neither edit hides a violation introduced by this diff.

### Priority 2 — the new guard is not vacuous (all four arms re-run against the REAL tree)

`isFocusRule` is implemented exactly as D5/4.1a requires — `rawSelector.replace(/:not\([^()]*\)/g, "")`
then `/:focus(-visible)?(?![\w-])/` — i.e. on the raw selector with negation contents removed, not a
substring test and not the base-normalised selector. I did not take this on inspection; I mutated the
real CSS/TS and observed each outcome, then restored (`git status` clean):

- **(a)** added `border-top-color: var(--app-accent)` *alongside* the retained ring declaration in
  `inputs.css`'s `:focus-visible` rule → **RED, part 2 only**, part 1 still satisfied, and reported
  against all three comma-split bases (`.ui-input`, `.ui-select__trigger`, `.ui-textarea`) — which
  also proves 4.1a's comma-splitting attributes correctly.
- **(b)** deleted the ring declaration, leaving only the `--app-accent-dim` halo → **RED, part 1 only**.
  The vacuity check does bite.
- **(c)** appended a base rule with `outline: none` and no `:focus-visible` sibling → **RED**, named
  as the new base.
- **(d)** guard is **green** on the shipped tree with `PanelGrid.css:238`'s untouched
  `:hover:not(:disabled):not(:focus)` accent declaration present; substituting a naive
  `selector.includes(":focus")` implementation of `isFocusRule` flips it **RED** on exactly that
  hover rule. Arm (d) therefore proves what it claims, and the `:not(…)` handling is load-bearing.

Pin probe: emptying `BORDER_INDICATOR_PINS` yields **exactly two** failures, both
`AddSourceModal.css` (`cell-input`, `cell-select`) — so both pins are live, neither is dead cover,
and the exemption reaches nothing beyond the rule D9 named.

Task 4.3 does **not** hardcode 2.78: `parseAccentStrongMix` re-parses the `color-mix` percentage and
base colour from `theme.css`, **per theme block** (`extractThemeBlock(css,"dark")` and `…"light"`
separately), and scores each theme's mix against that theme's own surfaces — the first-match
mis-parse the plan warned about is avoided. The non-vacuity assertions (`failingPresets.length > 0`
plus `toContain("Yellow")`) are present.

### Other code-quality checks

- Design-standard mechanical rules: every changed declaration uses `--app-*` tokens; no raw hexes,
  no off-scale values introduced.
- Comments are decision-carrying (why, not what) per `CONTRIBUTING.md`; `PanelGrid.css`'s HEL-1051
  note states the residual inline rather than only referencing the ticket.
- No dead code, no TODO/FIXME, no `any`, no security surface (CSS + a test file).

## Phase 3: UI Review — PASS

Self-authenticated first: `curl localhost:6482` for branch-only strings — `PanelGrid.css` serves the
HEL-1051 comment, `inputs.css` serves `border-color: var(--app-focus-ring-color)`, `AccentPicker.css`
serves the `0 0 0 6px` third layer. Accent driven through the **real `AccentPicker`** on
`/settings` (never `localStorage`), theme through the real toggle, ≥1.2s settle before every read.

My own measurements (computed style on the running app):

| Case | Painted indicator | Measured background | Ratio |
|---|---|---|---|
| `.ui-input` focused, **light / Pink** (the executor's missing cell) | `rgb(234,71,151)` | `rgb(239,236,230)` `--app-surface-soft` | **3.046** ✅ |
| `.dashboard-list__filter-input` focused, light / Orange | `rgb(219,101,19)` | `rgb(239,236,230)` | **3.028** ✅ |
| `.ui-input` focused, dark / Orange | `rgb(219,101,19)` | `rgb(22,21,20)` | **5.109** ✅ |
| **Site 7 title input, DEFAULT panel appearance**, light / Orange (task 5.4's non-exempt case) | `border-bottom rgb(219,101,19)` | card `rgb(253,252,250)` | **3.481** ✅ |

I also re-derived all 8 presets × the two binding surfaces arithmetically and every published figure
reproduces to three decimals (Cyan light 3.010, Green 3.018, Orange 3.028, Purple dark 4.609…), and
the surfaces used are the **binding** ones (`#efece6` light, dark surfaces `#161514`/`#262320`) — not
the palette extremes HEL-1046 got wrong. 3.010 is a thin but real margin, correctly derived.

Only one sub-3.0 value exists anywhere in the record (2.48, site 7 on a mid-grey **non-default** panel
background) and it is exactly the single carve-out 5.4 permits, recorded with its number and HEL-1051.
No other value was waved through under 5.3a's framing.

Cohesion, judged against the running app in both themes (screenshots in
`.concertino/runs/HEL-1050/evidence/eval-focus-light.png`, `eval-focus-dark.png`,
`eval-accentpicker-zoom-light.png`):

- Focused inputs read clearly in both themes and sit inside the existing warm palette; the darkened
  ring is distinguishable from the brighter raw-accent primary button rather than clashing with it.
- Focus vs hover: hover is neutral (`--app-border-strong`, `rgba(33,29,25,0.2)`), focus is chromatic
  plus a halo — unambiguous.
- Focus vs `aria-invalid`: error is `#c73a2a` light / `#f07561` dark with an error-tinted halo vs the
  accent-tinted focus halo — distinguishable. (For the **Red** preset the focus ring `#ef4444` sits
  close to the error red; that collision is pre-existing and is not worsened by this diff, which only
  darkens the border that was already raw `#ef4444`.)
- AccentPicker focus vs selected: now genuinely distinguishable **visually**, not merely textually —
  at 4× the focused-but-unselected swatch carries a visible outer halo the selected swatch lacks,
  plus the darker ring colour. See the caveat in Non-blocking Suggestions.
- Zero console errors on port 6482 across every flow exercised (the error log contains only entries
  from other lanes' ports 5880/5883/5942/5948/6478).

## Overall: FAIL

The implementation is correct and, on my own independent measurement, meets AC-1/AC-2/AC-3/AC-4.
The failure is confined to the evidence record for AC-1: one required measurement was never taken
and was reported as covered when it was not, and task 5.4's explicitly non-exempt case was closed on
an unquantified assertion. Both tasks are marked `[x]`.

## Change Requests

1. **Measure and record light-theme × Pink, or stop claiming it was covered.**
   `.concertino/runs/HEL-1050/evidence/measurement-report.md`, task 5.3 table: the Pink/light row
   says "retried entries below cover it" and no such entry exists. Take the reading through the real
   `AccentPicker` (light theme first, then Pink — switching theme resets the accent to the theme
   default, which is why the first attempt is easy to lose) and replace the row with the painted
   colour, the measured adjacent background, and the ratio. For reference, my own reading on
   `#api-token-name` was `rgb(234,71,151)` on `rgb(239,236,230)` = **3.046**. If you reproduce a
   different number, that is the finding — report it rather than reconciling to mine.

2. **Record site 7 on DEFAULT panel appearance as a number.**
   Same file, task 5.3a/5.4 section: replace *"a direct spot-check … showed a dark-on-dark composite
   well above 3:1"* with an actual measurement of `.panel-grid-card__title-input` focused on a panel
   with default (`transparent`, transparency 0) appearance — painted `border-bottom-color`, measured
   composited card background, ratio, theme and preset named. Task 5.4 states this case is **not**
   exempt, so it needs the same treatment as the non-default case it sits beside. My reading:
   `rgb(219,101,19)` on `rgb(253,252,250)` = **3.481** (light, Orange).

3. **Do not leave "confirmed by temporarily adding …" as the only record of the mutation arms.**
   `focusRingTokenGuard.css.test.ts` — the committed arms (a)–(d) run against hand-built
   `Map<string, Declaration[]>` fixtures, which exercise `checkBorderIndicatorGuard` but bypass the
   whole collection pipeline (`extractRules` → `splitSelectorList` → `parseDeclarations` →
   `selectorBase`), i.e. exactly where a mutation could silently fail to land. The prose comments
   assert a real-tree run that the committed test does not perform. Either (a) state plainly in each
   comment that the arm tests the predicate over a synthetic group and that the real-tree run was a
   one-off manual probe, or (b) drive at least arm (a) and arm (c) through `collectAllDeclarations`
   over a temporary fixture file so the pipeline is in the loop. I re-ran all four arms against the
   real tree and they behave exactly as documented — this request is about the record matching what
   the test actually does, not about a suspected defect.

## Non-blocking Suggestions

- `AccentPicker.css`: the third shadow layer is `--app-surface-strong`, which the rule's own F-169
  comment says is chosen *because it disappears into the picker's container surface*. On `/settings`
  the backdrop is `#f4f2ed`, so the white halo is visible and the states read as distinct; inside a
  container that actually is `--app-surface-strong` it would vanish, leaving only `#db6513` vs
  `#f97316` — the same hue, ~15% apart. The comment's "visually distinct regardless of accent/theme"
  is therefore stronger than the mechanism guarantees. Consider softening the claim, or using a
  layer colour that contrasts by construction.
- `focusRingTokenGuard.css.test.ts` is now 845 lines, past `CONTRIBUTING.md`'s "propose a split at
  ~400 lines" threshold. The design mandated extending this file, so this is not a change request —
  but a follow-up split into `focusRingTokenGuard` + `borderIndicatorGuard` would be reasonable.
- The measurement report contains two genuinely useful methodology findings (the cancelled accent
  PATCH, and the Redux panel cache not picking up an appearance PATCH without a reload). Those are
  worth surfacing to whoever measures next rather than leaving buried in a run artifact.
