## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Read fresh (cold, no reliance on round-1's narrative beyond treating it as a claim to
re-check): `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas
(`specs/metric-authoring-ui/spec.md`, `specs/panel-datatype-binding/spec.md`),
`workflow-state.md`, and `skeptic-design-1.md`.

**Required revision 1 (D1 nav wiring) — verified fixed against ground truth:**
- `frontend/src/shared/chrome/navDestinations.ts:16-21` — confirmed the four-item
  rotation (`/`, `/sources`, `/pipelines`, `/registry`); Pipelines is in it, exactly as
  round 1 found and as D1's revision now states.
- `frontend/src/shared/chrome/SidebarBody.tsx` (full file, 179 lines) — confirmed the
  `section === "pipelines"` branch (lines 101-121, a `SidebarItemList` block) and
  `sectionFromPathname()` (lines 172-179, currently returns `"dashboards"` for any
  unmatched path, confirming round 1's "falls through to Dashboards" claim was
  accurate). design.md D1's revised text now explicitly commits to adding a
  `navDestinations.ts` entry, a `"metrics"` branch in `SidebarBody.tsx` "identical shape
  to the existing pipelines branch," and `breadcrumbLabel()`/`sectionFromPathname()`
  handling — matching what round 1 demanded.
- `frontend/src/app/App.tsx` — confirmed `breadcrumbLabel()` (lines 73-79) and the
  mobile-sheet machinery `sectionFromPathname()` feeds: `mobileSection`,
  `breadcrumbItemName` (lines 114-127), `mobileSheetItems` switch (lines ~136-157),
  `mobileSheetEmptyMessage: Record<typeof mobileSection, string>`, and
  `handleMobileSheetSelect` switch — all keyed off the same `"dashboards" | "sources" |
  "pipelines" | "registry"` union `sectionFromPathname` returns. `tasks.md` 2.7 now
  names `navDestinations.ts`, the `SidebarBody.tsx` section branch,
  `breadcrumbLabel()`/`sectionFromPathname()`, and "the mobile breadcrumbItemName/
  mobileSection plumbing App.tsx already does for pipelines" as the wiring to add. This
  is specific enough to be actionable: once `sectionFromPathname`'s return type gains
  `"metrics"`, TypeScript will force the `Record`-typed `mobileSheetEmptyMessage` and
  the `mobileSheetItems` IIFE-switch (its inferred return type would otherwise include
  `undefined`, conflicting with the declared `MobileNavSheetItem[]` annotation) to be
  updated at compile time — so even the not-individually-named switch statements are a
  self-enforcing consequence of the change task 2.7 does name, not a silent gap.
- Confirmed no other click path to `/metrics` is claimed or needed now that D1 commits
  to full nav wiring (this supersedes round 1's option (b) discussion; option (a) — the
  one D1 picked — is the one actually documented and tasked).
- **Verdict on revision 1: genuinely fixed**, not just reworded. The design now commits
  to real, correctly-scoped wiring, and ground truth confirms the wiring described is
  both necessary and sufficient to make `/metrics` reachable with a matching sidebar.

**Required revision 2 (BindingEditor extraction) — verified fixed against ground truth:**
- `wc -l frontend/src/features/panels/ui/editors/BindingEditor.tsx` → **493 lines**
  (unchanged from round 1 — this is a design-gate review, no code has been written yet).
- Read `BindingEditor.tsx` in full: confirmed its existing extraction pattern is real
  and directly reusable — `useBoundOrLiteralState.ts` (73 lines) is a self-contained
  hook returning `{mode, setMode, fieldValue, ..., dirty, reset, patchValue,
  fieldMappingValue}`, instantiated three times (`labelState`, `unitState`,
  `annotationState`) and wired into `dataDirty`, `useImperativeHandle`'s `reset`/`save`,
  and the `updatePanelBinding` payload — the exact shape design.md D5 proposes for the
  new `useMetricBindingState.ts`. `MetricBindingFields.tsx` (68 lines) is a thin
  presentational component composed into `BindingEditor.tsx`'s JSX, matching how D5
  proposes `MetricPicker.tsx` composes into it. This confirms the revised D5/task 3.4-3.5
  plan ("BindingEditor.tsx itself only wires the hook's state into its existing save
  path — no new inline JSX/state block") is mechanically consistent with the file's own
  established pattern, not hand-waved.
- `CONTRIBUTING.md:24` confirmed verbatim: "~400 lines... propose a split... rather than
  adding to it" — the threshold citation in D5 is accurate.
- Confirmed the "raw fields win when both present" backend semantics D5/D6 and the
  panel-datatype-binding spec delta lean on: `PanelServiceHelpers.scala:269-287`
  (`withMaterializedMetric`) — raw `fieldMapping` wins when non-empty else falls back to
  the metric's `measureField`; raw `aggregation`/`unit` win via `.orElse(...)`. Matches
  D5's description and the spec's "Clearing the metric selection reveals raw fields"
  scenario exactly.
- **Verdict on revision 2: genuinely fixed.**

**Non-blocking notes from round 1 — verified corrected:**
- `tasks.md` 3.3 now correctly targets `panelThunks.ts` — confirmed
  `updatePanelBinding` is defined at `frontend/src/features/panels/state/
  panelThunks.ts:165` and only re-exported via `panelsSlice.ts` (`grep -n
  updatePanelBinding` on both files).
- `design.md` D2 no longer claims "byte-for-byte"; its revised wording (paginated
  `PagedResult<MetricResponse>` needing `.items` unwrap, citing `dataTypeService.ts`'s
  `fetchDataTypes` as the real precedent rather than `pipelineService.ts`) is confirmed
  accurate: `MetricRoutes.scala:41` returns `PagedResult(...)`;
  `pipelineService.ts`'s `getPipelines` returns a flat array; `dataTypeService.ts:17-19`
  does exactly the `.items` unwrap D2 now cites.

**Re-checked the rest of the design for new issues (not just the two prior items):**
- No `TODO`/`TBD`/"figure out later" anywhere in `design.md`/`tasks.md`/`proposal.md`/
  `ticket.md`/both spec deltas (`grep -niE` clean).
- All four ticket ACs trace to concrete tasks: metric CRUD w/ constrained pickers →
  tasks 1.1-1.5, 2.1-2.5; bind-to-metric panel mode → tasks 3.1-3.6; DESIGN.md/lint/
  format → task 4.6; Jest coverage/no unjustified `any` → tasks 4.1-4.5.
- D3's "no existing multi-select, rule of three" and "`Select.tsx` uses
  `usePortalPopover`" claims hold (`ls shared/ui/` has no multi-select; `Select.tsx:6,39`
  imports/uses `usePortalPopover`; `fieldOptions.ts`'s header comment literally says
  "Extracted at the third use... rule of three").
- D4's "no Toggle/Switch exists" claim holds — `ls frontend/src/shared/ui/` and a
  `role="switch"` grep both come up empty.
- `PipelinesPage.tsx`/`PipelineDetailPage.tsx` (62/571 lines) exist and are a real
  precedent for D1's page-owns-list-and-navigates framing.

### Verdict: CONFIRM

Both round-1 required revisions are genuinely fixed, not just reworded around the
same gap — I re-derived each from the current files rather than trusting design.md's
own account of itself, and ground truth matches what's now documented. No new
placeholders, contradictions, ambiguity, scope drift, or missing contract updates
found on this fresh pass.

### Non-blocking notes

- `tasks.md` 2.7's mobile-sheet wording ("the mobile breadcrumbItemName/mobileSection
  plumbing App.tsx already does for pipelines") is slightly generic — it doesn't name
  `mobileSheetItems`/`mobileSheetEmptyMessage`/`handleMobileSheetSelect` individually.
  As noted above, TypeScript's `Record`/return-type checking will force most of these
  to be touched once `sectionFromPathname`'s union grows, so this isn't a blocking gap
  — flagging only so the executor knows to search `App.tsx` for every `"pipelines"`
  case arm, not just the ones named literally in the task text.
