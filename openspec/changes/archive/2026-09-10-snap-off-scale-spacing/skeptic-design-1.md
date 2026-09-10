# Skeptic Report — design gate (round 1, skeptic-design-1.md)

## What I verified (with evidence)

**Scanner methodology — reproduced independently, sound.**
Ran the committed `spacing-scan.js` myself from `frontend/src` on the same base
(`git log -1` = `58855835`, worktree clean apart from the change dir):

- raw hits 167 (+11 multiline flags); after excluding the 55 `1px`/`2px`/`3px`
  (≤4px optical-tweak allowance) and the 10 `em` relative values →
  **exactly 102 literals across exactly 18 files**, and the by-value multiset
  `6px×39, 10px×32, 14px×12, 5px×9, 7px×8, 60px×1, 30px×1` matches
  `enumeration.md` line for line. The count and the file list are real.
- Token values read from `frontend/src/theme/theme.css:43-52` — the scanner's
  derived `{1:4 … 10:64}` is correct.
- I checked the two claims the design makes about scanner blind spots:
  - all 11 `MULTILINE-DECL-NEEDS-MANUAL-CHECK` flags are comment prose
    (dumped and read each one) — design.md's claim holds;
  - **0 of the 102 hits sit on a comment line** (tested `raw` against
    `/^\s*(\*|\/\*)/`) — no comment-derived false positives.
- One real blind spot the design does not mention (non-blocking, see Note 1).

**HEL-680 reconciliation — verified against HEL-680 itself, consistent.**
Pulled the live issue. It is `Backlog`, re-scoped 2026-08-25, and explicitly
offers two orderings: *"Either this ticket lands first and HEL-830 excludes the
chip sites, or HEL-830 lands first and this one only introduces the alias."*
design.md picks the second, changes literals only, and adds no
`--chip-padding` property — exactly HEL-680's sanctioned option. HEL-680 also
warns that `7px → 4px` (not `8px`) risks the touch-target floor; design.md
snaps `7px → 8px` uniformly, honouring that. **No revision needed here.**

**Snapping policy — sound and genuinely non-blanket.** Nearest-step default
with per-context override + inline justification matches the ticket's
"judgement call per context, not a blanket rounding rule". The `6px` split
(chip/badge horizontal → 8px, dense inline clusters → 4px, mixed-axis recipes
→ 4px) and the equidistant-14px sibling-consistency rule are real reasoning,
not cover. Two defects in the *scoping* of that per-context rule are below (CR4).

**Guard + e2e ground truth I read directly:**
- `frontend/src/theme/tokenAuditSweep.css.test.ts` — `SPACING_BASELINE` (62
  entries, file+line), `SWEPT_FILES` (9 files), `SPACING_PATTERN` (L131) and
  `spacingIsDisallowed = (line) => !line.includes("var(--space")` (L132), plus
  the two generated tests (`no unexpected hit`, `baseline isn't stale`, L110-123).
- `e2e/hel813-mobile-touch-target-floor.spec.ts` — enumerated its 7 covered
  surfaces via its `goto()`/`test()` calls.
- `e2e/support/touchTargetProbe.ts:15` `DEFAULT_MIN_PX = 44`, documented as
  importable by ad-hoc specs, not only the steady-state guard.
- `PipelineDetailPage.css:449-457,1108-1118,1226-1236` and
  `OutputsRail.css:12-18` read in full.

## Verdict: REFUTE

The re-derivation and the HEL-680 reconciliation are correct. The two
*verification* legs of the ticket — the baseline shrink (AC4) and the
touch-target check (AC5) — are specified in a way that measurement shows will
not do what the ACs require. Four required revisions.

## Change Requests

1. **`tasks.md` step 4 mandates the exact offset arithmetic this test file was
   already burned by. Require a from-scratch re-derivation instead.**
   Step 4 says "remove every snapped file+line". But `tasks.md` step 2 /
   `design.md` also mandate an **inline CSS comment** for every non-nearest snap
   and every kept exception. Each inserted comment line shifts every subsequent
   line number in that file, invalidating downstream `SPACING_BASELINE` entries
   — and 42 of the 62 entries are in `PipelineDetailPage.css` alone, the file
   taking ~50 of the 102 edits. The test file's own header
   (`tokenAuditSweep.css.test.ts:137-143`) records that HEL-442 and HEL-732 hit
   exactly this and had to re-derive "rather than composed from prior line-shift
   arithmetic — no single prior offset is valid". A shifted entry can also land
   coincidentally on another real hit line and pass the `baseline isn't stale`
   test while being wrong. Revise step 4 to: after all CSS edits are complete,
   regenerate `SPACING_BASELINE` from scratch by running the test file's own
   `SPACING_PATTERN` + `spacingIsDisallowed` over `SWEPT_FILES`, and diff the
   regenerated list against the current 62 as the reviewable artifact.

2. **State the baseline's actual scope — as written, "the baseline shrinks
   accordingly" is unverifiable and invites deleting entries that must stay.**
   I measured the three disjoint categories the artifacts collapse into one:
   - worklist = **94 distinct lines** (102 literals; several lines carry two,
     e.g. `padding: 7px 10px`), of which only **52 are baseline entries**;
   - **42 worklist lines are not baseline entries.** 20 of those are inside
     `SWEPT_FILES` but invisible to the guard because `spacingIsDisallowed`
     excludes any line containing `var(--space` — e.g.
     `PipelineDetailPage.css:1619 padding: 6px var(--space-2)`,
     `:462 margin: var(--space-2) 0 0 14px`, `PipelineDetailHeader.css:25`,
     `SourceDetailPanel.css:112/155/203`. The remaining 22 are in the **10 of
     18 worklist files that are not in `SWEPT_FILES` at all**;
   - **10 existing baseline entries are NOT in the worklist** (≤4px residual
     etc.) and **must remain**.
   Record these numbers in `design.md` with the expected post-change entry count
   (≈10 + genuinely-kept exceptions), so the shrink is a checkable prediction
   rather than "accordingly".

3. **AC5's HEL-813 check is evidence-shaped non-evidence for the surfaces this
   ticket actually changes.** `e2e/hel813-mobile-touch-target-floor.spec.ts`
   covers exactly 7 surfaces: mobile nav sheet/command bar, `/settings` swatch
   row, toast dismiss, `/sources` empty-state CTA, `/pipelines` ui-select
   trigger, dashboard panel-list zoom, `/connectors`. **None of them is** the
   pipeline *detail* page, `PanelDetailModal`, `DashboardList`,
   `SourceDetailPanel`, `RunHistoryModal` or `AddSourceModal` — where ~90 of the
   102 literals live, including padding *reductions* on interactive controls:
   `PipelineDetailPage.css:1114` and `:1231`
   (`height: var(--control-md); padding: 0 14px` — save/cancel and dry-run
   buttons, 14→12 narrows them), `:751/:765/:1051` `padding: 4px 10px`,
   `:1393/:1484` `padding: 5px 10px`, and the `2px 7px` chips. Running the
   existing suite green says nothing about any of these. Add a task that
   measures the changed interactive controls directly with
   `e2e/support/touchTargetProbe.ts` at 430px and 768px, or state per control
   family why the 44px floor does not apply to it — do not let a green
   pre-existing suite stand in for the measurement.

4. **The `14px` values are a deliberate cross-FILE coupled cluster; the design's
   "siblings in the same component" rule is the wrong granularity and will break
   it, and leaves two comments false.** HEL-1022 deliberately aligned a shared
   left edge across two files, documented verbatim: `OutputsRail.css:12-18`
   ("the header/body above and below it both use `14px` … matched here so every
   row in the card shares one left inset, which is also what lets
   `BranchAffordance` … share this exact left edge") and
   `PipelineDetailPage.css:449-457` ("`14px` matches the card's own left inset
   … and `OutputsRail.css`'s matching `padding: 0 14px` so both affordances
   share one left edge"). Members: `OutputsRail.css:18`,
   `PipelineDetailPage.css:462`, plus the step-card header/body 14px sites.
   Per-site judgment can legitimately send one to 12px and another to 16px and
   silently destroy that alignment. Required: (a) name this cluster in
   `design.md` and require **one shared target step for all its members**,
   decided once; (b) add a task to update both explanatory comments — they
   assert `14px` verbatim and become confidently-false documentation the moment
   the value changes. Note `PipelineDetailPage.css:1114/:1231` are *button*
   padding, not part of this cluster — they may snap independently.

## Non-blocking notes

1. `spacing-scan.js` uses `line.match(...)` without `/g`, so only the **first**
   `margin|padding|gap` declaration on a line is examined. I grepped the tree
   for lines carrying two such declarations: exactly one exists
   (`PipelineDetailHeader.css:18`) and it is a comment, so today's 102 is
   unaffected. But `tasks.md` step 1 re-runs this scanner against a possibly
   moved base, inheriting the blind spot. Cheap fix: `matchAll`.
2. `design.md`'s recorded command says
   `node /tmp/scan-spacing.js   # committed as scripts/spacing-scan.js` — the
   script is actually committed at
   `openspec/changes/snap-off-scale-spacing/spacing-scan.js`, and `/tmp` is not
   reproducible. AC1 requires the command be *recorded*; record the real path.
3. `design.md` says "102 off-scale literals" while the baseline counts *lines*.
   Keeping the two units explicitly distinct would prevent a miscount in review.
