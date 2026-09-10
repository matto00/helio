## Skeptic Report — final gate (round 0, skeptic-final-1.md)

Everything below is from my own fresh run in this worktree and in the running app.
Nothing is accepted from the executor's or evaluator's narrative.

### What I verified (with evidence)

**1. The actual diff (ground truth, not the reports).**
`git diff main...HEAD` = 2 shipped source files + 2 test files + change artifacts:
- `frontend/src/shared/ui/DataGrid.css` — `margin-top: var(--space-3)` removed from
  `.ui-data-grid--preview`, added to a new `.ui-data-grid__frame--preview` rule
  (that rule's ONLY declaration — I read the file; nothing else leaks onto anything
  carrying the class).
- `frontend/src/features/sources/ui/SourcePreviewSkeleton.tsx:37` — root now
  `className="ui-data-grid__frame--preview ui-data-grid ui-data-grid--preview ui-data-grid--condensed"`.
- Two new guards. No other production change. **No scope creep**: no filtering added
  to the preview variant (the ticket's explicit non-goal), no unrelated refactor.

**2. Live measurement — SourceDetailPanel (I reached it myself, both themes).**
`/sources/aea9f7da-…`, clicked "Preview", datum `.source-detail-panel__section-title`
(computed `margin-bottom: 6px`):

| state | light | dark |
|---|---|---|
| loading (`SourcePreviewSkeleton`) | **12px** (own `margin-top: 12px`, class list confirmed to include `ui-data-grid__frame--preview`) | **12px** |
| resolved (`DataGrid variant="preview"`) | **12px** (frame `margin-top: 12px`, scroll container `margin-top: 0px`) | **12px** |

12px = `max(6, 12)` — the adjacent-sibling collapse is genuinely restored (the
regressed value would have been 6+12=18). Matches the `a6bde0d3^` baseline claimed
in evidence.md. Also held at 360px width (12px) and 1280px (12px).

**3. Live measurement — StepCard (the gap the evaluator did NOT independently close; I closed it).**
I reached it without writing anything to the dev DB: existing pipeline
`proj-2026-flat` (`/pipelines/ebf9617e-…`), expanded the `Compute column` step,
clicked "Preview data". Datum `.pipeline-detail-page__step-preview-schema`
(computed `margin-bottom: 8px`):
- dark: frame `margin-top: 12px`, **gap 12px**
- light: frame `margin-top: 12px`, **gap 12px**

12px = `max(8, 12)`, i.e. the pre-reframe baseline, not the regressed 8+12=20.
Screenshot `.playwright-mcp/hel1056-stepcard-dark2.png` — the schema-chip block →
preview grid rhythm reads correctly and matches sibling spacing.

**4. SqlTab — the remaining unmeasured-by-review call site: judged an acceptable gap.**
I did not reach it live (the backend's SSRF egress guard rejects
`POST /api/sources/infer` against loopback Postgres — a real environmental block,
with a 502 body captured in evidence.md §1). I judged it acceptable rather than
pushing back, because the geometry there is **arithmetically insensitive to this
change**: its datum `.add-source-modal__preview-hint` is declared `margin: 0`
(`AddSourceModal.css:107-111`), and `max(0, 12) = 0 + 12 = 12px` — collapsed or
not, the value is identical. There is no state in which this fix can move that
call site. The evidence's 12/12/12 for SqlTab is therefore corroborated by
construction, and it is also the one call site the executor's own live (route-
mocked) measurement showed unchanged in both directions.

**5. Both guards are genuinely mutation-failable — I flipped them myself.**
- Removed `ui-data-grid__frame--preview` from `SourcePreviewSkeleton.tsx` →
  `SourcePreviewSkeleton.test.tsx` **1 failed** (green before).
- Moved `margin-top: var(--space-3)` back from `.ui-data-grid__frame--preview` onto
  `.ui-data-grid--preview` in `DataGrid.css` → `DataGrid.test.tsx` **1 failed, 113 passed**.
Both files restored; `git status` clean afterwards.

**6. Completeness of the class-name contract.** `grep` for `ui-data-grid--preview`
in non-test source: only `SourcePreviewSkeleton.tsx`. `variant="preview"`: exactly
the three documented call sites. No fourth hand-rolled consumer was left behind
losing the margin — which was precisely the cycle-1 failure mode.

**7. My own gates, re-run in the worktree.**
`npm run lint` pass (0 warnings) · `npm run format:check` pass · `npm run typecheck`
pass · `npm test` **300 suites / 3195 tests, all pass**.

**8. UI/design judgement (my domain).** Screenshots read in both themes
(`hel1056-light.png`, `hel1056-dark.png`, `hel1056-stepcard-dark2.png`). Spacing is
token-driven (`--space-3`, no raw px introduced), light/dark are geometrically
byte-identical and both render correctly, the loading→resolved transition is now
jump-free (12→12) where before this ticket it jumped 12→18, and the preview grid's
rhythm matches the sibling schema grid above it on the same panel. Zero console
errors during the flow.

**9. Ticket ACs traced.** All three call sites reached and measured against
`a6bde0d3^` (two by me directly, the third argued invariant above) ✓ · margin-top
question answered explicitly as CHANGED, +6px / +8px / 0px ✓ · regression fixed and
guarded ✓ · skeleton consistency confirmed — with a code change, and evidence.md §8
now says so accurately rather than the cycle-1 "no action needed" overclaim (I
diffed §8's numbers against my own measurements: they match) ✓ · both themes ✓.

### Verdict: CONFIRM

### Non-blocking notes
- `SourcePreviewSkeleton`'s root takes `ui-data-grid__frame--preview` without the
  `ui-data-grid__frame` base class — unorthodox BEM. It is the right call here
  (the modifier's sole declaration is the margin, and the skeleton deliberately
  renders no frame) and the inline comment says why, but a future reader may
  reasonably want a dedicated `.source-preview-skeleton` rule instead of borrowing
  a component modifier.
- Carried forward: neither guard can catch a *computed* margin regression, only
  class/selector drift — jsdom cannot resolve collapsed margins. Any future change
  in this area must be measured in a browser, not certified by a green suite.
- `openspec/changes/.../evaluation-2.md` is still untracked at the time of this
  review; it needs committing before delivery.
