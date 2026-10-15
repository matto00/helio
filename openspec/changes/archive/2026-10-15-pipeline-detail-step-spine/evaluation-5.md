## Evaluation Report — Cycle 5 (evaluation-5.md, owner's last granted cycle)

**Scope**
- Reviewed HEAD: `89074429ddcb30c877add28d1f413546cf105c93`. Base: `cd64409ad828d9024074f907a7ea32800ab71ff3`.
- Delta since cycle 4 (`2bd0dc7ca..89074429d`):
  - Header narrow rules are now container queries on `.pipeline-detail-page--spine` (≤800px / ≤600px of page width).
  - Leaner header: dot-only last-run chip with its label visually hidden, icon-only Dry run, and a "Run" label with accessible name "Run pipeline".
  - Spine track is now `clamp(180px, 22vw, 340px)`.
  - `.step-focused__actions` wraps.
  - New e2e sweep covering 769–1100px.
  - Design note and spec delta updated.
- Backend unchanged since cycle 1 (`sbt testFull` 8139 passed / 0 failed; RLS spec 6/6, non-BYPASSRLS).

### Gate evidence (fresh runs, this worktree)

| Gate | Result |
|---|---|
| `npm run lint`, `format:check`, `typecheck`, `npm --prefix frontend run build`, `check:schemas`, `check:openspec` | all exit 0 |
| `openspec validate pipeline-detail-step-spine --type change` | valid |
| `npm test` (3 workers) | root 469 tests; frontend 616 suites / 7360 tests; 0 failed |
| Spine suites (`--json`, `.../HEL-1579/frontend/src/...`) | `spine.test` 43 passed, `spineEditing.test` 38 passed |
| Playwright, 2 workers, servers 7011/9918 (cwd = this worktree) | **39 passed**. Covers:<br>- `hel908-step-card-split`<br>- `hel1007-multi-root-reorder`<br>- `focus-presence-guard` (pipeline-detail, both themes)<br>- `state-surface-contrast-guard` (pipeline-detail, both themes)<br>- all 9 `hel1579-pipeline-spine-layout` tests: accent audit (both themes, two presets); 1280x800 no-scroll ≥8 rows; 1440x900; 820/900/1100/1280; selection; lanes; flush; evidence; new sweep |

### Cycle-4 change requests

**CR1 (header overflow): FIXED.** Measured in the running app (dark and light):
- Header items:
  - At 769 (list default 248 and max 400), 900, 1000, 1100, 1280 and 1440, with the list at default or max, `.spine-header` never overflows.
  - Every item ends inside the viewport and no item overlaps the next.
- Actions menu:
  - At 769 the ⋮ "Pipeline actions" opens a menu inside the viewport (x 626–766 of 769).
  - The menu lists Rename, Edit source, Edit schedule, Resume schedule, Run history and Share. No Delete.
- Document scroll: none at any width.

**CR2 (editor action row): FIXED.** The editor action buttons stay inside the centre column at every measured width.

**The sweep is real and failable.** I re-ran the sweep's measurement logic in the live page at 769px, after re-imposing the cycle-4 header (long labels, visible status text, 14ch crumbs floor, wider gap and padding) with an injected stylesheet. It reported:
- `header over by 52`
- `Run pipeline right 785 > vw`
- `Pipeline actions right 821 > vw`

With the stylesheet removed it reports no failures.

Note that injecting only the label changes, without the floor, gap and padding, did not trip it at 769. So the sweep catches the real cycle-4 regression, but not every single-rule regression.

### Header judgments

- **"Run" short label:** acceptable. It appears only below about 600px of page width. The accessible name stays "Run pipeline", and the visible text "Run" is contained in it (WCAG 2.5.3 label-in-name holds). The ticket's header spec says "the primary **Run**". It stays the only accent control.
- **Icon-only Dry run:** acceptable. It keeps `aria-label`/`title` "Dry run" and is still secondary. The ticket asks only that Dry run be present.
- **Dot-only last-run chip:** acceptable. The label is visually hidden but remains the chip's accessible text.
- **At 1280 and 1440 the header is unchanged in content:** "Pipelines /", the name, "● Succeeded", "14 rows written · …", "Every 15m Paused", "Dry run", "Run pipeline", ⋮. `StatusChip` now also renders its dot at wide widths, a minor visual addition for the skeptic.
- **Owner rulings kept:**
  - No Delete control on the page (0 matches, menu included).
  - The command-bar breadcrumb reads only "Data Pipelines" (`header-owns-name`).
  - "Run to update" and the strip are unchanged.

### Phase 1: Spec Review — PASS (with a doc nit)

- All ACs hold at the AC width.
- At 1280x800 (dark and light, list 248 or 400): 10 preview rows, no scroll, spine and editor fully in view. **The spine is 282px**, within the ticket's ~270–340px. At 1440 it is 317px.
- Doc nit: the spec delta says that below about 600px the paused chip "collapses to a calendar icon that keeps the 'Paused' marker". The CSS (`PipelineSpineHeader.css`, last `@container (max-width: 600px)` block) hides the icon for a paused chip and shows only the word "Paused". The state is visible either way.
- The design D2 paragraph still reads `clamp(270px, 22vw, 340px)`; only the cycle-5 note records 180px.

### Phase 2: Code Review — PASS

- Gates are green.
- The container query is correctly placed: the header is a descendant of `.pipeline-detail-page--spine`, so it sizes off the page width and works with any context-list width.
- One comment is stale: "After the 1100px block so it wins at <=900px" now precedes a `@container (max-width: 600px)` rule, not media queries.

### Phase 3: UI Review — FAIL

1. **Narrow-desktop regression: spine step titles become unreadable.**
   - Cause: lowering the spine track's minimum from 270px to 180px (`PipelineSpineLayout.css`, `clamp(180px, 22vw, 340px)`). The spine is keyed to **viewport** width (22vw), so it is 180px at any viewport ≤ 818px and below 270px at any viewport < 1227px, regardless of how much room the page actually has.
   - Visible title width (clientWidth / full width, px), measured identically with list 248 and 400, dark and light:

     | Viewport | "Filter rows" | "Sort rows" | Lane row "Limit rows" | "Compute column" |
     |---|---|---|---|---|
     | 769 | 21 / 70 ("F…") | 21 / 64 ("S…") | **1 / 68 (nothing visible)** | 7 / 113 ("C") |
     | 900 | 39 / 70 | 39 / 64 | 19 / 68 | 25 / 113 |
     | 1000 | 61 / 70 | 61 / 64 | 41 / 68 | 47 / 113 |
     | 1100 | 83 / 83 | 83 / 83 | 63 / 68 | 69 / 113 |

   - Evidence: `eval1579c5-dark-769-default.png`, `eval1579c5-light-769-default.png`.
   - In cycle 4 the spine was 270px at these widths and the titles read in full ("Filter rows", "Compute col…").
   - Below about 950px the spine (numbered step rows with title and summary) no longer names its steps. The branch/lane row shows only its number and count, which weakens AC 2/3 ("Branches/lanes are visible and selectable in the spine") at those widths. Rows remain selectable, and the accessible name still carries the label.
   - The sweep does not measure spine content, so it passes over this.
2. At 769px with the list at its 400px maximum the centre column is 133px. Nothing overflows, but the editor and table are cramped (`eval1579c5-dark-769-max.png`). That is a user-chosen extreme, noted only.

Everything else passes:
- Accent audit, focus and state-surface guards, both themes.
- No Delete; breadcrumb not duplicated; phone path unchanged.
- HEL-1585 symptom absent at 1440x900 (`<main>` 852/852).
- Console only shows the pre-existing `404 …/schedule` when no schedule exists.

Evidence (persisted, `/home/matt/Development/helio/.concertino/runs/HEL-1579/evidence/.playwright-mcp/`):
- `eval1579c5-dark-1280.png`
- `eval1579c5-dark-769-default.png`
- `eval1579c5-dark-769-max.png`
- `eval1579c5-light-769-default.png`
- `eval1579c5-light-1280.png`
- `eval1579c5-light-1440.png`

### Overall: FAIL

### Change Requests

1. **Keep spine step titles readable at 769–1100px** (`PipelineSpineLayout.css` grid track; `PipelineSpine.css` row layout).
   - Key the spine's narrowing to the page's own width rather than the viewport. The page is already a size container: use a container-relative track, or a `@container (max-width: 600px)` rule.
   - Floor the track so a trunk row's title shows at least about 10 characters, and a lane row (indented) at least about 6. In practice that is a floor of roughly 230–240px. If needed, drop the row's count to a second line or hide the ⋮ trigger until hover/focus/selected below that width.
   - Extend the sweep: at each width, assert every `.spine-row__title` has `clientWidth >= 60` (or ≥ min(scrollWidth, 60)), in addition to the existing header and editor checks.
   - Show it red on the current CSS: it fails at 769 (21px) and at 900 (39px).

### Non-blocking Suggestions

- Align the spec delta with the paused-chip behaviour below about 600px (the word "Paused", no icon), or keep the icon.
- Update design D2's `clamp(270px, …)`.
- Fix the stale "After the 1100px block" CSS comment.
- `PipelineSpine.tsx` (346 lines) is still over the ~250 soft budget.

### Critical Path (owner's last granted cycle)

**Solid:**
- Every acceptance criterion is verified at the AC width (1280x800) and at 1440, in both themes, with the context list at its default or maximum.
- The data path is solid: no lost edits, persisted RLS-proven per-step counts, the panel-count endpoint.
- The accent discipline is mutation-proven.
- The narrow-desktop header and editor clipping from cycles 3–4 is fixed and guarded by a failable sweep.

**The one remaining defect** was introduced in this cycle: the spine's minimum width dropped to 180px, so between 769 and about 950px the spine's step titles truncate to 1–5 characters, and a lane row shows no title at all. It is CSS-only, and it has a clean, testable fix (CR1).

**Recommendation for the human:**
- **Option 1, accept and merge with CR1 filed as a follow-up.** The defect is limited to sub-950px desktop windows, the rows stay selectable and correctly named for assistive tech, and HEL-1582 will revisit narrow layouts.
- **Option 2, have the orchestrator restore the 270px floor** (cycle 4's value) and accept cycle 4's narrow-header trade-offs instead. This is not recommended: those trade-offs clipped the actions menu.

Option 1 is the lower-risk path.
