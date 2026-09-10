# Evaluation Report — Cycle 1 (evaluation-1.md)

All findings below come from my own fresh runs, not the executor's report.

## Phase 1: Spec Review — FAIL

What I independently confirmed as correct:

- The regression is **real and I replicated it live myself**, not from CSS
  reading. By temporarily reverting the fix in the running dev app (HMR) and
  re-measuring at `SourceDetailPanel`, I reproduced the executor's numbers
  exactly: heading-bottom → grid-top gap **18px pre-fix, 12px post-fix**, with
  `.ui-data-grid--preview`'s computed `margin-top` moving `12px → 0px` and
  `.ui-data-grid__frame--preview`'s becoming `12px`. The ticket's named
  margin-collapse risk is confirmed true, and the answer is recorded
  explicitly ("CHANGED, +6px / +8px") as the AC requires.
- Both themes checked by me at this call site: light and dark are identical
  (6px loading / 12px resolved in both). No theme divergence.
- No scope creep: the diff is two files, `DataGrid.css` and `DataGrid.test.tsx`.
- The Playwright `page.route` mock used for the SqlTab measurement is **not**
  in shipped code — `grep -rn "page.route|sources/infer.*mock|__mockInfer"
  frontend/src/` returns nothing, and the diff touches no source file that
  could carry it.
- No stray worktrees from this run: `git worktree list` shows only the main
  checkout, an unrelated `matt-audit-repo`, this delivery worktree, and an
  unrelated `wt-fonts` (task/non-blocking-font-load, a different ticket). Both
  throwaway isolating-pair worktrees are gone.
- No dev-DB fixture data attributable to this run: the most recent
  `data_sources`/`pipelines` rows are all from other lanes (`HEL-1065 …`,
  `Skeptic Src`, `FR Src`), none named or timed to HEL-1056.
- All `tasks.md` items are checked, and `files-modified.md` matches the diff.

### Blocking issue: the fix introduces a new, unguarded 6px regression at `SourcePreviewSkeleton`

`SourcePreviewSkeleton` (`frontend/src/features/sources/ui/SourcePreviewSkeleton.tsx:29`)
hand-rolls `className="ui-data-grid ui-data-grid--preview ui-data-grid--condensed"`
and renders **no frame at all**. It was relying on `.ui-data-grid--preview`
for its `margin-top`. This change removes that declaration and re-homes it on
`.ui-data-grid__frame--preview` — a class the skeleton does not and cannot
carry. The skeleton therefore silently loses its top margin.

Measured live by me at `SourceDetailPanel` (datum = `.source-detail-panel__section-title`,
viewport 1280x800, logged in as `matt@helio.dev`, both themes identical):

| State | pre-fix (= shipped `main`) | post-fix (this branch) | `a6bde0d3^` baseline |
|---|---|---|---|
| Loading (`SourcePreviewSkeleton`) | **12px** | **6px** | 12px |
| Resolved (`DataGrid variant="preview"`) | 18px | 12px | 12px |

The resolved path is fixed correctly. The **loading path regresses 12px → 6px**
against both today's `main` and the `a6bde0d3^` pre-reframe baseline the whole
ticket is measured against. `.source-detail-panel__preview` supplies no
substitute spacing (`SourceDetailPanel.css:145-152` gives it only
`margin-top`/`padding-top`/`border-top` on the section itself), so the 6px is
purely the heading's own `margin: 0 0 6px` (`SourceDetailPanel.css:154-157`).

This lands directly on an explicit acceptance criterion — "`SourcePreviewSkeleton`'s
hand-rolled markup is confirmed still consistent with `DataGrid`'s" — and
`evidence.md` §8 answers that criterion with a **factually false** premise:

> "Before this fix, the skeleton (never wrapped) and the resolved grid (now
> correctly collapsing again) would have shown the SAME 12px gap regardless —
> i.e. the loading→resolved transition was never going to show a
> margin/position jump either way"

My measurements show a 6px jump in **both** directions: 12→18 before the fix
and 6→12 after it. The transition was never jump-free, and the section's
"ship, no action needed" judgement rests on that incorrect claim. The jump
*magnitude* happens to be unchanged, which is presumably why it was not
noticed visually — but the skeleton's own steady-state spacing is now 6px
short of every baseline in the ticket, and nothing guards it.

## Phase 2: Code Review — PASS

Gates, all re-run by me in `WORKTREE_PATH` (`CLEAN_WORKTREE` not set):

- `npm run lint` — pass (0 warnings)
- `npm run format:check` — pass
- `npm test` — pass (25/25 + 299/299 suites, 3194 tests)
- `npm --prefix frontend run build` — pass
- No `backend/**` files changed → `sbt test` not required

**Guard mutation-failability independently verified.** I reverted the fix in
place (moved `margin-top` back onto `.ui-data-grid--preview`, zeroed it on the
frame rule) and re-ran Jest: exactly **1 failed, 3193 passed** — the failure
being the HEL-1056 guard, and *only* it. That both proves the guard is
genuinely failable and proves no other test in the suite covers this. Restored
to the committed state afterward (`git status` clean).

Code quality: the CSS change is minimal and token-correct
(`margin-top: var(--space-3)`, `DESIGN.md` spacing scale — no raw px
introduced). Comments are long but explain a genuinely non-obvious
flex-margin-collapse mechanism and cite the measurement, which is the right
call for a trap like this. No dead code, no TODOs, no type escapes, no
security surface. The `--full` variant is untouched and the new selector can
only match preview frames.

One correctness note on the guard's framing rather than its behavior: it is a
static-source assertion about *which selector carries the declaration*, so it
locks in the current fix's shape but cannot detect the skeleton breakage
described in Phase 1 — a green guard here is not evidence that preview
spacing is correct everywhere. That is not a defect in the guard (jsdom cannot
compute collapsed margins), but it is why the Phase 1 issue survived a fully
green suite.

## Phase 3: UI Review — FAIL

Reached `SourceDetailPanel`'s preview live at `http://localhost:6488` (dev
server process cwd verified to be **this** worktree, per `MISTAKES.md`'s
reused-server trap: PID 629738 → `.../HEL-1056/frontend`).

- Happy path works end-to-end: Preview button → skeleton → resolved grid.
- Loading state present; resolved and empty branches render as documented.
- **Console: zero errors from port 6488.** (The browser's shared history
  contains errors, but a port histogram shows they all originate from other
  lanes' servers — 5965/6298/6480 — and `grep -c 6488` is 0.)
- Both themes checked; geometry byte-identical.
- Geometry finding: as Phase 1 — resolved 12px correct, loading 6px regressed.

Not independently re-measured by me: the `StepCard` and `SqlTab` call sites.
`StepCard` requires creating a pipeline step, i.e. writing fixture rows into
the shared dev DB, which this ticket explicitly avoided; `SqlTab` is blocked by
the backend SSRF egress guard the executor documented. I accept those two on
the strength of (a) my exact replication of the `SourceDetailPanel` numbers and
root-cause arithmetic, and (b) the fact that a single CSS rule governs all
three. I am flagging this as a stated limit of my verification, not claiming
them as measured.

## Overall: FAIL

## Change Requests

1. **Restore the skeleton's lost top margin.**
   `frontend/src/features/sources/ui/SourcePreviewSkeleton.tsx:29` — the root
   `<div>`'s `className` must also carry the class that now owns the margin, or
   the skeleton must be wrapped the way the real component is. Preferred
   minimal fix: change
   `"ui-data-grid ui-data-grid--preview ui-data-grid--condensed"` to
   `"ui-data-grid__frame--preview ui-data-grid ui-data-grid--preview ui-data-grid--condensed"`,
   which restores the 12px collapsed gap without introducing a frame element
   the skeleton has no use for. Re-measure live and confirm the loading gap is
   **12px** at `SourceDetailPanel` in both themes, matching the resolved state
   and the `a6bde0d3^` baseline.

2. **Guard it.** Extend the HEL-1056 guard (or add a sibling test in
   `SourcePreviewSkeleton`'s own suite) asserting the skeleton's rendered root
   carries whichever class holds the preview `margin-top` declaration — i.e.
   the assertion must fail if the two ever drift apart again. Verify it red
   before the CR-1 fix and green after, as was correctly done for the existing
   guard.

3. **Correct `evidence.md` §8.** Replace the "would have shown the SAME 12px
   gap regardless / never going to show a margin/position jump either way"
   claim and the "ship, no action needed" judgement with the measured reality:
   the loading→resolved transition jumped 12→18px before this change and 6→12px
   after it, and the skeleton required an actual code change. The ticket's
   whole point is that a future reader can trust these recorded numbers.

## Non-blocking Suggestions

- `frontend/src/features/sources/ui/SourceDetailPanel.css:145` and `:149`
  declare `.source-detail-panel__preview` twice, back to back, for no reason.
  Pre-existing and out of scope, but worth folding into one block if CR-1
  brings you into that file anyway.
