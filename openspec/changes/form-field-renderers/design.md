## Context

See proposal.md — Why; every file:line here was re-verified at Setup
(`.concertino/runs/HEL-1085/evidence/premise-validation.md`, verdict no-drift). `PanelContent.tsx:318-329`
carries HEL-1083 D10's explicit `isFormPanel` branch rendering "Form not configured"; `PanelDetailModal.tsx:412`
routes view mode through the same `PanelContent`, so no third if-chain arm is needed there (its two editor
chains already carry `form` from HEL-1084). The config is `{dataSourceId, fields:[{sourceField, control,
label?, placeholder?, helpText?, required?, initialValue?, step?, options?}], submit}` (`types/panel.ts:166-205`),
`required` is tighten-only and `initialValue` prefill-only (HEL-1083 D3a). The declared schema is
`fetchDatasetSchema(id)` → `{fields:[{name,type,required,default?}]}`; `state/formConfigValidation.ts` already
holds `computeFormIssues`, `parseTypedValue`, `isValidTypedValue`, `isOptionsArray` and the fitness matrix.
Shared primitives: `TextField` (type union excludes `date`), `Textarea`, `Select` (combobox/listbox, keyboard
complete, `ariaLabel`/`ariaInvalid`/`ariaDescribedBy`), `Toggle` (native checkbox `role="switch"`, `ariaLabel`),
`FormField` (label `htmlFor`, `error` + `errorId`, `hint` with NO id). `PanelPacker.Bounds` (`:39-43`) maps
only Output/Image/Markdown; HEL-1083 deferred the `form` entry to this ticket. HEL-1084's final gate found
both evaluator cycles mistaking `role="alert"` presence for association; its C6/C8 bind here as C1 below.

## Goals / Non-Goals

**Goals:** a form panel that is usable on the grid; every field labelled, described and error-associated by
computed ARIA state; keyboard completability proven in a real browser; a values hook HEL-1087 can submit from
without restructuring; loud surfacing of anything the renderer cannot honour.

**Non-Goals:** see proposal.md — Non-goals. Design-level: no schema cache/dedupe across panels (measure first);
no Redux draft state; no new `Checkbox` primitive; no change to `Select`'s internals beyond one prop.

## Decisions

**D1 — Dispatch from the existing branch; renderer maps config to a view.** `PanelContent.tsx`'s `form` branch
delegates to `ui/renderers/FormRenderer.tsx` (the `ImageRenderer`/`DividerRenderer` shape: `panel` in, view out),
which renders the unconfigured state for `fields.length === 0` and `ui/form/FormPanelView.tsx` otherwise. The
if-chain is not typecheck-protected (C4), so the branch is proven by mutation: removing it turns
`PanelContent.test.tsx`'s form case red. Rejected: a new call site in `PanelDetailModal` — view mode already
reaches `PanelContent` (`:412`), verified by a modal test rendering a form panel in view mode.

**D2 — The renderer fetches the declared schema; config alone cannot render correctly.** `required` is
tighten-only, so a dataset-required field with no config flag MUST render required — the exact contradiction
D3a forbids. Numeric typing (integer vs float), option typing and prefill validation all need the declared type.
`FormPanelView` fetches on mount and on `dataSourceId` change, mirroring `FormEditor.tsx:66-96` (cancelled-flag
effect, `PanelBodySkeleton` while loading, `InlineError` + Retry on failure). Rejected: config-only rendering
(silent D3a violation); a Redux/module cache (premature — a dashboard has few form panels; revisit if measured).

**D3 — Control → shared primitive, native where possible.** `text` → `TextField`; `textarea` → `Textarea`;
`number` → `TextField type="number"` with `step` = config `step` ?? (`1` for integer, `any` for float) and
`inputMode`; `date` → `TextField type="date"` (extend the `type` union — the component already forwards every
input attribute); `select` → `Select` with options mapped to `{value: String(v), label: String(v)}` and the
stored value the typed option resolved by string key; `checkbox` → `Toggle` (the design system's one boolean
primitive, native input, keyboard/AT-ready; DESIGN.md §6 "reuse, don't reinvent"). Rejected: a new `Checkbox`
primitive (new surface for no AC gain); a native `<select>` (the app deliberately replaced it, `Select.tsx:33`).

**D4 — Name, description and error association by computed ARIA state (C1).** Each field renders in
`FormField` with `label` = `field.label ?? field.sourceField`, `htmlFor` = a `useId()` control id, `hint` =
`helpText`, `error`/`errorId` when invalid. `FormField` gains `hintId` so the hint `<p>` is addressable;
the control's `aria-describedby` is `errorId` when an error shows, else `hintId` when a hint shows, else unset —
so `toHaveAccessibleDescription` resolves to exactly one of them. Native inputs take `required`, `aria-invalid`,
`aria-describedby` directly; `Select` uses `ariaLabel`/`ariaInvalid`/`ariaDescribedBy` plus a new `ariaRequired`;
`Toggle` gains `ariaInvalid`/`ariaDescribedBy`/`ariaRequired` (the same three-prop shape HEL-1084 gave `Select`)
and takes `ariaLabel` = the label while `FormField` shows the visible one. Rejected: `role="alert"` alone (a
one-shot announcement, not an association — the HEL-1084 finding); `aria-label` on every native input (breaks
the visible-label click target and duplicates the name source).

**D5 — Field-level validation is the minimal set that produces an associated error; UX only.** Pure
`state/formFieldValidation.ts`: (a) required (config `required === true` || declared `required`) and empty →
"<label> is required"; (b) `number` on integer → non-integer → "<label> must be a whole number"; unparseable →
"<label> must be a number" (float likewise); reuses `parseTypedValue`/`isValidTypedValue`. Errors appear only
for touched fields (on blur), never on first render. HEL-1087 owns submit-time validation and enforcement
("client validation is convenience, not enforcement"); this module is what it will call per field. Rejected:
validating on every keystroke (announces mid-typing); native constraint bubbles (unstyled, not associated).

**D6 — Values live in a per-instance hook, seeded by prefill.** `ui/form/useFormPanelValues(config, schema)`
returns `{values, touched, errors, setValue, touch, reset}`; seeds from `initialValue` (prefill-only) else the
control's empty (`""`, `false`, no option); re-seeds when the field list changes (sheet edit). A grid card and a
modal view of the same panel hold separate drafts — recorded, not hidden; HEL-1087 may lift it. `reset` exists
for `resetOnSuccess`. Rejected: Redux (ephemeral, per-mount state; no consumer yet).

**D7 — Anything the renderer cannot honour is surfaced per field (C3).** `computeFormIssues(config, schema)`
(reused from the builder) yields per-field issues (orphaned, unfit, bad options/initialValue); such a field
renders its label, a disabled control and the issue as its associated description. `file` renders its label
and a "File upload is not yet available" note (HEL-1086). Nothing is filtered out. Rejected: hiding broken
fields (the author sees a shorter form and no cause — the C8 family).

**D8 — Sized for a grid cell.** `.panel-content--form` joins the F-038 scroll-affordance selector list in
`PanelContent.css` (`overflow-y: auto`, column flex, `align-items: stretch`, `justify-content: flex-start`,
`gap: var(--space-3)`), `Textarea` min-height reduced inside the form, and a `@container panel-card
(max-height: 179px)` block tightens gap and type — the same container the metric/table variants key off
(`PanelGrid.css:28-30`). Tokens only (DESIGN.md §3); both themes compared against the running app. Backend:
`PanelPacker.Bounds += PanelKind.Form -> ClampBounds(minW = 3, minH = 5, maxH = 24)` (Image/Markdown's values),
proven by a `PanelPackerSpec` case whose mutation (remove the entry) goes red. The body is a `<form>` named
`aria-label={panel.title}` with `onSubmit` prevented — no submit button until HEL-1087 (recorded, C9).

**D9 — Evidence by computed ARIA in Jest, keyboard reach and live association in Playwright (C1).** Jest: every
label/description/error claim uses `getByRole(..., {name})`, `toHaveAccessibleName`,
`toHaveAccessibleDescription`, `toHaveAttribute("aria-invalid", "true")` — no `getByText` for these claims.
Playwright `e2e/hel1085-form-field-renderers-keyboard.spec.ts` (CI's e2e glob): register; `POST
/api/data-sources` `{type:"static", columns:[six declared fields], rows:[]}` (`static` is the accepted wire alias
for `dataset`, `DataSource.scala:266-280`; precedent `hel1080-*.spec.ts`); `POST /api/dashboards`; `POST
/api/panels` `{type:"form", config}` (body shape: `FormPanelRoundTripSpec.scala:20-27`); reach the grid
(precedent `hel910-*.spec.ts`); Tab through all six, complete each by keyboard, assert `toHaveAccessibleName` and
`toHaveAccessibleDescription` in the browser, blur an empty required field and assert `aria-invalid="true"` +
the error as description; screenshot both themes into the run's evidence. Teardown in `finally`.

**D10 — Out-of-scope enumerations, decided explicitly (C9).** `PanelDetailModal` editor if-chains (already
`form`-aware); `PanelRowMapper`/`configColumnsOf` (no model change); `mobilePanelHeights` (`form` intrinsic
since HEL-1083); `panelGridConfig` `minW` (kind-generic); `OutputPanelDefaultSize` (output-only by definition);
`panel-type-rendering` spec (pre-HEL-909, not extended); `RefinementEditShape` and agent prompt copy (still
deferred); `create_content_panel` (excluded by definition, HEL-1083).

**D11 — Fold-in (Phase 4 follow-up, owner ruling `fold-in`): two `MISTAKES.md` trap entries, docs-only.** Both go under
`## Tooling` (`MISTAKES.md:224-262`), after the epic-cascade entry, in that section's voice — a trap that looks correct
and fails silently, one short entry each, ~80-column wrapped, and Prettier-checked (root markdown is NOT in
`.prettierignore`, unlike `openspec/`). (a) **A `git commit` without a ~600000 ms tool timeout is backgrounded
mid-hook** — `.husky/pre-commit` runs lint, three typechecks (frontend, e2e, helio-mcp), Prettier, schema/spec/openspec/
dependabot/scala-quality/temp-dir/credential-leak/token checks and the full Jest suite, far past a 120 s default; the
agent then ends its turn "waiting for a notification" that never arrives in the expected shape. Recovery: find the live
chain (`pstree -p <git pid>`), wait on `.git/worktrees/<name>/COMMIT_EDITMSG` with
`scripts/concertino/await-sentinel.sh`,
never re-run the commit. Evidence: bit the HEL-1087 executor AFTER its brief warned explicitly. (b) **An unanchored
`pgrep -f` poll matches itself** — `until ! pgrep -f "git commit"; do sleep …; done` never terminates because the loop's
own command line contains the pattern, and the leaked shell holds the worktree open against `cleanup.sh`. Anchor every
check (`pgrep -c -f '^bash .*<script>'`) or use `await-sentinel.sh`. Evidence: seven hits in one batch (CON-200, the
driver twice, CON-189, CON-193, HEL-1084's five leaked shells, HEL-1150). No spec delta — `MISTAKES.md` is not a
behaviour contract — so the re-archive uses `--skip-specs` (the first archive already merged this change's only delta).
Rejected: a standalone ticket (the triage recommendation) — the owner ruled fold-in because this file is bound to every
run's orchestrator and auditor, so the four remaining epic leaves read it.

## Risks / Trade-offs

- [`Toggle` announces "switch", the vocabulary says checkbox] → both are boolean on/off controls with identical
  keyboard semantics; a switch is the app's established boolean primitive. Skeptic may overrule; a `Checkbox`
  primitive is a small additive change if so.
- [One schema fetch per mounted form panel] → cheap today; `useOutputMeta`-style caching if a dashboard grows
  many forms — recorded, not built.
- [Errors depend on "touched" state] → pinned by the "no error before interaction" scenario and its inverse.
- [Playwright depends on live servers on this run's ports] → `DEV_PORT` passed explicitly (CON-165);
  `start-servers.sh` cwd verified before trusting a reused server (MISTAKES.md).
- [`required` attribute on native inputs invokes browser constraint validation on submit] → no submit exists;
  HEL-1087 decides `noValidate`. Recorded for that lane.

## Migration Plan

No schema, migration, or wire change. Deploy with the PR; rollback is a revert. Existing form panels render
their fields on the next load.

## Planner Notes

Self-approved: `Toggle` for `checkbox` (D3); the validation rule set and blur-only timing (D5); per-instance
draft state (D6); Image/Markdown's bounds for `form` (D8); no submit button rather than a disabled one (D8 —
a disabled button that does nothing is silent-degradation-shaped). Standing constraints C1–C6 originate from the
driver brief and HEL-1084's promoted constraints; recorded in `workflow-state.md` and `tasks.md`.
