## Evaluation Report — Cycle 5 (evaluation-5.md, owner-authorised)

This cycle reviews HEAD `9fbe26a7ac24733502b08db2fc56855b33ffa085`. The cycle-5 delta is `beb35975a..9fbe26a7a`. The base was
resolved live as `544bd79ea5879263fc05808ff15bee6cd7d6c430` and is an ancestor of HEAD. The servers run from this worktree.

Persisted evidence:
- Measurements: `/home/matt/Development/helio/.concertino/runs/HEL-1582/evidence/.concertino/scratch/HEL-1582/eval5/wrap.json`
- Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1582/evidence/.concertino/scratch/HEL-1582/eval5/wrap.json.dark@375.wide.png`
- The probe script is in `.concertino/scratch/HEL-1582/eval5/`.

I ran the live checks in my own headless Chromium (isMobile, hasTouch, DSF 2), with page loads paced to stay under the
per-user API rate limit.

### Gates (fresh)

| Gate | Result |
|---|---|
| lint, format:check, typecheck, frontend build | exit 0 |
| jest (2 workers) | root 524/524; frontend 706 suites / 8880 tests |
| check:tokens / e2e-types / openspec / spec-structure / e2e-user-cleanup / e2e-evidence-paths / repo-integrity / schemas | all exit 0 |
| Playwright under the lock, 2 workers: the whole batch (`hel1582-mobile-pipeline`, `hel1628-source-sample-label`, `state-surface-contrast-guard`, `hel1579-pipeline-spine-layout`, `hel1583-glass-nav`) | **80 passed** (5.2 min) |

The batch reproduced no rate-limit failure. The single hel1579 accent-audit failure the executor reported did not recur
when the whole batch ran under 2 workers, which fits the known HEL-1620 flake.

### The cycle-4 change request (Partial / 8-digit / paused at 375×812) — RESOLVED, measured live

The worst case measured is a long pipeline name, 12,345,678 rows, 3 hours ago, ⚠ Partial and a paused cron chip (the
widest case I built). In the table, "chip" means the paused cron chip.

| Viewport / theme | State | Status line | Output bottom vs bar top | Partial badge |
|---|---|---|---|---|
| 375 dark | open, Succeeded + 8-digit + Partial + chip | 50.8 (2 lines) | **+7.2** | visible, w 68, hit at its centre, right edge 363 (inside the 12px gutter) |
| 375 light | same | 50.8 | **+7.2** | same |
| 375 dark/light | open, persisted Failed + 8-digit + Partial + chip | 50.8 | **+7.2** | same |
| 375 dark/light | in-session Queued | 44 | **+14** | n/a (meta hidden) |
| 375 dark/light | in-session Succeeded ("Snapshot replaced: 14 rows") | 44 | **+14** | n/a |
| 375 dark/light | in-session Failed, a real failing run with a long error that ellipsizes | 44 | **+14** | n/a |
| 375 dark/light | never-run + chip | 28 | **+30** | n/a |
| 390 dark | all of the above | at most 50.8 | at least **+39.2** | visible |
| 768 light | all of the above | at most 50.8 | at least **+219** | visible |

Other results from the same runs:
- No horizontal overflow anywhere: `runline` scroll overflow 0 and document overflow 0.
- The meta's full text is in its `title`: "12,345,678 rows written · 3 hours ago · Partial (row cap reached)".
- Header touch floor: every control was 44 or more on both axes in every state and width, measured by bisection at 0.25px.
  That covers the back link, Pipeline actions and the schedule chip.
- The status line's expander tiling still holds.

**The executor's wrap-sweep table** (`evidence/before-after.md`) agrees with my numbers:
- Page open: 50.8 / +7.2, never-run 28 / +30.
- In-session Queued and Succeeded: 44 / +14.

One difference: its "long failed error" row records an in-session Failed at 50.8 / +7.2, made with a mocked 500. My real
assertion failure measured 44 / +14. Both fit.

**The new e2e is genuinely red on beb35975a.** On that commit (cycle 4) I measured each widening cause alone, and each
already wrapped the status line to three lines with the Output card at 704.8 against a bar top of 696:
- 12,345,678 rows, 3 days ago;
- 1,000 rows plus Partial;
- Partial plus a paused chip.

The new case (12,345,678 + Partial + paused) is at least that wide, so it is red. This matches the executor's recorded
704.8 against 696.5.

### "Reachable on touch": the executor's choice — ACCEPTED

The `title` on the meta and on the failed label is not reachable on touch, because touch devices have no hover. The
executor relies instead on the Runs tab (a 44px tab on the same page). I verified that its latest row shows everything the
header can ellipsize:
- **Failing pipeline, Runs tab at 375:** the latest row is the in-session run I had just made: "10/17/2026, 2:00:13 PM ·
  15ms · — · Failed · Manual · 0 passed · 1 error · Show log".
  - The "Show log" toggle's hit area measured **69.75 × 44.75**.
  - Tapping it shows the full error: "Run blocked: 1 error-severity assertion(s) failed — unique(status): Field 'status' has
    12 duplicate value(s)", plus the per-rule detail.
- **Succeeded pipeline:** the latest row shows the full row count ("14 rows", `toLocaleString`, not ellipsized), the status
  and the time.
- **Partial badge:** the row renders `TruncatedRowCountBadge` when the run's `truncation.truncated` is true
  (`RunHistoryModal.tsx`, `RunRow`). That is the same badge as the header's.

The full figures and the full error are therefore one 44px tap away on the same page, with no hover needed. I judge that
this satisfies "reachable on touch". The executor's argument against a separately tappable meta is also sound. A 44px-hit
meta in the run line would need its expander tiled at least 14px from the back link's row and from the schedule chip's
line (DESIGN.md §3). That would cost about 16px of header height against a fit budget that is only +7.2px in the worst
measured case.

### Phase 1: Spec Review — PASS

AC1–AC4 hold in every state I measured:
- **AC1:** at 375×812 the worst page-open case is +7.2px. The owner has accepted the truncation-notice strip,
  analyze-warning banners and rename/confirm rows as outside the one-screen check, and the spec now says so.
- **AC2, AC3, AC4:** verified unchanged.

The spec delta matches the implementation: the status line has at most two lines, run status and meta share one
ellipsizing line, the badge is never clipped, and the schedule chip is on the second line.

### Phase 2: Code Review — PASS

The change is small and correct:
- `.mobile-header__runline` uses tokens only, with a nowrap/ellipsis chain. The badge is `flex: none` and the line hides
  with `:empty` when there is nothing to show.
- The desktop gains a `title` on `SpineLastRunMeta`. This is harmless and additive; hel1579 and the full jest suite are green.
- The e2e case asserts both the fit and that the badge is visible.

### Phase 3: UI Review — PASS

The touch floor, fit, overflow and badge visibility were measured at 375 (both themes), 390 and 768, as shown above.

### Overall: PASS

### Reported for the owner (outside scope, not sent back)

- **The relative time can be ellipsized away at 375.** At 375 with an 8-digit count, the run line reads "Succeeded ·
  12,345,678 rows written… ⚠ Partial", and the relative time is cut off entirely (see the screenshot). It remains in
  `title` and as an absolute timestamp in the Runs tab. This is a consequence of the owner-chosen ellipsis approach. If
  the age of the last run matters more than the count, put the time first.
- **The in-session Failed error is ellipsized in the header at every width, including 768** (label width 744). The Runs
  tab's "Show log" holds the full text, as above.
- **Earlier owner notes still stand.**
  - The Dry run hover changes only 1.025:1 from its rest fill in light.
  - `PipelineMobile.css` is about 540 lines.
  - Follow-up FU-3 covers the shared accent-ink/accent-strong hover pair (3.95:1).
