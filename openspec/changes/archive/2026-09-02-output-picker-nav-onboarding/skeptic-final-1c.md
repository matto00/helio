# Skeptic Report — final gate (round 1, skeptic-final-1c.md)

Axis: **migration completeness / deletion hygiene / spec accuracy**.
(Sibling skeptics own backend data-integrity and frontend UX/DESIGN.md; not covered here.)
Commit reviewed: `2913739b`. Worktree clean except the untracked `evaluation-4.md`.

## What I verified (with evidence)

### 1. Final AC grep — re-run, fully categorized (PASS, with a stale count in design.md)

`grep -rn "dataTypeId\|metricId\|/registry\|/metrics\|fetchDataTypes\|dataTypesSlice\|metricsSlice" frontend/src`
→ **32 hits across 17 files**. Zero hits for `fetchDataTypes`, `dataTypesSlice`, `metricsSlice`.
Token split: `dataTypeId` 22 · `metricId` 2 · `/metrics` 7 · `/registry` 5.

Full categorization (every hit accounted for):

| Category | Count | Files |
|---|---|---|
| Proposal/patch-set `dataTypeId` **wire-field mirror** (the documented exception) | 21 | `dashboards/types/proposal.ts`, `dashboards/ui/ProposalReview{,Page}.tsx` + `.test.tsx`, `proposals/ui/CombinedProposalReview{,Page}.tsx` + tests, `proposals/state/combinedProposalsSlice.test.ts`, `assistant/ui/ProposalHandoff.test.tsx`, `dashboards/services/outputsService.ts` (comment) |
| **Negative-assertion** test literals (assert the retired thing is gone) | 7 | `shared/chrome/sections.test.ts` (6), `shared/chrome/navDestinations.test.ts` (1) |
| **Historical doc comments** (name the retired concept to explain its removal) | 4 | `theme/tokenAuditSweep.css.test.ts`, `panels/types/panel.ts`, `panels/state/panelPayloads.ts`, `shared/ui/StatusChip.tsx` |

**No hit is a live use of a retired concept.** The exception's *nature* is verified, not
assumed: `backend/.../proposals/DashboardProposalProtocol.scala:17` really does still define
`dataTypeId: Option[String]` on the wire (and serializes/parses it at :69/:93), so the
frontend mirror is genuinely backend-anchored and a frontend-only rename would break the wire.
The exception is legitimate.

**But the count in design.md is stale.** design.md's "Scope boundary" section says "~47 hits"
(the orchestrator brief said ~80); the true figure at this commit is **32**. design.md's own
instruction is to "record the exact remaining count and file list in the PR body" — so the
number that matters is the PR-body one, not this historical snapshot. Non-blocking, but the
PR body must carry **32**, not 47/80.

### 2. Deletions are real on disk, not merely unreferenced (PASS)

`find frontend/src -name "*<file>*"` for every Axis A and Axis B target. **Genuinely absent
from disk**: `features/dataTypes/**`, `features/metrics/**`, `PanelCreationModal.tsx`,
`creationSteps/`, `PanelCreationPreview.tsx`, `panelTemplates.ts`, `ComputedFieldForm`,
`ComputedFieldsEditor`, `BindingEditor.tsx`, `MetricPicker.tsx`, `DataTypePicker.tsx`,
`CollectionEditor.tsx`, `TimelineEditor.tsx`, `MetricBindingFields.tsx`,
`useMetricBindingState.ts`, `TypeRegistryPage.tsx`, `TypeDetailPage.tsx`,
`TypeDetailPanel.tsx`, `TypeListTable.tsx`, `MetricsPage.tsx`, `MetricDetailPage.tsx`,
`CreateMetricModal.tsx`, `MetricEditorForm.tsx`, `MetricListTable`, `AllowedDimensionsPicker`,
`fieldOptions.ts`.

Three files the brief listed as Axis B **survive, correctly**:
- `useBoundOrLiteralState.ts` / `BoundOrLiteralField.tsx` — Axis B is explicitly *"delete once
  orphaned"*, and these are **not** orphaned: `pipelines/ui/outputEditor/OutputEditorSheet.tsx:34-35`,
  `OutputKindFields.tsx:18-19`, `buildOutputConfig.ts:8` are live importers (P1.5's Output
  authoring). design.md's own caution — "don't delete a hook the Output editor itself depends
  on" — applies. Retention is right.
- `TextContentEditor.tsx` / `MarkdownEditor.tsx` — retained but **bound mode stripped** exactly
  as design.md resolved: both are now 68 lines, header comment "literal-only — the Source/bound
  … carries no Output", zero `dataTypeId`/`selectPipelineOutputDataTypes` references.

No live import of any deleted file survives: `npx tsc --noEmit` is clean (a dangling import
could not compile), and `eslint src --max-warnings=0` is clean.

### 3. `/registry` and `/metrics` are gone, not stubbed (PASS — live)

Servers asserted from this commit (`assert-phase.sh servers` → `PASS servers`).
- `http://localhost:6341/registry` → renders the shared `NotFoundPage`: "Page not found /
  That page doesn't exist or may have moved. / Back to dashboards". URL unchanged (no redirect).
- `http://localhost:6341/metrics` → byte-identical NotFound rendering, URL unchanged.
- `AppRoutes.tsx` has no `/registry`, `/registry/:id`, `/metrics`, `/metrics/:id` route at all;
  `sections.ts:11` `PickerId = "dashboards" | "sources" | "pipelines" | "chat" | "other"` —
  the `registry`/`metrics` union members are gone. Decision 11 satisfied.

### 4. HEL-937 absorption complete, on the settled contract (PASS)

`PanelDetailModal.tsx`'s `OutputPanelSection` (lines 62-125) uses exactly the design-settled
contract: `panel.config.outputId` (:67) → `useOutputMeta(outputId)` (:68, which calls
`getOutputById` = `GET /api/outputs/:id`) → `listOutputPanels(outputId)` (:74,
`GET /api/outputs/:id/panels`) for the placement note. It renders the Output link
(`/pipelines/${output.pipelineId}?outputId=${output.id}`), "Swap output", and
"Used on N dashboards" (correctly de-duplicated to *distinct dashboards* via
`new Set(placements.map(p => p.dashboardId))`, :80).
**No `capabilities` call anywhere in `features/panels`** — the only `capabilities` references
in the tree are inside `features/pipelines/ui/outputEditor/*`, which is the correct owner.

### 5. Spec-accuracy spot-check — 6 deltas, 2 defects found

Checked (different from evaluation-4's three): `first-run-onboarding`, `nav-section-registry`,
`mobile-bottom-nav`, `panel-detail-modal`, `markdown-panel-content-source`,
`panel-config-field-or-literal-pattern`, plus re-checks of `output-picker`,
`mobile-dashboard-sheet`, `text-panel-content-source`, `frontend-panel-creation`.

Accurate:
- `first-run-onboarding` — verified against `OnboardingChecklist.tsx`: exactly three steps
  ("Connect a data source" / "Shape it into outputs" / "Place them on a dashboard"), glyphs via
  `navGlyph("/sources"|"/pipelines"|"/")` from the registry (:38-40), closing lede naming all
  five destinations (:119). The Done-button **computed-style** guard is real:
  `OnboardingChecklist.test.tsx:381-405` uses `getComputedStyle` *and* has a
  deliberately-broken-cascade arm (regex-blanking `.onboarding-checklist__done--primary`).
- `output-picker` — the previously-defective live-thumbnail MUST is now a documented deferral
  with a stated reason. Implementation verified live: grouping by pipeline, kind + name +
  "N placements" + "On this board", content row (Text/Markdown/Image/Divider),
  arrow/Enter handling (`OutputPicker.tsx:135-141`), "New pipeline"/"Ask the assistant"
  escape hatch (:207-211).
- `markdown-panel-content-source`, `text-panel-content-source`,
  `panel-config-field-or-literal-pattern` (REMOVED-only) — match the stripped editors.
- `mobile-dashboard-sheet` — Assistant create action really is wired:
  `useCreateConversationAction` ("New chat") → `usePickerSelection.ts:88` → `MobileShell.tsx:39`
  `createAction` → `MobileNavSheet`.
- `frontend-panel-creation`, `mobile-bottom-nav` — accurate.

Two false assertions found — see Change Requests 1 and 2.

### 6. E2E coverage (PASS on substance)

`git diff --stat main...HEAD -- e2e/`: `hel399-shape-instantiate.spec.ts` **deleted** (131 lines),
`hel716-panel-creation-focus-trap.spec.ts` **deleted** (85 lines), `hel666` and `hel773`
rewritten, `hel909-output-picker-panel-sheet.spec.ts` **added** (211 lines). No surviving e2e
file references a retired concept as live behavior (`/registry`, `/metrics`, `dataTypeId`,
`PanelCreationModal` appear only inside HEL-909 explanatory comments).

I read `hel909-output-picker-panel-sheet.spec.ts` in full: it genuinely exercises the core flow
end to end — real register/login, real API seeding of source → pipeline → two chart Outputs,
then kebab → "Add panel" → picker dialog → search "throughput" → **Enter** → panel on the grid
→ open sheet → assert title/appearance/Output link/Swap output → **Swap** to "Latency" and
assert the link updates. Plus the picker as the mobile flow at 375px and 430px with a real
horizontal-overflow assertion. Its `getByRole("dialog", { name: "Add panel" })` locator is
valid — I confirmed live that the picker is a native `<dialog aria-label="Add panel">` opened
via `showModal()` and exposed with role `dialog` in the accessibility tree.

*(Measurement note, in the spirit of "reproduce before you refute": my first live attempt found
the picker `<dialog>` closed and I nearly filed the e2e locator as broken. A clean re-run —
navigate, open the kebab, confirm the menuitem exists, click — showed `open: true`,
`:modal` true, height 733px. The first reading was my own stale-interaction artifact, not a
defect.)*

### 7. Gates re-run fresh by me (all PASS)

| Gate | Result |
|---|---|
| `npx openspec validate output-picker-nav-onboarding --type change` | `Change 'output-picker-nav-onboarding' is valid` |
| `npm run check:openspec` | `openspec/ is clean` |
| `npx tsc --noEmit -p frontend/tsconfig.json` | clean, no output |
| `npm run lint` (`eslint src --max-warnings=0`) | clean |
| `npx jest` | **252 suites / 2589 tests passed** |
| `tasks.md` | 49/49 checked, none unticked |

### 8. Definition-of-done / decision 17 — the app works end to end (PASS)

Live at `localhost:6341`, logged in: sidebar renders exactly five destinations; a dashboard
renders its output and divider panels; kebab → "Add panel" opens the Output picker populated
with real Outputs grouped under ~40 real pipelines, each with kind, name, live placement counts
("2 placements", "1 placement", "0 placements"), correct "On this board" markers on the two
Outputs already placed, and the CONTENT row (Text · Markdown · Image · Divider) at the bottom.
This is a functioning source → pipeline → Output → dashboard chain, which is precisely what
P1.6 owes the epic. The non-functional-main window decision 17 describes is closed.

---

## Verdict: REFUTE

Two shipped spec deltas assert behavior that does not exist. These are cheap to fix (spec text
only, no code change required — the *code* is right in both cases), but they are blocking on
this axis specifically: these deltas get archived into `openspec/specs/**`, which is the
project's source of truth, and both would tell a future implementer to build something the
codebase deliberately does not have. This ticket already had exactly one such incident
(`output-picker`'s live-thumbnail MUST); this is the same class recurring twice more.

## Change Requests

1. **`specs/panel-detail-modal/spec.md` — the ADDED requirement asserts a tab structure that
   does not exist, for any panel kind.**
   The requirement text says content-kind panels "retain their existing Appearance/Data-tab
   structure … including the existing 'Appearance tab is active on entering edit mode' and
   'user switches to the Data tab' behaviors for those panel kinds", and its scenario
   *"Content panel keeps its existing tab structure"* asserts *"its existing Appearance/Data tab
   structure … are shown, unchanged from before this change."*
   Ground truth: **there is no tab bar for any panel kind, and there was none on `main` either.**
   - `grep -i tab` over the whole `features/panels/ui/detailModal/` directory returns zero tab
     markup in `PanelDetailModal.tsx`.
   - `git show main:.../PanelDetailModal.tsx` likewise has no `role="tab"`/`activeTab`/tablist.
   - The change's own passing tests assert the opposite:
     `PanelDetailModal.test.tsx:120-125` ("opens in view mode by default — Edit button visible,
     no tab bar", `queryByRole("tablist")` not in document),
     `:137-145` ("clicking Edit transitions to edit mode with a unified form — no tab bar
     present"), and `:168-176` ("divider panel edit mode shows Appearance and Divider sections
     without a tab bar", also asserting no "Data" heading).
   The base spec's stale `Panel detail modal has Appearance and Data tabs` /
   `Data tab shows a placeholder` requirements were already wrong before this ticket; **removing
   them is correct** — the defect is that the ADDED requirement *re-introduces* the same false
   claim scoped to content panels.
   *Required:* rewrite the ADDED requirement's content-panel clause and the
   "Content panel keeps its existing tab structure" scenario to describe what actually ships —
   a single unified edit form with `Appearance` + a kind-specific section (e.g. `Divider`,
   literal text/markdown content), **no tab bar and no "Data" tab for any panel kind** — and
   update the two REMOVED-requirement `**Migration**` notes that currently promise content
   panels keep the tabs.

2. **`specs/nav-section-registry/spec.md` — the ADDED requirement asserts a nav order and labels
   that do not match the shipped registry.**
   Scenario *"Nav-visible entries match the registry"* asserts *"they are exactly Dashboards,
   Pipelines, Sources, Connectors, Assistant, **in that order**"*.
   Ground truth (`frontend/src/shared/chrome/sections.ts`, entries with `showInNav: true`, in
   array order): **Dashboards · Data Sources · Data Pipelines · Connectors · Assistant** —
   Sources precedes Pipelines, and the labels are `"Data Sources"` / `"Data Pipelines"`, not
   `"Sources"` / `"Pipelines"`. This is confirmed three independent ways: `sections.ts:46-86`;
   the change's own passing guards `navDestinations.test.ts:13-18` and `sections.test.ts:19-23`,
   which pin exactly that order and those labels; and the live sidebar snapshot at
   `localhost:6341` (Dashboards → Data Sources → Data Pipelines → Connectors → Assistant).
   The shipped order is the *correct* choice — it preserves `main`'s relative order and only
   drops the two retired entries — so **fix the spec, not the code**.
   *Required:* restate the scenario against the real five entries and their real labels (and
   either drop the ordering clause or state the actual order). Note the same wrong ordering
   appears informally in `ticket.md`'s Scope bullet and in the `mobile-bottom-nav` delta's
   prose ("Dashboards, Pipelines, Sources, Connectors, Assistant"); align those too so the
   archived specs are self-consistent.

3. **Three stale-precedent comments point at a file this change deletes.**
   `hel716-panel-creation-focus-trap.spec.ts` is deleted in this change, but is still cited as a
   live precedent by:
   - `e2e/README.md:4` — uses it as *the* worked example of the naming convention;
   - `e2e/hel716-panel-detail-tall-viewport-footer.spec.ts:23` — "Mirrors
     e2e/hel716-panel-creation-focus-trap.spec.ts's pattern";
   - `e2e/hel773-top-anchored-mobile-nav-sheet.spec.ts:8` — "mirrors
     `e2e/hel716-panel-creation-focus-trap.spec.ts`'s pattern".
   This is the exact stale-reference class the Axis-D sweep commit (`ea8e8cc5`) targeted; these
   three survived it. Lowest-severity of the three CRs, but it is squarely deletion hygiene and
   is a one-line fix each: repoint at a surviving spec (e.g.
   `hel909-output-picker-panel-sheet.spec.ts`, which is itself already used as the register/login
   precedent) or drop the citation.

## Non-blocking notes

- **design.md's exception count is stale.** It says "~47 hits"; the real figure at `2913739b`
  is **32** (composition table above). The exception's *substance* is verified sound. Per
  design.md's own instruction, make sure the PR body records **32** and the 17-file list, not
  the historical 47 (or the ~80 in the orchestrator brief).
- `specs/panel-config-field-or-literal-pattern/spec.md` states "The pattern itself is retired."
  Strictly, the *panel-level* pattern is retired; the implementation (`BoundOrLiteralField` /
  `useBoundOrLiteralState`) lives on and is actively used by `OutputEditorSheet` for chart
  annotation and metric label/unit. The delta's own Migration notes point correctly at
  `OutputEditorSheet`, so the net meaning is right — but "the pattern itself is retired" reads
  as more than happened. Optional wording tightening.
- Evaluation-4's claim that the grep count was unchanged since an earlier commit is consistent
  with what I measured (all 32 hits are in files this change did not touch in the last three
  commits) — but its *absolute* framing inherits design.md's stale number.
