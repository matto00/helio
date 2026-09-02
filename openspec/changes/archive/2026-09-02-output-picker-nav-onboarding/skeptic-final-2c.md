## Skeptic Report — final gate (round 2, skeptic-final-2c.md)

Axis: **migration completeness / deletion hygiene / spec accuracy** (round-1 report:
`skeptic-final-1c.md`, REFUTE with 3 CRs + 1 non-blocking note). Sibling skeptic owns the
frontend UX/DESIGN.md axis in parallel. Commit reviewed: `52222878`; worktree clean.

*Filename note:* `next-report-number.sh` returned `number=1` (it does not model the
`1a/1b/1c` per-axis suffix convention this fan-out uses, so it saw no `skeptic-final-<n>.md`).
I used the orchestrator-specified `skeptic-final-2c.md`, verified collision-free by `ls`
(no `skeptic-final-2*` existed), and persisted with `--no-clobber`.

### What I verified (with evidence)

#### CR1 — panel-detail-modal's false tab-structure claim: **FIXED, and the correction is accurate**
`git show 52222878 -- specs/panel-detail-modal/spec.md`: the ADDED requirement's content-panel
clause now reads "*like every other panel kind, they render a single unified edit form
(Appearance section plus a kind-specific section …) with no tab bar at all. This was already
true before this change (there was never a tab bar for any panel kind)*". The scenario is
renamed "Content panel keeps its unified, tab-free edit form" with a matching THEN ("no tab
bar and no 'Data' tab"). Both REMOVED-requirement `**Migration**`/`**Reason**` notes were also
corrected — the first now says the two-tab structure "no longer existed for any panel kind even
before this change shipped" and adds "Content-kind panels never had a tab bar either".
Re-verified against ground truth, not the executor's narrative:
`grep -rni "tablist|role=\"tab\"|activeTab" frontend/src/features/panels/ui/detailModal/`
returns **only** test-side negative assertions —
`PanelDetailModal.test.tsx:125,141,173,201,215`, all `queryByRole("tablist")).not.toBeInTheDocument()`.
Zero tab markup in any component file. The corrected text matches shipped behavior exactly.

#### CR2 — nav-order/label mismatch: **FIXED across all three specs, matches shipped code**
Corrected in `nav-section-registry/spec.md` (both the requirement sentence and the
"Nav-visible entries match the registry" scenario), and — as the executor claimed and I
verified independently from the diff — also in `mobile-bottom-nav/spec.md` and
`first-run-onboarding/spec.md` (requirement + "Closing copy names all five destinations"
scenario), plus `design.md`'s closing-copy line. All five now read
**Dashboards, Data Sources, Data Pipelines, Connectors, Assistant**.
Ground truth re-confirmed at this commit: `sections.ts` `showInNav: true` entries in array
order are `/` "Dashboards" (:46-51), `/sources` "Data Sources" (:54-58), `/pipelines`
"Data Pipelines" (:61-65), `/connectors` "Connectors" (:71-75), `/chat` "Assistant" (:78-86).
Sweep for residue: `grep -rn "Pipelines, Sources" openspec/changes/output-picker-nav-onboarding/`
returns **zero** hits outside the historical skeptic/evaluation reports. No stale ordering
survives in any artifact that gets archived into `openspec/specs/**`.

#### CR3 — three stale-precedent comments: **all three actually corrected**
Read at the cited locations in the diff, not merely "file touched":
- `e2e/README.md:4` — worked example now `hel909-output-picker-panel-sheet.spec.ts`.
- `e2e/hel716-panel-detail-tall-viewport-footer.spec.ts:23` — "Mirrors
  e2e/hel909-output-picker-panel-sheet.spec.ts's pattern".
- `e2e/hel773-top-anchored-mobile-nav-sheet.spec.ts:8` — same repoint.
Repo-wide `grep -rn "hel716-panel-creation-focus-trap"` now returns hits **only** in this
change's own workflow artifacts (proposal/tasks/ticket/files-modified/skeptic-final-1c, which
correctly document the deletion) and in two pre-existing `openspec/changes/archive/**`
records — no live code or doc cites the deleted file as a precedent.

#### Non-blocking note — AC-grep count: **updated, and 32 re-verified at this commit**
`design.md`'s "Scope boundary" now says "32 at the final gate … the exact count moves slightly
cycle to cycle as adjacent files change; record the PR-body figure fresh rather than trusting
this historical snapshot" — a better fix than a bare number swap. I re-ran the grep myself at
`52222878`: `grep -rn "dataTypeId\|metricId\|/registry\|/metrics\|fetchDataTypes\|dataTypesSlice\|metricsSlice" frontend/src | wc -l`
→ **32**, unchanged. Still accurate.

#### Round-1 CONFIRMs — light-touch regression re-check (all hold)
- **Deletions still real:** `frontend/src/features/` contains no `dataTypes` or `metrics`
  directory; `find` for `PanelCreationModal.tsx`/`MetricPicker.tsx`/`DataTypePicker.tsx` → 0.
- **`/registry` + `/metrics` still gone:** `grep -n "registry\|metrics" frontend/src/app/AppRoutes.tsx`
  → no match (route table unchanged this cycle; round 1 confirmed the live NotFound render).
- **HEL-937 absorption contract unchanged:** `PanelDetailModal.tsx` still
  `panel.config.outputId` (:67) → `useOutputMeta` (:68) → `listOutputPanels` (:74) → Output link
  (:96); still zero `capabilities` references in `features/panels`.
- **`tasks.md`:** zero unticked items.

#### Side-effect check on the new listbox markup (specifically requested)
The executor's claim that the e2e spec was updated for the new roles is **true and verified**:
`e2e/hel909-output-picker-panel-sheet.spec.ts` now uses `getByRole("option", …)` at :119, :165,
:194, :235-236, and adds a dedicated test at :212 for the listbox/`aria-activedescendant`/
scroll-into-view behavior. No surviving assertion targets picker cards as `role="button"` (the
remaining `getByRole("button")` uses are "Dashboard actions", "Edit panel", "Swap output" —
genuine buttons, unaffected). I also checked the obvious hazard of two `role="listbox"`
containers (Outputs + Content) both comparing a local index against one `focusedIndex`:
they don't — both derive a **global** index from `outputIndexById`/`contentIndexByKind` built
over the shared `flatItems`, so exactly one option is ever `aria-selected`.
The new `PanelDetailModal.binding.css` is genuinely wired (`PanelDetailModal.tsx:6` imports it),
not a dead file.

#### Gates re-run fresh by me (all PASS at `52222878`)
| Gate | Result |
|---|---|
| `npx openspec validate output-picker-nav-onboarding --type change` | `Change 'output-picker-nav-onboarding' is valid` |
| `npm run check:openspec` | `openspec/ is clean` |
| `npx tsc --noEmit -p frontend/tsconfig.json` | clean, exit 0 |
| `npx eslint src --max-warnings=0` | clean, exit 0 |
| `npx jest` | **252 suites / 2590 tests passed** (was 2589; +1 from the new keyboard-nav unit test) |

### Verdict: CONFIRM

All three round-1 change requests were fixed at the substance level, not merely touched, and
each correction is independently verified against ground truth (code, tests, greps) rather than
against the executor's report. The nav-order fix went further than requested (three specs +
design.md, no residue anywhere). Nothing I confirmed in round 1 regressed, and the frontend
listbox/CSS changes introduced no stale-locator or duplicate-selection side effect on this axis.

### Non-blocking notes
- `aria-activedescendant` lives on the search input while the options are split across **two**
  sibling `role="listbox"` containers with no `aria-controls`/`role="combobox"` linkage. It works
  and tests green; strict ARIA authoring would prefer one listbox (or a combobox+`aria-controls`).
  Frontend-axis polish, deferrable — flagging for the sibling skeptic, not blocking here.
- `ticket.md`'s Scope bullet still carries the old informal "Pipelines, Sources" ordering.
  `ticket.md` is not archived into `openspec/specs/**`, so this is cosmetic only.
- Carried forward from round 1: the PR body should record the **32**-hit figure and its 17-file
  list, per design.md's own instruction.
