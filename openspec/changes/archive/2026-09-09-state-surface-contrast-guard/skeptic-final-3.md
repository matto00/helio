## Skeptic Report — final gate (round 3, skeptic-final-3.md)

HEAD `2a80acce`. Every number below is my own measurement, taken in the running
app at `http://localhost:6298` (`assert-phase.sh servers` → `PASS servers`) with
`location.href` + `data-theme` re-read immediately before every reading. Served
bundle self-authenticated: `curl http://localhost:6298/src/features/pipelines/ui/PipelineDetailPage.css`
returns this branch's `--step-card-hover-bg: var(--app-surface-soft)` on
`--expanded`, the new `.step-card-toggle:hover` rule, and `--app-accent-mid` on
`.add-tail-btn:hover` — i.e. I measured this diff, not a stale build.

I seeded my **own** fixture (a fresh static source → pipeline → `limit` step, via
the app's own API with the real CSRF header) rather than reusing the guard's, so
the readings below are independent of the guard harness.

### 1. Is the collision gone? — YES, in both themes, reproduced across page loads

`/pipelines/aa35049f-…`, step card **expanded**, elements really hovered
(Playwright `.hover()`, not a synthesized class):

| theme | element | hover bg | card bg (ancestor-walked) | identical | ratio |
| --- | --- | --- | --- | --- | --- |
| light | `…__step-card-duplicate-btn` | `rgb(239,236,230)` | `rgb(255,255,255)` | false | **1.179** |
| light | `…__step-card-drag-handle` | `rgb(239,236,230)` | `rgb(255,255,255)` | false | **1.179** |
| light | `…__step-card-toggle` (new rule) | `rgb(239,236,230)` | `rgb(255,255,255)` | false | **1.179** |
| dark | `…__step-card-drag-handle` | `rgb(22,21,20)` | `rgb(38,35,32)` | false | **1.167** |

`--step-card-hover-bg` resolves to `#efece6` in light on the expanded card and
`#161514` in dark. The round-2 finding (ratio 1.000, `identical: true`) is gone;
light now clears 1.10 with headroom and dark is unchanged at its prior 1.167.

Dark was measured after an **independent page load** (localStorage theme flip +
full navigation, helpers re-injected from scratch), and the card re-expanded from
its default collapsed state — so this is not the same DOM the light readings came
from.

Screenshots, looked at (not just captured):
- `.concertino/runs/HEL-866/evidence/skeptic3/light-expanded-draghandle-hover-1179.png`
  — a clearly visible grey rounded band under the hovered handle on the white card.
- `.../dark-expanded-draghandle-hover-1167.png` — the equivalent darker band; parity holds.

### 2. Did the split break the collapsed card? — NO (verified independently, not assumed)

Measured on the collapsed card, before expanding, in both themes:

- light: `…__step-card-duplicate-btn` hovered `rgb(239,236,230)` on `rgb(253,252,250)` = **1.1499**
- dark: same button hovered `rgb(38,35,32)` on `rgb(26,24,22)` = **1.1328**

Both match the values the commit claims (1.150 / 1.133) and both clear 1.10. The
base `.step-card` rule and its dark override are untouched by the split; the
cascade order (base first, `--expanded` after, equal specificity) is intact at
`PipelineDetailPage.css:290-321`.

### 3. Population gap — closed by option (a), and I proved it RED myself

The executor took (a), not (b): `e2e/state-surface-contrast-guard.spec.ts` now
seeds a real `limit` step (`POST /api/pipelines/:id/steps`, `expect(201)`) and,
on `/pipelines/:id`, asserts `toHaveCount(1)` on the expand toggle, clicks it,
and asserts the `--expanded` card exists — asserted, not `if (await count())`
-skipped, which is the silent-no-op shape CR8 already forbade.

**Mutation proof (mine).** I reverted exactly the fixed line back to
`--step-card-hover-bg: var(--app-surface-strong)` and re-ran the guard. GREEN → RED:

```
Error: HEL-866 guard: 3 state(s) failed the 1.1 contrast threshold:
  [light] /pipelines/1d220813-… :: button "Limit rows▾" [pipeline-detail-page__step-card-toggle] (#7) (hover) — ratio=1
  [light] … aria="Disable step" [pipeline-detail-page__step-card-toggle-enabled-btn] (#10) (hover) — ratio=1
  [light] … aria="Duplicate step" [pipeline-detail-page__step-card-duplicate-btn] (#11) (hover) — ratio=1
1 failed (4.1m)
```

That is the exact defect round 2 found, now caught by a gate instead of by a
reviewer. Mutation reverted (`git status --porcelain` empty), and the reverted
tree re-run **green** (`1 passed (4.1m)`). Both runs are mine, at this HEAD.

### 4. The "two more accent-alpha-inversion sites" — real, same defect class, not creep

Measured in the running app, dark:

- `--app-accent-dim` = `color-mix(#eab308 10%, transparent)`;
  `--app-accent-surface` = `15%`; `--app-accent-mid` = `30%`.
  The premise is true: the old hover alpha (10%) was **lower** than these
  buttons' own resting alpha (15%), so hovering literally reduced distinction.
- `.outputs-rail__add` hovered: composited `rgb(97,78,25)` vs its resting
  composite `rgb(67,57,28)` = **1.419** hover-vs-rest (and 1.944 vs the card
  backdrop). A real, correct-direction increase.
- `.pipeline-detail-page__add-tail-btn` hovered resolves to the 30% accent with
  `border-color: var(--app-accent)` — same shape as the already-fixed
  `.add-step-btn`, whose fix earlier cycles already accepted.

This is within AC1's remit (states with absent or inverted feedback), it was
surfaced by the population widening rather than sought out, it is two `:hover`
declarations touching no resting style, and the light-theme page renders normally
with it (`.../light-pipeline-detail-addtail-hover.png` — the hovered
"+ Add transformation step" chip reads distinctly stronger than the resting
"Branch"/"+ Output" chips, consistent with the accent language). **Not scope creep,
and no regression risk I can find.** Same for `.step-card-toggle:hover`, which
reuses the already-correct `--step-card-hover-bg` property rather than inventing a
value.

### 5. Nothing else regressed

- `git diff main...HEAD -- frontend/src/theme/theme.css` → **0 lines**. No new
  `--app-*` token anywhere under `frontend/src/theme/` in the diff.
- Resting styles: full-page light screenshot above shows the pipeline detail page,
  sidebar, footer and chips rendering normally in both themes; no console errors
  beyond the pre-existing one unrelated entry.
- Gates, all run by me at this HEAD, all green: `npm run lint` (0), `npm run typecheck` (0),
  `npm run format:check` ("All matched files use Prettier code style!"),
  `npm run check:e2e-types` (0), `npm run check:state-contrast:selftest`
  (**30 passed, 0 failed**), `npm test` (**295 suites / 3105 tests passed**),
  and the rendered guard green (above).
- CI wiring verified by reading `.github/workflows/ci.yml`: the browser-free
  selftest is a mandatory step, and the rendered guard is picked up by the `e2e`
  job's `npx playwright test` glob (line 379) and is not in `testIgnore`.

### 6. Acceptance criteria — final status

- **AC1 — MET.** Rendered, hovered, both themes, both card states: 1.179 / 1.167 /
  1.150 / 1.133, all `identical: false`, all above 1.10, with screenshots I looked at.
- **AC2 — MET as qualified.** The sweep result is recorded in `files-modified.md`
  with the coverage bound stated (routes + overlays + per-view cap, and the named
  excluded routes in design.md D6). Honest, not overclaimed.
- **AC3 — MET.** Dark is real, not merely non-identical (1.167 / 1.133 vs the
  ticket's rejected 1.04), and the guard's own selftest keeps `#232019` on
  `#262320` in the must-FAIL set.
- **AC4 — MET.** Recommendation recorded and adoption declined; `theme.css`
  diff is 0 lines.
- **AC5 — MET.** Guard is mechanically populated (partition assertion), threshold-
  based rather than an inequality, and I personally drove it green → red → green
  on the very rule this round fixed.

## Verdict: CONFIRM

The one open defect is closed and is now guarded by a gate I saw fail. Nothing I
found would ship a defect.

## Non-blocking notes

1. Round 2's CR2 asked for the residual bound to be recorded in `design.md` D6.2
   ("the guard probes default interaction states only; component sub-states not
   explicitly opened are unchecked"). `design.md` was not touched this cycle —
   the bound is described in `files-modified.md`'s cycle-5 section instead. The
   orchestrator's brief allowed (a) **or** (b) and (a) was done, so this is not
   blocking, but D6 is where a future reader will look. One sentence in D6 item 2
   would close it.
2. The sidebar-rail dark hover at **1.111** against a 1.10 threshold is a genuinely
   thin margin. It is named in `files-modified.md` rather than hidden — good — but
   it is the first thing that will go red on any future `.app-sidebar` background
   tweak.
3. The `--expanded` fix is a *third* instance of light's `raised == strong == #ffffff`
   biting. The `--app-state-hover` / `--app-state-selected` proposal (AC4, declined
   here) now has this cycle's measurement behind it too; worth attaching to the
   follow-up ticket.
4. The rendered guard takes ~4.1 minutes per run. Fine today, but it is the kind of
   cost that gets a gate quarantined later; worth watching as the route list grows.
