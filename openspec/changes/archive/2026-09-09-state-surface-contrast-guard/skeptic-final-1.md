# Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit reviewed: `a760e098`. Every number below was measured by me, in the running
app at `http://localhost:6298`, with `location.href` re-checked before each reading
(the shared tab WAS stolen once mid-session — caught and re-established).

## What I verified (with evidence)

### AC5 — the guard, and my own mutation proof: CONFIRMED, and it is genuinely good

- `npm run check:state-contrast:selftest` → **30 passed, 0 failed**, including the
  decisive `#232019` on `#262320` = 1.040 must-fail case.
- `e2e/support/stateContrast.mjs:CONTRAST_THRESHOLD = 1.1`, and `classifyState`
  applies `ratio >= threshold`, not an inequality. The dark 1.040 pair fails by
  construction.
- Guard re-run by me, fresh: **360 probed, resolved=360, unresolved=0, pass=148,
  fail=20 (all 20 exempted, 3 documented categories), advisory=192.** Green.
  Reproduces the evaluator's cycle-3 numbers exactly.
- **My own mutation, on a call site I chose (not the executor's or evaluator's).**
  I reverted `frontend/src/shared/ui/Modal.css:198` (`.ui-modal-btn--secondary:hover`)
  from `--app-surface-soft` back to `--app-surface-raised` and re-ran the guard.
  GREEN → RED, naming element, theme and ratio:

  ```
  [dark]  modal:add-source :: button "Cancel" [ui-modal-btn] (#13) (hover) — ratio=1.0399164062108592
  [light] modal:add-source :: button "Cancel" [ui-modal-btn] (#13) (hover) — ratio=1
  ```

  That dark 1.0399 IS the ticket's `#232019` on `#262320`. The guard fails it.
  Mutation reverted; `git checkout` confirmed clean. **AC5 is met.**

### AC4 / theme.css constraint — CONFIRMED

- `git diff main...HEAD -- frontend/src/theme/theme.css` → **0 lines**.
- No new `--app-*` custom property declared anywhere in the frontend diff.
- Dedicated-token recommendation recorded in `DESIGN.md`, explicitly declined this
  run. Correct and conservative.

### AC1/AC3 on a modal the guard never opens — verified PASSING

I opened `PanelDetailModal` (Customize on a real panel) — a modal that is *not* in
the guard's overlay set — and measured its Cancel hover against its real
ancestor-walked backdrop:

| theme | modal interior | hover bg | ratio |
|---|---|---|---|
| dark | `rgb(38,35,32)` | `rgb(22,21,20)` | **1.167** |
| light | `rgb(255,255,255)` | `rgb(239,236,230)` | **1.179** |

Screenshots: `skeptic-panel-detail-modal-{dark,light}-cancel-hover.png`. The hover
reads as a clear chip in both themes. Family-1 remediation reached this surface
correctly. I also confirmed by ancestor walk that the true opaque backdrop really is
the dialog (`ui-modal__footer`/`__inner` are transparent), and that
`.app-content` paints its canvas-dot gradient over a transparent
`background-color` — cycle 3's backdrop-walk fix is grounded in real DOM.

### Where it breaks: `/pipelines/:id`, a route the guard does not visit

The guard's route list is `["/", "/sources", "/pipelines", "/connectors", "/chat",
"/settings"]` (`e2e/state-surface-contrast-guard.spec.ts:488`) plus three overlays.
It omits `/pipelines/:id`, `/sources/:id` and the four `*/review` routes — and
`PipelineDetailPage.css` / `SourceDetailPanel.css` are files **this diff modified**.
I went there and measured. Two reproduced failures, both light theme, both
re-measured across independent page loads:

1. **Exact 1.000 collision, rendered, hovered.**
   `.pipeline-detail-page__step-card-duplicate-btn:hover` (and its two co-declared
   siblings) paint `--app-surface-soft` `rgb(239,236,230)` on a backdrop of
   `rgb(239,236,230)` — the expanded step card, which **this diff changed to
   `--app-surface-soft`**. `identical: true` on re-read. Screenshot
   `skeptic-step-card-duplicate-hover-light-collision.png`: the hover is invisible.
   This is the ticket's canonical defect, still shipping, on a rule the diff touched.

2. **A light-theme regression introduced by this change.**
   `.pipeline-detail-page__step-card--expanded` measures **1.054** against its real
   rendered backdrop `rgb(244,242,237)` (`--app-bg`). On `main` the same rule used
   `--app-surface-raised` = `#ffffff` on `#f4f2ed` = **1.119, passing**. So light
   went 1.119 → 1.054. Dark is fine (1.207). The in-code justification comment at
   `PipelineDetailPage.css:255-264` cites "1.025 → 1.150" for light; that figure
   assumes the backdrop is `--app-surface`, but the measured painted backdrop is
   `--app-bg`. Same shape as the `.source-list-table__row` regression the evaluator
   caught at CR6 — the remediation's own defect class, third occurrence.

### AC2 — the sweep is not complete, and the shipped numbers overstate it

Beyond the route/overlay gaps above, the guard's `/` view measured **3** interactive
elements because its seeded account has an empty dashboard; a real dashboard on this
same server has 80+. `/connectors` and `/chat` contribute 1 each. `advisory = 192 of
360 (53%)`. "148 pass" is not coverage of this app's state surface, and nothing in
the change artifacts states the bound at the point a reader would meet the number.

### Gates

Selftest and the rendered guard re-run by me (above). I did not re-run lint/unit/build
— the evaluator pasted those outputs and they are not what this ticket turns on.

## Verdict: REFUTE

The guard itself is genuinely strong and AC5 is met — my independent mutation proves
it catches the exact 1.040 dark pair. But AC1/AC2/AC3 are not met: a rendered check
in light theme finds an exact 1.000 collision and a 1.119 → 1.054 regression, both on
CSS this diff edited, both invisible to the guard because its population still cannot
see that route family. That is the same failure mode as cycles 1 and 3, one layer out.

## Change Requests

1. **Fix the 1.000 collision.** `frontend/src/features/pipelines/ui/PipelineDetailPage.css:352-358`
   — `.pipeline-detail-page__step-card-drag-handle/-move-btn/-toggle-enabled-btn/-duplicate-btn:hover`
   render `--app-surface-soft` on an `--app-surface-soft` backdrop (the expanded card)
   in light: **ratio 1.000, measured hovered in the running app**. Pick the rung
   against the card's *actual* painted colour per theme, and state the measured
   light and dark ratios in the comment.

2. **Fix the light regression on the expanded step card.**
   `PipelineDetailPage.css:265-272` — light measures **1.054** against its real
   backdrop `--app-bg` `#f4f2ed`, down from **1.119** on `main`. Correct the rule and
   correct the justification comment at lines 255-264, whose "1.025 → 1.150" light
   figure is derived from the wrong backdrop (`--app-surface`, not `--app-bg`).
   Dark (1.207) is fine and should not be disturbed.

3. **Close the population gap that hid both of the above.** Add `/pipelines/:id` and
   `/sources/:id` to the guard's route list (`spec.ts:488`) — the seeded pipeline and
   source already exist, so the ids are available — and add at least one shared
   `<Modal>`-based overlay beyond `AddSourceModal` (e.g. `PanelDetailModal`) to the
   overlay set. Re-run and remediate whatever it surfaces. If a route is deliberately
   left out, name it in `design.md` D6.2 as an excluded route rather than leaving the
   omission implicit in a list.

4. **Seed the guard's `/` view with a real panel.** `/` currently probes 3 elements
   because the seeded dashboard is empty; a populated dashboard on the same server
   has 80+. This is the same class as CR7 and is why the dashboard/panel families are
   effectively unmeasured.

5. **Make AC2's claim honest at the point of the number.** State in the PR body (and
   in `files-modified.md`) the full shape: 360 probed / pass 148 / fail 20 all
   exempted / **advisory 192 (53%)**, `/connectors` and `/chat` contributing 1 element
   each, coverage bounded to the enumerated routes + 3 overlays + `MAX_ELEMENTS_PER_VIEW`.
   As written, "148 pass" reads as coverage the sweep does not have.

## Non-blocking notes

- `openspec/changes/state-surface-contrast-guard/evaluation-3.md` is **untracked** —
  the cycle-3 evaluation is not in the commit. Commit it with the fixes.
- The even-stride sampler is still never exercised (no view exceeds 24). Fine, but it
  is untested code shipping behind a guard.
- The `--app-state-hover` / `--app-state-selected` token pair now has direct evidence
  behind it (a blanket rule was applied and was wrong for two of three backdrops,
  three times). Worth filing as its own ticket with this evidence attached, per the
  evaluator's suggestion.
