## Evaluation Report — Cycle 4 (evaluation-4.md, owner-authorised extra cycle)

This cycle reviews HEAD `beb35975aec717c6ec764ad11e380efdc3cb3112`. Its parts:
- the fix `e718ef4e6`;
- a clean merge of origin/main `544bd79ea` (HEL-1629, V137) in `1072cb5eb`, with no conflict hunks;
- a post-merge evidence commit.

The live-resolved base is `544bd79ea5879263fc05808ff15bee6cd7d6c430` and is an ancestor of HEAD. The servers on 7014 and 9921
run from this worktree and were started at 13:10:26/29, after the merge at 13:10:17.

Persisted evidence:
- Measurements: `/home/matt/Development/helio/.concertino/runs/HEL-1582/evidence/.concertino/scratch/HEL-1582/eval4/evaluator-cycle4-measurements.json`
- Screenshot: `.../eval4/variants.json.partial-paused.png` (same evidence directory)
- Probe scripts: `.concertino/scratch/HEL-1582/eval4/`

### Gates (fresh)

| Gate | Result |
|---|---|
| lint, format:check, typecheck, frontend build | exit 0 |
| jest, 2 workers | root 524/524; frontend 706 suites / 8880 tests |
| check:tokens / e2e-types / openspec / spec-structure / e2e-user-cleanup / e2e-evidence-paths / repo-integrity / schemas | all exit 0 |
| Playwright under the lock, 2 workers: `hel1582-mobile-pipeline` (whole file), `hel1628-source-sample-label`, `state-surface-contrast-guard`, **`hel1579-pipeline-spine-layout` (desktop spine)**, `hel1583-glass-nav` | **79 passed** (5.0 min) |

**Merge regression check.** The merge brings in HEL-1629, which changed backend files, schemas, `draftSave*` services and types,
and `types/pipelineStep.ts`. It touches no UI file this branch changes. The full jest suite, the desktop-spine and glass-nav
e2e and the schema-drift check are green, so I found no regression. `backend/**` is not in this change's diff against the
base, so `sbt testFull` was not triggered.

### Cycle-3 change request: the in-session status line — RESOLVED

`MobilePipelineHeader` now renders `SpineLastRunMeta` only when no in-session status (`sseData.status ?? runStatus`) is shown.
I measured it live at 375×812 in both themes, with the persisted meta at its widest (12,345,678 rows, 3 days ago, the
Partial badge) and a paused cron chip. All header controls stayed at or above 43.75 px in every row of the table.

| State (dark and light identical) | Header | Status line | Output bottom vs bar top 696 |
|---|---|---|---|
| queued (run POST held) | 92 | 28 | **+30** |
| in-session succeeded, after a real run | 92 | 28 | **+30** |
| in-session dry run ("Preview: 14 rows") | 92 | 28 | **+30** |
| in-session failed, a real failing run whose long error is ellipsized | 108 | 44 | **+14** |

**The new e2e genuinely goes red without the fix.**
- On `00dfd8df2`, the header rendered `SpineLastRunMeta` unconditionally. That makes the new `toHaveCount(0)` on
  "Last run metadata" red by construction.
- In cycle 3 I measured that exact post-Run state myself on `00dfd8df2`: the Output card's bottom was at 698 against a bar
  top of 696. That is past `assertFits`' +0.5 tolerance, so the fit assertion is red too.
- The test mocks a wider meta ("12,345 rows · 3 hours ago"), which only adds width. This matches the executor's recorded
  red (698 against 696).

### Phase 1: Spec Review — FAIL

The CR is resolved, but **AC1 still fails at 375×812 on page open for a pipeline whose last run hit its row cap.** The
specification puts this exact state in scope (scenario "Partial counts visible"). I swept the persisted meta width at
375×812:

| Persisted state on page open | Status line | Output vs bar |
|---|---|---|
| 14 / 1,234 / 12,345 rows, minutes or hours ago, "Add schedule" or a cron chip | 2 lines (50.8) | **+7.2** |
| 12,345,678 rows, 3 days ago | 3 lines (66.8) | **−8.8** |
| **1,000 rows, 2 hours ago, ⚠ Partial** (a truncated last run) | 3 lines (66.8) | **−8.8** |
| 1,000 rows, ⚠ Partial, paused cron | 3 lines (66.8) | **−8.8** |

The spec requires, for one source, three steps and one Output at 375×812, that the page "SHALL show … the Output card
fully, above the floating action bar, without scrolling". With the Partial badge, which the same spec requires to be
visible, the status line reads "Succeeded / 1,000 rows written · 2 hours ago ⚠ Partial / chip" across three lines. The pills
then cover the bottom 8.8 px of the Output card (see the screenshot).

This is not a scope addition. It is the same defect class as the cycle-3 change request (the header status line wrapping to
a third line at 375), in a state the cycle-4 fix does not cover: the in-session status is absent, so the meta is shown.
The e2e only exercises "12,345 rows · 3 hours ago" with no badge, which stays at two lines. In reality a truncated run also
shows the `SpineStatusStrip` truncation notice, which adds more content below the tabs. That banner is legitimate extra
content, but it confirms the fit has no headroom whenever the run was truncated.

### Phase 2: Code Review — PASS

The fix is minimal and correct. Hiding the stale persisted meta during an in-session status is also right on its merits:
"14 rows written · 1 minute ago" next to a fresh "Snapshot replaced" was redundant. The truncation context is not lost
during a session, because the live notice shows in `SpineStatusStrip`. The e2e is honest: it holds the run with a gated
route, asserts in both states, and checks the cause directly.

### Phase 3: UI Review — FAIL

The touch floor and the in-session fits are clean, measured both themes. The fit fails on page open for truncated or very
large persisted runs, as shown in the Phase 1 table. 390 and 768 were not affected in any earlier cycle, and 375 is the
AC1 viewport.

### Overall: FAIL

### Change Requests

Under the owner's scope rule this is reported as a real defect in this change, because AC1 and the spec's own Partial
scenario fail together. Whether to fix it now or file it is the owner's decision. See the Critical Path.

1. **Keep the status line at two lines at 375 when the persisted meta carries the ⚠ Partial badge or an 8-digit row count.**
   - Today the status line wraps to three lines (`MobilePipelineHeader.tsx`, the `.mobile-header__status` row with
     `SpineRunStatus`, `SpineLastRunMeta` and the chip), which puts the Output card 8.8 px under the action bar on page open.
   - Possible approach, an option rather than a prescription: put the status chip and the meta on one line and let the
     meta text ellipsize (`min-width: 0`), keeping the Partial badge visible. The schedule chip stays on the second line.
     The full text stays reachable through `title`.
   - Add an AC1 e2e case on page open with `lastRunTruncated: true` and a large count. It must go red on the current code.

### Non-blocking (for the owner, not change requests)

- Truncated runs also show the `SpineStatusStrip` notice (about 46 px) on boot, so even with the header fixed a truncated
  pipeline will push the Output card below the fold at 375. That is arguably fine, because it is extra content, but the AC1
  wording does not carve it out.
- Earlier notes still stand: the Dry run hover changes only 1.025:1 from its rest fill in light, and `PipelineMobile.css` is
  about 520 lines.

### Critical Path

This is the extra cycle, so it goes to the owner.
- **Done and verified:** the cycle-3 CR (in-session states), all earlier CRs, all gates, 79 e2e tests including the desktop
  spine after the HEL-1629 merge, and the touch floor in every header state.
- **Remaining:** AC1 at 375×812 is violated by 8.8 px on page open when the last run is truncated (the Partial badge) or the
  row count reaches 8 digits.

Recommendation, owner's choice:
- **(a)** One small header change plus one e2e case. Low risk, the same pattern as cycle 4.
- **(b)** Accept and file a follow-up. HEL-1631's draft-status row will make the bar taller, so this margin only shrinks.
  A follow-up is reasonable only if it is tracked against HEL-1631.

I lean to (a), because the failing state is one the spec explicitly names.
