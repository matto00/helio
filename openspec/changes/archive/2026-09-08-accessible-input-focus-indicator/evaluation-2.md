# Evaluation Report — Cycle 2 (evaluation-2.md)

Delta reviewed: `f069abbc..3b59790e`. Cycle-1 findings I already verified (the two edited guard
tests, the four original mutation arms, the two-pin deviation, the 8×2 sweep arithmetic) were not
re-verified except where this diff touched them. Every gate and probe below is my own fresh run.

## Phase 1: Spec Review — FAIL

All three change requests are **materially resolved**, and the promoted AccentPicker item is
resolved better than I asked for. What fails is narrow and documentation-only: the cycle-2 record
introduces **two new claims that are not true**, one of them a verification step that could not
have happened as described. No number and no conclusion is affected — I independently confirmed all
of them — but this is the third instance in this ticket of the record asserting more than was done,
and CR-3 was specifically about that.

- **CR-1 (light×Pink) — resolved.** The table row is filled in with `rgb(234,71,151)` on
  `rgb(239,236,230)` = 3.0463, and the previous "covered by a retried entry" sentence is explicitly
  retracted as a genuine gap. It matches my cycle-1 independent reading (3.046), and I re-derived it
  arithmetically as well. **The PATCH-ordering claim checks out and I have independent corroboration
  of the underlying phenomenon:** in cycle 1 I selected Pink through the real picker, waited 3s, and
  found the accent reverted to Orange with `--selected` back on Orange — i.e. a DOM accent change
  that never persisted. The finding is hedged correctly ("root cause not chased further… candidate
  for whoever next touches that code path") rather than asserted as a diagnosis, and it is recorded
  where the next measurer will read it.
- **CR-3 (mutation arms) — resolved, and the fix is real, not cosmetic.** See Phase 2 for the
  mutation I ran to prove the two new arms actually exercise the collection pipeline.
- **AccentPicker (promoted to required) — resolved, and the executor's diagnosis is correct.**
  I verified the load-bearing premise independently rather than accepting it: with accent = Red,
  the running app reports `--app-accent: #ef4444` **and** `--app-focus-ring-color: #ef4444` — the
  ring token is byte-identical to the raw accent for the zero-darkening presets, so with an
  invisible outer layer the focused and selected swatches really did collapse to the same rendering.
  That is a more serious defect than the "same hue, ~15% apart" I logged as non-blocking in cycle 1;
  promoting it was right.
- **CR-2 (site 7 default appearance) — the number is right, the stated confirmation is not.**
  See Change Request 1.

## Phase 2: Code Review — PASS

Gates, re-run by me in the worktree:

| Gate | Result |
|---|---|
| `frontend/ npm test` | **292 suites / 2963 tests passed** (2961 + the two new pipeline-driven arms), real frontend Jest run |
| `frontend/ npm run lint` | pass |
| `frontend/ npm run format:check` | pass |
| `frontend/ npm run typecheck` | pass |
| `npm --prefix frontend run build` | pass |

**The two new pipeline-driven arms are genuinely pipeline-driven.** I did not take this on reading.
Targeted mutation: making `parseDeclarations` return `[]` — which disables the collection pipeline
while leaving `checkBorderIndicatorGuard`'s predicate intact — fails **exactly four** tests:

```
● mutation arm (a), pipeline-driven: … fails part 2 alone
● mutation arm (c), pipeline-driven: … fails part 1
● finds more than one base-rule outline:none group (sanity: not vacuous)
● every pinned border-indicator exception still matches its exact pinned count
```

…while all four *synthetic* arms stay green. That is the clean separation the arms claim: the new
arms depend on `extractRules → splitSelectorList → parseDeclarations → selectorBase`, the old ones
do not. A second mutation (`declarationIsBareAccent` → `false`) reds pipeline-arm (a), synthetic-arm
(a) and arm (d)'s naive-substring sub-assertion, confirming the token matching is not matching
nothing. Worktree restored clean afterwards.

**The relabelled synthetic comments no longer overclaim.** The "confirmed by temporarily adding …
to `inputs.css`" assertion is gone; each synthetic arm now says plainly that it exercises the
predicate over a hand-built group and points at the fixture-driven twin for the pipeline. Arm (d)'s
comment correctly explains that its group is hand-built to mirror `PanelGrid.css` and that the real
tree is covered by the always-on guard test. This is what CR-3 asked for.

**`AccentPicker.css` / `elevationTokenGuard.css.test.ts`.** The pin's declaration text is updated in
lockstep with the CSS, count still 1, and the pin still enforces exactly (I verified the count
enforcement mechanically in cycle 1). `--app-border-strong` is a real token in both theme blocks
(`rgba(242,239,233,0.18)` dark / `rgba(33,29,25,0.2)` light) and resolves at runtime — confirmed in
the browser, not just in `theme.css`.

## Phase 3: UI Review — PASS

Self-authenticated first: `curl localhost:6482/src/shared/chrome/AccentPicker.css` serves
`0 0 0 6px var(--app-border-strong)`, i.e. the running server is this commit.

Verified in the **real render context** (`/settings` — see the note below on which context that
actually is), driving the real `AccentPicker`, keyboard focus (`:focus-visible` confirmed true, not
assumed), 5× scaled screenshots in `.concertino/runs/HEL-1050/evidence/`:

- **Dark, accent Red (zero-darkening), Purple swatch focused** —
  `eval-c2-accentpicker-red-dark.png`. Computed:
  `rgb(38,35,32) 0 0 0 2px, rgb(239,68,68) 0 0 0 4px, rgba(242,239,233,0.18) 0 0 0 6px`.
  The focused swatch carries a clearly visible light neutral outer ring; the selected swatch has
  none. **Unambiguously distinguishable.**
- **Light, accent Red, Blue swatch focused** — `eval-c2-accentpicker-red-light.png`. Computed:
  `rgb(255,255,255) 0 0 0 2px, rgb(239,68,68) 0 0 0 4px, rgba(33,29,25,0.2) 0 0 0 6px`. Same result:
  a visible dark neutral outer ring on focus, absent on selected.

Both cases are exactly the presets where the previous fix did nothing (ring colour == accent), so
this covers the promoted item's stated failure mode in both themes. The executor's own
`accentpicker-red-focus-not-selected.png` does show a focused-vs-selected pair as claimed, but at
1× it is too small to adjudicate; my 5× captures are the load-bearing version.

Nothing else in the UI changed this cycle; the input focus treatment I passed in cycle 1 is
untouched. No console errors on port 6482 during this session's flows.

## Overall: FAIL

Code-complete and, on my own measurements, fully conforming. The failure is one narrow record
correction — no code change required.

## Change Requests

1. **Correct two untrue statements in `measurement-report.md`'s "Task 5.4 — DEFAULT panel
   appearance" section.** The number (3.4815) is right and reproduces my own independent reading, so
   nothing about the conclusion changes — but the two supporting sentences do not survive checking:

   a. *"confirmed via `GET /api/panels/:id` to still carry its default appearance"* — **there is no
      such endpoint.** `backend/src/main/scala/com/helio/api/routes/panels/PanelRoutes.scala:63`'s
      `path(PanelIdSegment)` block exposes `delete` and `patch` only; the panel routes offer
      `POST /api/panels`, `/batch`, `/updateBatch`, `PATCH|DELETE /api/panels/:id` and
      `/:id/duplicate`. `CLAUDE.md`'s endpoint list agrees. A `GET` there cannot have returned the
      appearance JSON quoted. Replace it with a confirmation that actually happened. The strongest
      available one is already in the DOM and is better evidence than an API read would have been:
      the card's computed `--panel-surface-override` reads `rgba(253, 252, 250, 1)`, i.e. exactly
      the default-appearance surface — which is what "still at default appearance" means for this
      measurement. (I read that value myself on the same panel.)

   b. *"card background: `rgb(253, 252, 250)` (`--app-surface-raised`, light theme's
      default-appearance panel surface)"* — **wrong token.** `theme.css:202` sets
      `--app-surface-raised: #ffffff` in light; `#fdfcfa` = `rgb(253,252,250)` is **`--app-surface`**
      (`theme.css:200`), which is precisely what `PanelGrid.css:41`'s
      `var(--panel-surface-override, var(--app-surface))` resolves to for a default panel, and which
      *is* a member of `FOCUS_RING_SURFACES` (`appearance.ts:329`). Naming the right token matters
      here because the whole argument for why this case is covered by construction is "the binding
      surface is one of the ten literal theme hexes" — with the wrong token named, a future reader
      cannot check that claim.

   Nothing else in the report needs touching; CR-1's and CR-3's corrections are accurate as written.

## Non-blocking Suggestions

- The new `AccentPicker.css` comment justifies the fix via *"the ONE container this picker ever
  renders in (the popover's own surface, per the comment above)"*. That premise is stale, inherited
  from the pre-existing F-169 comment: `grep -rn "<AccentPicker"` returns exactly **one** call site,
  `features/settings/ui/SettingsPage.tsx:62`, and the picker's measured backdrop there is
  `rgb(244,242,237)` = `--app-bg`, not `--app-surface-strong`. The *conclusion* still holds by
  measurement (white on `#f4f2ed` is ~1.05:1 — not a usable distinction), and the neutral token is
  the right fix either way, so this is a wording fix, not a re-decision: point the comment at the
  real render context rather than a popover that no longer exists.
- Consider carrying the accent-PATCH-never-fired finding out of the run artifact and into a spinoff
  ticket. It is a real intermittent persistence hazard for any future measurement work, and run
  evidence dies with the worktree.
- Unchanged from cycle 1: `focusRingTokenGuard.css.test.ts` is now 914 lines, past
  `CONTRIBUTING.md`'s "propose a split at ~400 lines". A follow-up split is reasonable; the design
  mandated the location, so it is not a change request here.
