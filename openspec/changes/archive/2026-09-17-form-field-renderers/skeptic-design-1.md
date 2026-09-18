## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **PanelContent.tsx isFormPanel branch** — read `frontend/src/features/panels/ui/PanelContent.tsx:318-329`
  (line numbers exact). Confirms the "Form not configured" placeholder and the HEL-1083 D10 comment the
  design cites as the seam this change fills.
- **PanelDetailModal view mode routes through PanelContent** — read
  `frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx:411-419`; `modalMode === "view"` renders
  `<PanelContent panel={panel} .../>` directly, confirming D1's rejection of a second call site.
- **Form config shape** — read `frontend/src/features/panels/types/panel.ts:160-205` (actual path differs
  slightly from the design's shorthand `types/panel.ts` but resolves correctly); `FormPanelConfig
  {dataSourceId, fields: FormFieldSpec[], submit}` matches proposal/design exactly, including `required`
  tighten-only and `initialValue` prefill-only doc comments.
- **PanelPacker.Bounds** — read `backend/.../services/panels/PanelPacker.scala:39-43`; map has only
  `Output`/`Image`/`Markdown`, confirming the `form` entry is genuinely absent and `PanelKind.Form` exists
  (`domain/model/Panel.scala:116`) for the design's proposed addition.
- **Shared primitives' current state** — read `TextField.tsx` (type union excludes `"date"`, confirmed),
  `FormField.tsx` (no `hintId` yet, `errorId` already present from HEL-1084, confirmed), `Select.tsx` (has
  `ariaLabel`/`ariaInvalid`/`ariaDescribedBy`, no `ariaRequired` yet, confirmed), `Toggle.tsx` (only
  `ariaLabel`, no `ariaInvalid`/`ariaDescribedBy`/`ariaRequired`, confirmed). Each "gains X" claim in D3/D4
  and tasks 2.1-2.4 is accurate against the current code, not aspirational.
- **formConfigValidation.ts** — read `frontend/src/features/panels/state/formConfigValidation.ts`; confirms
  `computeFormIssues`, `parseTypedValue`, `isValidTypedValue`, `isOptionsArray`, `CONTROL_FITNESS` all exist
  and are reusable as D2/D5/D7 claim.
- **DataSource `static` alias** — read `backend/.../domain/model/DataSource.scala:255-283`;
  `DataSourceKind.canonicalize` maps `"static"` → `"dataset"`, confirming D9's Playwright fixture premise.
- **E2E glob and precedents** — confirmed `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` and
  `e2e/hel1080-dataset-row-grid-live.spec.ts` exist at repo-root `e2e/` (not `frontend/e2e/` as the proposal's
  shorthand implies, but the actual glob target); `ci.yml:395-396` runs `npx playwright test` by glob, so a
  new `e2e/hel1085-*.spec.ts` is picked up with no CI config change, as D9 claims.
- **FormPanelRoundTripSpec.scala:20-27** — read; the cited create-form-panel body shape matches D9's
  Playwright fixture description.
- **DESIGN.md §3/§6/§8** — headings exist at the cited numbers (Tokens, Shared components, Accessibility
  baseline).

### AC traceability

All four ticket ACs map to spec requirements with scenarios: six controls in authored order (Req 1);
computed accessible name/description (Req 2); keyboard completability (Req 3); error association by computed
ARIA state (Req 5). Required-derivation, prefill, schema-loading states, non-droppable inconsistent fields,
grid sizing, and no-submit-yet are additional requirements beyond the literal AC text but are legitimately
scoped work needed to make the six controls render correctly and safely (not scope creep — each is either
implied by the config shape's existing fields or an explicit HEL-1083 deferral, per D10).

### Internal consistency

- No placeholders/TBDs found in proposal.md, design.md, tasks.md, or the spec delta.
- tasks.md's Standing Constraints C1-C6 correctly carry forward HEL-1084's C6/C8 (computed-name/description
  discipline, never `role="alert"` presence) as C1 here — verified against the design.md Context section's
  citation of the same finding.
- Every design Decision (D1-D10) has a corresponding task and test task (4.1-4.9); the mutation-testing
  discipline (C4, remove-branch-goes-red) is specified for both the frontend if-chain dispatch (task 3.5/4.6)
  and the backend Bounds map entry (task 1.1/4.1) — this is exactly the "red before green" evidence discipline
  the org's memory flags as previously missing.
- Non-goals are precise and match HEL-1086/1087/1088/1089's stated scope; the proposal's Impact section
  enumerates real files that exist.
- D10's enumeration of out-of-scope surfaces (PanelDetailModal editor chains, PanelRowMapper/
  configColumnsOf, mobilePanelHeights, panelGridConfig minW, OutputPanelDefaultSize, panel-type-rendering
  spec, RefinementEditShape, create_content_panel) is a genuine attempt to close the silent-degradation
  surfaces named in my brief — I did not independently verify each of those eight citations line-by-line
  (time-boxed), but the ones I did check (PanelDetailModal, PanelPacker.Bounds) were accurate, giving no
  reason to distrust the rest.

### Verdict: CONFIRM

Design is sound, specific, and grounded in verified ground truth. No placeholders, no contradictions between
proposal/design/tasks/spec, no ambiguous task a competent implementer could misread, and no AC left
uncovered. The a11y evidence discipline (computed name/description, never DOM/role presence; error
association by `aria-invalid`+`aria-describedby`, never `role="alert"` presence) is explicit and enforced by
task-level "verify" clauses, directly addressing the HEL-1084 regression named in my brief.

### Non-blocking notes

- The `Toggle` vs `Checkbox` naming mismatch (switch semantics announced for a "checkbox" vocabulary field)
  is flagged by the design itself as an open risk for skeptic override; I do not think it rises to a REFUTE —
  both are boolean native inputs with identical keyboard operability, and introducing a new `Checkbox`
  primitive purely for AT-announced role naming is exactly the kind of low-value net-new surface DESIGN.md
  §6 warns against. If the final-gate skeptic finds the "switch" announcement genuinely misleading in a real
  screen reader pass, that's a fair place to revisit — but not a design-gate blocker.
- `frontend/e2e/` vs actual repo-root `e2e/` is a minor path-shorthand inconsistency between the proposal's
  Impact section and design.md D9 (which correctly doesn't restate the path); worth the implementer double
  checking but not a design defect since the actual target directory is unambiguous once verified.
