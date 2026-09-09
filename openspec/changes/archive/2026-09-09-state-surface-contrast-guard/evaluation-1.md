# Evaluation Report — Cycle 1 (evaluation-1.md)

**Commit reviewed: `70321a3e8e01fc6aa5504e5ba5c9df9ea1cdb8a4`** ("HEL-866 Add a rendered,
CI-gated state-surface contrast guard and remediate the raised/strong collision"),
branch `bug/state-surface-contrast-collision/HEL-866`, diffed against `main`
(`fcce99b1`). All findings below are against that SHA; a later commit is unreviewed.

## Phase 1: Spec Review — FAIL

Verified:

- **AC3 / AC5 threshold semantics — PASS, and proven.** The guard is a contrast test,
  not an inequality test. Mutating the real remediated call site
  `frontend/src/features/commandPalette/ui/CommandPalette.css:85`
  (`--app-surface-soft` → `--app-surface-raised`) took the guard **GREEN → RED**,
  naming the element, theme and ratio:
  `[dark] command-palette :: button[role=option] "Go to Dashboards" (#2) (hover) — ratio=1.0399164062108592`
  and `[light] … ratio=1`. 40 failures raised; mutation reverted afterwards
  (`git checkout` confirmed the file is back to `--app-surface-soft`). The exact
  `#232019` on `#262320` = 1.040 pair the ticket names does fail.
- **AC4 — PASS.** D5 records the dedicated-token recommendation and the explicit
  decision not to adopt, with reasoning and escalation history.
- **theme.css constraint — PASS.** `git diff main...HEAD -- frontend/src/theme/theme.css`
  is empty (0 lines). No value changed.
- **Remediation is state-only — PASS, mechanically re-verified, not taken on trust.**
  I parsed every changed CSS file's pre- and post-image into rules and listed every
  rule that newly gains `--app-surface-soft` whose selector is not a state selector
  (`:hover|:focus|:active|.active|selected|checked|[open]|data-active|aria-*`).
  Exactly **one** rule came back (see CR4). 73 `--app-surface-raised` lines removed,
  8 resting uses left in place. The executor's claim holds.
- **AC2 "complete sweep" — FAIL.** See CR1: the rendered guard's per-view population
  is truncated positionally and is dominated by shared chrome, so the population the
  sweep rests on is far smaller than the run's headline counts suggest.
- **AC5 "input set enumerated mechanically" — PARTIAL.** The selector
  (`stateContrastProbe.ts:12`) is genuinely mechanical: no file list, no component
  list. But CR1's positional cap and CR5's ordinal-keyed exemptions reintroduce
  hand-shaped selection at the edges.

## Phase 2: Code Review — FAIL

Gates re-run by me, fresh, in `WORKTREE_PATH` (`CLEAN_WORKTREE` not set):

| gate | result |
|---|---|
| `npm run lint` | PASS (0 warnings) |
| `npm run format:check` | PASS |
| `npm test` (root jest + frontend jest) | PASS — 295 suites / 3105 tests |
| `npm --prefix frontend run build` | PASS |
| `npm run check:e2e-types` | PASS |
| `npm run check:state-contrast:selftest` | PASS — 30 passed, 0 failed |
| `DEV_PORT=6298 npx playwright test e2e/state-surface-contrast-guard.spec.ts` | PASS — 348 probed, resolved=346, unresolved=2, pass=186, fail=8 (all exempted), advisory=152 |

No backend files changed; `sbt test` not applicable.

**Alpha compositing is genuinely correct, not merely present** (the specific
false-pass mode I was asked to disprove):

- `stateContrast.mjs`'s `compositeStack` folds farthest-layer-first through
  `compositeOver`, so a chain of translucent layers accumulates correctly.
- The ancestor walk (`state-surface-contrast-guard.spec.ts:89-116`) pushes **every**
  layer with alpha > 0 and only terminates on an `rgb(` (opaque) serialization — it
  does **not** stop at the first non-transparent ancestor.
- `classifyState` throws if handed a non-opaque colour, so an uncomposited comparison
  cannot silently score.
- `parseColor` handles `color(srgb …)` (the `color-mix()` serialization used by
  `--app-accent-surface`/`--app-accent-dim`) and refuses `oklab(…)` mid-transition
  reads rather than guessing.
- The self-test's "passes naively but fails once correctly composited" case is the
  right decisive case and is green.

Issues — see Change Requests CR1, CR2, CR3, CR5.

## Phase 3: UI Review — PASS (with CR4 noted below)

Rendered against the running app at `http://localhost:6298` (page identity
re-checked before every reading), **both themes**, screenshots in
`.concertino/runs/HEL-866/evidence/`:

- `.app-command-bar__logo:hover`, dark — measured live: logo `rgb(38,35,32)` on bar
  `rgb(26,24,22)` (ratio 1.133). Visible, restrained, reads as chrome.
  (`eval-dark-logo-hover.png`, `eval-dark-logo-hover-zoom.png`)
- `.app-sidebar__nav-link.active:hover` (`--app-accent-mid`) — the riskiest new
  behaviour. In **both** themes it reads as a clear, on-brand step up from the
  resting `--app-accent-dim` active state; it does not introduce a new visual
  dialect. (`eval-dark-sidebar-activehover.png`, `eval-light-sidebar-activehover.png`)
- Modal-hosted state (AC1): `Cancel` in the AddSourceModal footer shows a clearly
  visible fill in light (soft on white) **and** in dark (soft on strong).
  (`eval-light-modal-cancel-hover.png`, `eval-dark-modal-cancel-hover.png`)
- Command palette row hover, light — visible (the HEL-496 exemplar, unregressed).
  (`eval-light-palette-hover.png`)
- No console errors observed during any of these flows; no layout breakage.
- Note: `.add-source-modal__btn--secondary` ("Test connection") reads transparent on
  hover — correct, the rule is `:hover:not(:disabled)` and the button is disabled.
  Not a defect.

Subjective visual-cohesion judgment is deferred to the skeptic; nothing I rendered
looked off in either theme.

## Overall: FAIL

## Change Requests

1. **The guard's per-view population collapses to shared chrome — this is the
   design's own named Risk ("the walk under-collects… the original defect relocated
   into the guard") realised, and AC2's "complete" rests on it.**
   `state-surface-contrast-guard.spec.ts:45` caps a view at
   `MAX_ELEMENTS_PER_VIEW = 12`, and `collectCandidates` (line 191) takes
   `handles.slice(0, cap)` — the **first 12 in DOM order**, before the visibility
   filter. Measured live on `/settings`: the first 12 matches are
   `app-skip-link` (not even visible), `app-command-bar__logo`, two command-bar
   icon buttons, `user-menu__trigger`, five `app-sidebar__nav-link`s — **ten shared
   chrome elements identical on every route** — and only then the two
   `accent-picker__swatch` buttons. `/settings` has **45 visible interactive
   elements, 36 of them inside `<main>`; the guard measures 2 of those 36 (5.5%)**.
   Across the six routes the guard therefore re-measures the same chrome six times
   and sees ~2 page-specific elements per route. The 348/186-pass headline reads as
   coverage it does not have.
   Fix: scope route probes to the page content (e.g. `page.locator("main")`) so the
   chrome is measured once as its own view, and/or sample across the matched set
   rather than slicing the first N; then print **per-view unique element counts**
   (task 5.2a) so a collapse is visible in the log. Re-state AC2's scope against
   the corrected numbers.

2. **`check:state-contrast:selftest` is wired into nothing — the guard's mutation
   proof is itself ungated.** `package.json:31` adds the script, but neither
   `.github/workflows/ci.yml` nor `.husky/pre-commit` was touched
   (`git diff main...HEAD -- .husky/` is empty; ci.yml is not in the diff). This
   repo has fixed exactly this defect four times, and ci.yml says so in its own
   comments (HEL-913, HEL-846, HEL-1037, HEL-996: "existed as runnable npm scripts,
   wired only into…"). The rendered spec *is* gated (CI runs `npx playwright test`
   by glob), so the commit message's "CI-gated" is true of the spec and false of
   the self-test. Fix: add `- run: npm run check:state-contrast:selftest` to
   ci.yml's checks job alongside `check:tokens:selftest`.

3. **`e2e/support/stateContrastProbe.ts` is dead code that documents behaviour
   nothing executes.** Only `INTERACTIVE_SELECTOR` is imported anywhere
   (grep across the repo). `collectBackdropLayers` (line 44), `probeElement`
   (line 85), `RawLayer` and `RawElementProbe` have zero consumers, and the spec
   re-implements both functions inline as `readBackdrop`/`readSnapshot`
   (`state-surface-contrast-guard.spec.ts:89`, `:118`). Two copies of the
   guard's most safety-critical logic, one of which carries the authoritative-looking
   design.md D4.2 commentary and never runs, is a divergence hazard for exactly the
   thing this ticket exists to keep honest. Fix: delete the unused exports (keep
   `INTERACTIVE_SELECTOR`), or have the spec `page.evaluate` these functions so
   there is one copy.

4. **`.pipeline-detail-page__step-card--expanded` is a drive-by swap that measurably
   *reduces* dark-theme distinction** —
   `frontend/src/features/pipelines/ui/PipelineDetailPage.css:256`,
   `--app-surface-raised` → `--app-surface-soft`. This is the single non-hover/focus
   rule in the whole 73-line sweep (mechanically confirmed as the only one). Against
   its real backdrop — the collapsed sibling card / `--app-surface` — dark theme goes
   from **1.089 to 1.030**; light goes 1.025 → 1.150. So the change helps light and
   hurts dark, on a rule that is not modal-hosted, not required by AC1, and
   structurally invisible to the guard (no before/during transition to observe).
   Fix: either revert this one line, or scope it as
   `:root[data-theme="dark"] .pipeline-detail-page__step-card--expanded { background: var(--app-surface-raised); }`
   the way App.css already does for the chrome backdrop — and say which, with the
   measurement, in the PR.

5. **Two of the three exemptions are keyed on DOM ordinal, not identity.**
   `state-surface-contrast-guard.spec.ts:445` matches
   `'button "" (#10)'` / `'button "" (#11)'` on `/settings`. I confirmed those
   ordinals *are* the two `accent-picker__swatch` buttons today and that the stated
   justification (hover feedback is `transform: scale(1.15)`) is genuine — but any
   future element added to the command bar, sidebar, or Settings header shifts the
   index and silently exempts a **different, unrelated** element. That is the
   curated-allowlist failure mode AC5 warns about, arriving by accident. Fix: key
   the exemption on a stable identity (class `accent-picker__swatch` / an
   `aria-label`), carried through `describeElement`.

## Non-blocking Suggestions

- `advisory=152` is 44% of all probes — the advisory bucket is now larger than the
  passing background bucket. The split is deliberate (D4a/D7) and I am not asking
  for it to be collapsed, but the PR should state the number and what it is mostly
  made of (largely focus states expressing themselves via outline), so "186 pass"
  is not read as "186 of 348 states verified, rest fine".
- The unresolved-fraction ceiling (`< 0.5`, line 469) is very loose against an
  observed 2/348. Consider tightening it toward the measured value so a regression
  in the ancestor walk actually trips it.
- `DESIGN.md`'s ramp guidance and the new guard now disagree in one place: soft
  clears 1.10 on `--app-surface-strong` but only 1.030 on `--app-surface` in dark,
  which is why App.css needed seven hand-scoped dark overrides. That backdrop-
  dependence deserves a sentence in DESIGN.md so the next call site does not
  rediscover it.
