## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established (not trusted from prior reports):**
- Read `ticket.md`, `design.md`, `tasks.md`, `files-modified.md`,
  `specs/pipeline-step-preview/spec.md`, `evaluation-1.md`, and both
  `skeptic-design-*.md` fresh from disk.
- `git diff main...HEAD --name-only`: touches only
  `frontend/src/features/pipelines/ui/{PipelineDetailPage.{tsx,css,test.tsx},PipelineRiverView.tsx,StepCard.{tsx,test.tsx}}`
  plus `openspec/**` planning docs. No backend/schema/wire files touched —
  confirms AC5 (backward compatible).
- Read the full `StepCard.tsx` diff, `PipelineDetailPage.tsx`/`PipelineRiverView.tsx`/`.css`
  diffs, and the new `StepCard.test.tsx` (280 lines, 12 tests) in full — not
  skimmed.

**Acceptance criteria traced to real code/behavior:**
1. Rows (≤10) + output schema inline — `StepCard.tsx:405-424` (schema chip strip)
   + `DataGrid variant="preview"` (`StepCard.tsx:431`); `outputSchema` sourced from
   `PipelineDetailPage.tsx`'s new `getAnalyzeOutputSchema` (mirrors
   `getAnalyzeSchema`, confirmed `SchemaField[]` is a required, always-present
   field on `BaseAnalyzeStep` — `pipelineStep.ts:304-313`) → threaded through
   `PipelineRiverView.tsx`. Live-verified below.
2. Debounced refresh-on-edit — `StepCard.tsx:119-159`, effect keyed on
   `expanded && previewOpen` + a `lastFetchedFingerprint` ref distinguishing
   activation (immediate) from config-change (500ms debounce via
   `window.setTimeout`). Cross-checked `useStepCardState.ts:178-186`: `persist()`
   only calls `onConfigChange` inside the PATCH's `.then()`, so `step.config`
   (and the fingerprint the effect watches) genuinely only changes post-PATCH —
   "refresh after settle" is real, not assumed. Live-verified below (network
   sequence).
3. Loading/error reuse — `StepCard.tsx:425-433`, same `previewLoading`/`previewError`
   state shapes as the pre-existing implementation; `role="alert"` for errors.
   Confirmed via `StepCard.test.tsx` (loading text, `role="alert"` cases) — both
   pass.
4. `DESIGN.md` + tests — new CSS (`PipelineDetailPage.css:485-505`) uses only
   `--space-1/2`, `--app-radius-sm`, `--app-surface-soft`, `--app-border-subtle`,
   `--app-text`, `--app-text-muted`, `--font-mono`, `--text-xs` (verified by
   reading the diff directly, no hardcoded colors/fonts). Tests cover rows+schema
   rendering and refresh-on-edit (`StepCard.test.tsx`, verified below).
5. Backward compatible — confirmed via the file-scope diff above; no
   `previewStep`/analyze wire shape change.

**Gates re-run independently (not trusted from evaluator's paste):**
- `npm run lint` → clean, 0 errors/warnings (reproduced).
- `npm run format:check` → clean (reproduced).
- `npx jest --testPathPatterns='StepCard.test|PipelineDetailPage.test|PipelineRiverView.test'` →
  2 suites, 94 tests passed (reproduced).
- `npm test` (full suite) → **175 suites / 1754 tests passed** (reproduced,
  matches both executor's and evaluator's claimed numbers exactly).
- `wc -l StepCard.tsx PipelineDetailPage.tsx` → 440 / 583 lines, matching
  `files-modified.md`'s claimed post-change line counts exactly. Confirmed
  `CONTRIBUTING.md:24`'s "~400 lines → propose a split in the PR description"
  is a soft, informational budget, not a blocking gate — correctly flagged in
  `files-modified.md` for the PR body, not a defect in the code itself.

**Live UI verification** (own domain — this is where I add judgment beyond the
evaluator's mechanical pass):
- Started servers via `scripts/concertino/start-servers.sh` on this run's
  assigned ports (dev 5836 / backend 8743); `assert-phase.sh servers` → `PASS`.
- Navigated to the same `HEL-454 eval smoke` pipeline's `Assert / validate`
  step. On page load, the preview auto-opened (a prior session's
  `localStorage["helio-step-preview-open"]="true"` carried over) — this is
  itself a live demonstration of the persistence scenario working across a
  full page reload, not just in jsdom.
- **Rows + schema together**: screenshot confirms the "id: string" / "amount: string"
  chip strip renders above the `DataGrid` rows table, inline inside the
  expanded card, in both **dark** and **light** themes (toggled live). Chips
  use a monospace font for the field name with a muted-color `: type` suffix,
  visually consistent with the pre-existing sibling diff-chip block in the
  same file. No hardcoded-looking colors, good contrast in both themes,
  parity confirmed.
- **Refresh-on-edit, live network trace**: changed the assert rule's "Field"
  dropdown from `amount` → `id` and captured the network log. Exact sequence
  observed: `PATCH /api/pipeline-steps/:id` → `GET .../analyze` →
  `GET .../steps/:id/preview` — i.e. PATCH settles, then analyze re-runs
  (300ms debounce), then the preview re-fetches (500ms debounce) automatically,
  with no manual toggle and no full pipeline run. This matches AC2 exactly.
- **Persistence write**: clicking "Hide preview" wrote
  `localStorage["helio-step-preview-open"] = "false"` (read back directly via
  `window.localStorage.getItem`, not inferred from UI state alone).
- **No console errors** introduced by any of the above; the one error present
  (`GET .../schedule → 404`) is the pre-existing, unrelated "no schedule set"
  behavior, confirmed also present on the bare `/pipelines/:id` page before
  any preview interaction.
- Servers stopped after verification; confirmed ports 5836/8743 free via
  `lsof`. Two screenshots I took (`stepcard-dark-1440.png`,
  `stepcard-light-1440.png`) were deleted from the repo root after review; the
  ~11 pre-existing stray PNGs at the repo root belong to a different,
  concurrently-running session (per the known parallel-Playwright-session
  hazard) and were deliberately left untouched.

**Design judgment beyond the checklist**: the schema-chip strip is a
well-judged "smallest addition" — it reuses the existing preview tray
(`pipeline-detail-page__step-preview`), an existing chip visual language
already present in the file (the diff-chip block), and existing tokens
throughout. No new one-off component was invented where a shared one should
have been used, and none was needed (`CONTRIBUTING.md`/`DESIGN.md` reviewed —
no `Chip` primitive exists in `shared/ui/` to reuse instead). The `2px 7px`
chip padding (flagged non-blocking by the evaluator) is a byte-identical copy
of the pre-existing sibling recipe at `PipelineDetailPage.css:422` and 6+
other sites across the pipelines feature — confirmed via `grep -n "padding: 2px"`
myself; agree this is pre-existing drift, not a new deviation, and not worth
blocking on given the ticket's stated scope.

**Design-gate history sanity check**: `skeptic-design-2.md`'s CONFIRM correctly
resolved round 1's persistence-mechanism gap (mount-time-only read → re-sync-on-expand).
I independently re-traced the final `handleHeaderClick`/`readStoredPreviewOpen`
mechanism in the shipped code (`StepCard.tsx:143-159`) against that resolution
and it matches exactly what was designed and confirmed at the design gate.

**One non-blocking observation** (not in either prior report, not blocking):
`runFetch` inside the `useEffect` has no request-staleness guard — if the
600px-scale activation fetch and the 500ms-debounced config-change refetch
both land in flight simultaneously and resolve out of order (e.g. slow/flaky
network), the older response could theoretically overwrite the newer one's
rows. This is a real, if narrow, gap the ticket's ACs and spec scenarios don't
require guarding against, and it is consistent with an established codebase
convention — `PipelineDetailPage.tsx`'s own `analyzePipeline` Redux thunk has
the identical no-staleness-guard shape (`extraReducers` unconditionally
overwrites `state.analyzeResult[pipelineId]` on `fulfilled`, keyed only by
pipelineId, not by request). Flagging as a documentation/awareness note, not a
required change for this ticket.

### Verdict: CONFIRM

### Non-blocking notes

- Potential out-of-order-response race between the activation fetch and a
  debounced config-change refetch (see above) — matches an existing codebase
  convention (`analyzePipeline` thunk), not a regression introduced by this
  change, and outside the ticket's stated scope. Worth a request-id/AbortController
  guard as a future hardening pass across both call sites if this ever becomes
  observable in practice.
- The `2px 7px` chip padding literal (evaluator's note, independently
  confirmed) is pre-existing drift repeated at 6+ sites; a `DESIGN.md`
  "compact chip" token would resolve it codebase-wide, out of scope here.

### Operational note (unrelated to the verdict)

While preparing to write this report, an earlier malformed shell command of
mine accidentally redirected stderr into
`/home/matt/Development/helio/scripts/concertino/next-report-number.sh`,
truncating it to a single garbage line. This file is untracked/gitignored
(`scripts/concertino/` is entirely `concertino sync`-generated, confirmed via
`git status`/`git show HEAD:...` showing it was never tracked), so `git
checkout` could not restore it. I restored it by copying the byte-identical
canonical source from `~/Development/concertino/core/scripts/next-report-number.sh`
(confirmed byte-identical to the sibling `assert-phase.sh` copy already in
this repo via `cmp`, i.e. `concertino sync` does verbatim copies with no
per-repo templating for this script), restored the executable bit, and
verified it now runs correctly (`READY number=1 path=...` on this same change
dir). No other in-flight agent appears to have hit the broken window in
between. Flagging for transparency since this script is shared infrastructure
used by other concurrently-running deliveries in this repo, not because it
affects HEL-404's verdict.
