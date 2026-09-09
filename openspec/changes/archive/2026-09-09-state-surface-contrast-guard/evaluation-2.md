# Evaluation Report — Cycle 2 (evaluation-2.md)

**Commit reviewed: `51c96e3f8f41bc12ad70366f4e7c33f8891b0509`** ("HEL-866 Address
evaluation-1 change requests…"), parent `70321a3e` (cycle 1). Everything below is
against that SHA; a commit landing after this report is reviewed by nobody.

## Cycle-1 change requests — disposition (verified individually)

| CR | Claim | Verdict |
|---|---|---|
| CR1 population collapse | chrome probed once as its own view; routes scoped to `<main>`; even-stride sampling; per-view counts logged | **Structurally fixed — and the new logging is what exposes CR6 below.** Verified in the code and in a live run. |
| CR2 self-test ungated | added to ci.yml's `frontend` job | **Fixed**, `.github/workflows/ci.yml:61`, alongside `check:tokens:selftest`. |
| CR3 dead duplicate | dead exports deleted | **Fixed** — `stateContrastProbe.ts` is now the selector constant only; one copy of the walk remains, the one the mutation proof exercises. |
| CR4 `--expanded` regression | dark-scoped override to `--app-surface-strong` | **Fixed and measured** (1.089 → 1.133 dark; light keeps 1.150). Rationale recorded in the CSS and in files-modified.md. |
| CR5 ordinal-keyed exemptions | keyed on first CSS class | **Fixed for the accent-picker family** — see CR9 for a documentation inaccuracy. |

Also re-verified: `frontend/src/theme/theme.css` diff vs `main` is **0 lines**; the
`tokenAuditSweep.css.test.ts` baseline edit is a pure mechanical `+14` line shift for
`PipelineDetailPage.css` entries after line 252 (every changed entry is old+14 — it is
a line-pinned baseline following an insertion, not a masking edit).

## Phase 1: Spec Review — FAIL

AC1/AC4 remain met. AC2 ("sweep complete… which changed, which were already safe") and
AC3 ("contrast is real in dark theme too") are **not** met at this SHA: the sweep
introduced sub-threshold states in *both* themes on a family it never measured (CR6),
and the guard's route coverage does not reach that family (CR7).

## Phase 2: Code Review — FAIL

Gates re-run by me, fresh, in `WORKTREE_PATH`:

| gate | result |
|---|---|
| `npm run lint` | PASS |
| `npm run format:check` | PASS |
| `npm test` | PASS — 295 suites / 3105 tests |
| `npm --prefix frontend run build` | PASS |
| `npm run check:e2e-types` | PASS |
| `npm run check:state-contrast:selftest` | PASS — 30/30 |
| `DEV_PORT=6298 npx playwright test e2e/state-surface-contrast-guard.spec.ts` | PASS (green) — 256 probed, resolved=242, unresolved=14, pass=108, fail=20 (all exempted), advisory=114 |

**The guard is still mutation-failable at this SHA, and I proved it against this
cycle's own fix.** Removing the new
`:root[data-theme="dark"] .preferences-editor__add-btn:hover` override took the guard
GREEN → RED with stable-identity naming:

```
[dark] /settings :: button "Add color" [preferences-editor__add-btn] (#9) (hover) — ratio=1.0301171241280085
[dark] /settings :: button "Add naming convention" [preferences-editor__add-btn] (#10) (hover) — ratio=1.0301171241280085
```

Mutation reverted; `git status` clean. Note that **1.030 is a ratio the guard itself
calls a failure** — that number matters for CR6.

**The disabled-element exclusion is sound** and I am not asking for it back. It keys on
real DOM state (`HTMLButtonElement.disabled` / `aria-disabled="true"`), not a class
guess; this app's convention is `:hover:not(:disabled)`, so a disabled control is
deliberately inert and scoring it as an absence was a probe false-fail, not a hidden
defect. I checked the named instances ("Test connection" is genuinely disabled at rest
in `AddSourceModal`, and reads `rgba(0,0,0,0)` on hover — confirmed live in cycle 1).

## Phase 3: UI Review — FAIL

Rendered against the running app at `http://localhost:6298`, both themes, `location.href`
re-checked before each reading; screenshots under `.concertino/runs/HEL-866/evidence/`.

The cycle-1 surfaces still look right (chrome hovers, `.active:hover` accent-mid, modal
Cancel, palette rows). But the running app in a **data-populated** account shows the
sweep has produced new invisible states — see CR6, with
`eval2-dark-source-row-hover.png` as the rendered evidence: the hovered source row is
not perceptible.

## Overall: FAIL

## Change Requests

6. **The sweep regressed a whole family of call sites in BOTH themes, turning states
   that PASSED the ticket's own threshold into states that fail it. This is the
   ticket's own defect class, newly created by its remediation.**
   Measured live (dark and light, real rendered backdrops, same math as the guard):

   `.source-list-table__row:hover` — `frontend/src/features/sources/ui/SourceListTable.css:50`
   | theme | backdrop | before (`--app-surface-raised`) | after (`--app-surface-soft`) |
   |---|---|---|---|
   | dark | `#121110` (page body) | **1.161 (passed)** | **1.034 (fails)** |
   | light | `#f4f2ed` (table body) | **1.119 (passed)** | **1.054 (fails)** |

   It is not one selector. Every remediated call site whose real backdrop is
   `--app-surface`/`--app-bg` rather than `--app-surface-strong` moved the wrong way in
   dark; measured live on `/sources` at 1.030 for in-page instances of
   `.ui-icon-btn--secondary`, `.actions-menu__trigger`, `.user-menu__trigger`,
   `.popover__trigger`, `.dashboard-list__button`. The `App.css` chrome overrides do not
   cover these — they are scoped to `.app-command-bar`/`.app-sidebar`, and these
   instances are inside page content.
   This is the same shape the executor has now discovered and patched **three times
   individually** (App.css chrome, `PipelineDetailPage --expanded`, `PreferencesEditor
   __add-btn`). A fourth one-off is not the fix. Required: determine each remediated
   rule's **real rendered backdrop** and apply the direction that clears 1.10 for that
   backdrop (the existing `:root[data-theme="dark"] … --app-surface-strong` pattern for
   on-`--app-surface` hosts), then state in the PR which call sites are on which
   backdrop. The evidence that this is systematic is that the guard's own mutation run
   above calls 1.030 a failure while shipping 1.030/1.034 elsewhere.

7. **Guard route coverage is 1–3 elements per route, because the fresh account renders
   empty states — and this is the surface CR6 lives on.** The per-view logging CR1 asked
   for makes it plain (my run, both themes identical):
   `chrome 11 · / 3 · /sources 1 · /pipelines 1 · /connectors 1 · /chat 1 · /settings 19 ·
   command-palette 14 · modal:add-source 13`.
   Measured in a data-populated session, `/sources` has **98** visible, enabled
   interactive elements inside `<main>`; the guard sees **1**. `/settings` settles at 35;
   the guard sees 19. So the largest remediated families — table rows, list rows, gallery
   cards, data-grid controls — are structurally outside the population, which is exactly
   why CR6 shipped green.
   Required: seed the guard's account with at least one source and one pipeline (the spec
   already seeds a dashboard for this reason), so row/card/table state rules enter the
   walk; re-run and report the per-view counts.

8. **A documented view never executes, silently.** The header comment claims 10 views
   including an `ActionsMenu` instance, and `files-modified.md` repeats it. No
   `actions-menu` line appears in either theme's log: the trigger is looked up as
   `button[aria-label="HEL-866 Guard Dashboard actions"]` while the page is still
   `/sources`, where a fresh account has no rows, and the lookup is wrapped in
   `if (await trigger.count())` so a miss is indistinguishable from a pass. Required:
   navigate to the view that actually hosts the trigger and let the absence **fail**
   (or assert `toHaveCount(1)`), rather than skipping a documented view in silence.

9. **`files-modified.md` overstates the exemption keying.** It says exemptions are keyed
   on "the element's first CSS class"; only the accent-picker one is
   (`[accent-picker__swatch]`). The other two still match on rendered text —
   `r.desc.includes("HEL-866 Guard Dashboard")` and `r.desc.includes("REST API")`
   (`state-surface-contrast-guard.spec.ts:562-564`). Those keys are acceptable (the test
   creates that dashboard; the tab label is stable) — the doc is what needs correcting,
   or the code should use `[command-palette__item]` / `[add-source-modal__type-btn]` as
   claimed. A confidently-wrong artifact is a known trap in this repo.

## Non-blocking Suggestions

- The even-stride sampler never triggered this run (no view exceeded the cap of 24), so
  the sampling path is currently unexercised. Once CR7's fixtures land it will be, and
  the per-view log will show it.
- `unresolved` rose 2 → 14 (5.5%) with the `<main>` scoping. Still far under the 0.5
  ceiling, but worth a line in the PR saying what the 14 are.
- Consider printing the per-view *unique element identities* (the `[class]` tokens) at
  debug level; with CR7's fixtures that log becomes the artifact AC2 wants.

## Critical Path (cycle 2 of 3 — read this first if cycle 3 is the last)

Highest value, in order:

1. **CR6** — it is a live, user-visible regression in the shipped app, in both themes,
   of the exact defect this ticket exists to remove. Nothing else matters if this ships.
2. **CR7** — without fixtures the guard cannot see CR6's family, so CR6 could regress
   again with the gate green.
3. CR8, then CR9 (honesty of the coverage claim).

Recommendation for the human: the guard itself is now good work — mechanically
enumerated, alpha-correct, mutation-proven twice, CI-gated, and honest enough in its
logging that it exposed its own coverage limit. The **remediation** is the part that has
outrun its evidence: a 73-rule blanket token swap was applied before the guard could
measure most of its call sites, and it is measurably wrong wherever the backdrop is not
`--app-surface-strong`. If cycle 3 cannot land CR6 + CR7 together, the defensible split
is to **ship the guard plus the modal-hosted remediation (AC1/AC3/AC5, which are
measured and verified) and revert the non-modal call sites to `--app-surface-raised`**,
filing the on-`--app-surface` family as its own ticket — rather than shipping a sweep
that makes dark theme worse on the app's most-hovered surfaces.
