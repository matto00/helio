# Design: Snap off-scale spacing literals (HEL-830)

## Scanner (corrected methodology)

Reused HEL-439's fix for the value-after-colon regex miss: for every CSS
declaration matching `(margin|padding|gap)(-[a-z]+)?:\s*([^;]+);`, take the
full body up to `;`, strip every `var(--space-N)` occurrence, then scan the
remainder for literal `px`/`rem`/`em`/`%` values. A value is "off-scale" if
its px-equivalent is > 4px (outside the documented ≤4px optical-tweak
allowance) and does not exactly equal one of the `--space-*` token values
(`--space-1`=4, `-2`=8, `-3`=12, `-4`=16, `-5`=20, `-6`=24, `-7`=32, `-8`=40,
`-9`=48, `-10`=64, read from `theme/theme.css`).

Run against current `main` (commit `58855835`):

```
cd frontend/src && node ../../openspec/changes/snap-off-scale-spacing/spacing-scan.js
```

(Script committed at `openspec/changes/snap-off-scale-spacing/spacing-scan.js`.)

**Known scanner limitation (non-blocking, tracked):** the line-matching regex
uses `.match()` without `/g`, so only the *first* `margin|padding|gap`
declaration on a line is examined. A tree-wide check found exactly one line
with two such declarations (`PipelineDetailHeader.css:18`), and it is a
comment — today's 102/18 count is unaffected. The executor MUST re-run this
check (`grep -c` for lines with 2+ matches of the pattern) against its own
base before trusting the count, since `tasks.md` step 1 re-runs the scanner
against a possibly-moved base that could introduce a real double-hit line.

11 lines were flagged by the line-based scanner as "no semicolon on this
line" (potential multi-line declarations); manual inspection confirmed every
one is a code *comment* containing the words `margin:`/`padding:`/`gap:` in
prose (e.g. `PipelineDetailPage.css:68` — a comment about `gap: 0`), not an
actual multi-line declaration. No real declaration was missed by the
line-based approach.

## Reconciliation against HEL-439's 119

**Result: 102 off-scale literals across 18 files** (vs. HEL-439's 119/20).
This is a real, reconciled reduction — not the same set re-measured:

- HEL-909 deleted `features/dataTypes/**`, `features/metrics/**`, and
  `features/pipelines/ui/computedFields/**` outright (confirmed by
  `tokenAuditSweep.css.test.ts`'s own HEL-909 comment on `SWEPT_FILES`) —
  some of HEL-439's original 119 count lived in those now-deleted files.
- The 10 rem-outlier entries from HEL-439's table (`0.375rem`×3, `0.4rem`×2,
  `0.35rem`×2, `0.3rem`×2, `0.4375rem`×1) and the `18px`×2 entries do not
  appear in the current re-scan — either fixed by an intervening ticket or
  in a deleted file. Not independently traced further; the current mechanical
  scan is authoritative for this ticket's worklist regardless of cause.
- 6px count: 39 (was 41). 10px count: 32 (was 33). 14px: 12 (unchanged).
  7px: 8 (was 10 — 2 of HEL-439's 7px sites are gone). 5px: 9 (unchanged).
  30px: 1 (unchanged, `DashboardList.css`, now at line 68). 60px: 1
  (unchanged, `PipelineDetailPage.css`, now at line 130).

Full enumeration: `enumeration.md` in this change dir.

**Unit note:** "102" throughout this document counts distinct off-scale
*literals* (some declarations carry two, e.g. `padding: 7px 10px` = 2
literals on 1 line). The worklist occupies **94 distinct lines**. The
`SPACING_BASELINE` guard is keyed by file+line, not by literal — see
"Baseline scope" under Verification plan for why these two units diverge and
why that matters for the regeneration step.

## Snapping policy

Default: snap to the **mathematically nearest** scale step. Override only
with a stated visual reason (recorded as an inline CSS comment directly
above the changed declaration):

- **5px → 4px** (`--space-1`) in every occurrence found — all are small
  gaps/margins in dense contexts (list rows, form rows), consistent with
  the nearest-step default and no site argues for 8px.
- **6px → 4px or 8px**, per-context:
  - `padding: 2px 6px` / `padding: 1px 6px` (badge/chip horizontal padding)
    → **8px** (`--space-2`) — chip/badge padding reads as compressed at 4px;
    matches the existing `2px 7px→2px 8px` sibling recipe.
  - `gap: 6px` between tightly-grouped inline controls (icon+label rows,
    toolbar clusters) → **4px** (`--space-1`) — these are dense clusters
    where 8px reads as loose.
  - `padding: 6px var(--space-2)` (vertical 6px, horizontal already 8px) →
    **4px** vertical — keeps the recipe visually balanced against its own
    horizontal value rather than inflating both axes.
  - Executor records the specific reasoning per site as it applies each one;
    this document sets the default policy, not an exhaustive per-line
    ruling — every deviation from "nearest mathematically" gets an inline
    comment.
- **7px → 8px** (`--space-2`) in every remaining occurrence — no site's
  content argues for 4px (7 is already closer to 8 than 4).
- **10px → 8px or 12px**, per-context: dense contexts (row padding inside
  compact lists/tables, small gaps) → 8px; standalone container
  padding/gaps with more visual weight → 12px. Executor judges per site.
- **14px → 12px or 16px**, per-context: 14 is equidistant from 12 and 16 —
  judge by whether the site already pairs with `--space-3`(12)/`--space-4`(16)
  siblings in the same component for visual consistency.
- **30px → 32px** (`--space-7`) — nearest step, no exception found.
- **60px → 64px** (`--space-10`) — nearest step, no exception found.

### Coupled cluster: the `14px` shared-left-edge group (must snap together)

`14px` is not 12 independent equidistant judgment calls. HEL-1022 deliberately
aligned a shared left edge across two files, documented verbatim in both:

- `OutputsRail.css:12-18` — "the header/body above and below it both use
  `14px` … matched here so every row in the card shares one left inset, which
  is also what lets `BranchAffordance` … share this exact left edge."
- `PipelineDetailPage.css:449-457` — "`14px` matches the card's own left
  inset … and `OutputsRail.css`'s matching `padding: 0 14px` so both
  affordances share one left edge."

**Cluster members** (must all resolve to the *same* target step, decided
once): `OutputsRail.css:18`, `PipelineDetailPage.css:462`, and the
step-card header/body `14px` sites the two comments describe. Target: **16px**
(`--space-4`) — closer to the cluster's evident intent (a card-level inset,
not a dense-control gap) than 12px, and it's the step already used by
several sibling card paddings in the same file family. Both explanatory
comments (`OutputsRail.css:12-18`, `PipelineDetailPage.css:449-457`) MUST be
updated to say `16px` wherever they currently assert `14px` verbatim, or they
become confidently-false documentation the moment the value changes.

**Not cluster members** — snap independently per the per-context table
above: `PipelineDetailPage.css:1114`/`:1231` (`height: var(--control-md);
padding: 0 14px` — save/cancel and dry-run *button* padding, unrelated to
the shared-edge alignment; judge each against its own control density), and
`PanelDetailModal.appearance.css:53` / `PanelDetailModal.binding.css:6`
(padding-top / gap, no left-edge relationship to the OutputsRail/
PipelineDetailPage cluster).

## HEL-680 reconciliation

HEL-680's own description (re-scoped 2026-08-25, read before this design was
written) already resolves the overlap: this ticket (HEL-830) snaps every
`7px`/`6px` chip-padding literal (`padding: 2px 7px`, `padding: 2px 6px`,
`padding: 1px 6px`) to a scale step. HEL-680 remains scoped *only* to adding
a semantic `--chip-padding` alias composed of the already-snapped scale
tokens (e.g. `var(--space-1) var(--space-2)`) — no raw-px token. This
ticket does not introduce any new named token; HEL-680 is left to do that on
top of this ticket's snapped values. No double-fix: this ticket changes the
literal values only, never adds a `--chip-padding` custom property.

## Verification plan

### Baseline scope (exact, measured — not "shrinks accordingly")

The worklist and the guard's `SPACING_BASELINE` are **not** the same set.
Measured against the current guard (`tokenAuditSweep.css.test.ts`):

- Worklist: 102 off-scale **literals**, occupying **94 distinct lines**
  (several lines carry two literals, e.g. `padding: 7px 10px`).
- Of those 94 lines, only **52** are currently `SPACING_BASELINE` entries.
  The other **42 are NOT baseline entries today**, for two disjoint reasons:
  - **20** are inside `SWEPT_FILES` but invisible to the guard because
    `spacingIsDisallowed = (line) => !line.includes("var(--space")` — the
    line already contains a `var(--space-N)` reference alongside the literal
    (mixed-axis shorthand), e.g. `PipelineDetailPage.css:1619 padding: 6px
    var(--space-2)`, `:462 margin: var(--space-2) 0 0 14px`,
    `PipelineDetailHeader.css:25`, `SourceDetailPanel.css:112/155/203`.
  - **22** are in the **10 of 18 worklist files that are not in
    `SWEPT_FILES` at all** (`SWEPT_FILES` only covers 9 of the 18 files this
    ticket touches) — the guard has never checked these lines and gains no
    new coverage from this ticket unless `SWEPT_FILES` is extended (out of
    scope here; the guard's own file list is HEL-439's, not this ticket's to
    grow).
- **10 existing `SPACING_BASELINE` entries are NOT in this ticket's worklist**
  (the ≤4px optical-tweak residual and similar) and **must remain** —
  deleting them would be a false "fix" of literals this ticket never touches.

**Expected post-change entry count is a checkable prediction, not a vibe:**
≈10 (untouched residual) + however many of the 52 in-baseline sites end up
*kept* as documented exceptions (target: 0, per AC "documented exceptions
carry an inline reason" being the rare case, not the default) + any of the
20 var(--space)-adjacent sites whose companion literal in the same line was
snapped but the line still needs a baseline entry for its own reason.
Regenerate the baseline from scratch per the procedure below rather than
predicting the exact final number in advance — the prediction above is a
sanity check on the regenerated result, not a target to hand-edit toward.

### Baseline regeneration procedure (no line-shift arithmetic)

CSS edits in this ticket insert inline comments (for every non-nearest snap
and every kept exception), which shifts every subsequent line number in that
file — `PipelineDetailPage.css` alone carries 42 of the 62 current baseline
entries and ~50 of the 102 edits. HEL-442 and HEL-732 already hit this exact
failure (`tokenAuditSweep.css.test.ts:137-143`) and had to re-derive from
scratch rather than composing prior offsets. This ticket does the same:
**after all CSS edits are complete**, regenerate `SPACING_BASELINE` by
running the test file's own `SPACING_PATTERN` (`/(margin|padding|gap)(-[a-
z]+)?:\s*[0-9.]+(px|rem|em|%)/`) and `spacingIsDisallowed` predicate against
`SWEPT_FILES` fresh, and diff the regenerated list against the current 62
as the reviewable artifact (never hand-adjust old line numbers).

### Touch-target verification (measured, not inferred from a green pre-existing suite)

`e2e/hel813-mobile-touch-target-floor.spec.ts` covers exactly 7 surfaces
(mobile nav sheet/command bar, `/settings` swatch row, toast dismiss,
`/sources` empty-state CTA, `/pipelines` ui-select trigger, dashboard
panel-list zoom, `/connectors`) — **none of which is a page this ticket
touches.** ~90 of the 102 literals live in `PipelineDetailPage.css`,
`PanelDetailModal.*.css`, `DashboardList.css`, `SourceDetailPanel.css`,
`RunHistoryModal.css`, `AddSourceModal.css`, including padding *reductions*
on interactive controls (`PipelineDetailPage.css:1114`/`:1231` — save/cancel/
dry-run buttons; `:751`/`:765`/`:1051`/`:1393`/`:1484` — chip-like controls;
the `2px 7px`/`2px 6px` chips generally). Running the existing 7-surface
suite green is evidence-shaped non-evidence for these — it measures nothing
this ticket changed. Required: import
`e2e/support/touchTargetProbe.ts` directly in an ad-hoc measurement pass
(it is documented as importable outside the steady-state guard) against
every interactive control whose horizontal or vertical padding this ticket
reduces, at 430px and 768px, before and after. Any control found under 44px
post-snap gets a less-aggressive target step for that specific site (e.g.
6px→8px instead of →4px) rather than accepting the regression.

- `npm test` — full suite, plus explicit `--testPathPattern=tokenAuditSweep`.
- Playwright screenshots (desktop 1280px, 430px, 768px) for each of the 18
  touched files' representative surface, before and after, stored under
  `.concertino/runs/HEL-830/evidence/screenshots/` (never repo root).
- `npm run lint` / `npm run typecheck` / `npm run format:check` clean (CSS
  changes don't affect TS, but run for hygiene per repo convention).

## Gate-Chain Implications Checklist

Not applicable — this change touches only `frontend/src/**/*.css` and test
baseline data; it does not modify `.husky/**` or any script invoked by
`.husky/pre-commit`.
