## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Artifacts read in full**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/icon-button/spec.md`, `.openspec.yaml`, `workflow-state.md`.

- **AC1 traceability** ("`IconButton` exists in `shared/ui/`, documented in DESIGN.md
  §5/§6") → tasks 1.1–1.3 (create `IconButton.tsx`/`.css`, export from `index.ts`) and
  4.1–4.2 (DESIGN.md §5 recipe + §6 registration). `spec.md`'s "required accessible
  name" and "ghost/secondary/danger recipes at documented sizes" requirements give
  this concrete, testable scenarios. Full coverage, no gap.

- **AC2 traceability** ("Every icon-only interactive element in the app has a visible
  or accessible tooltip/label") → tasks 2.1–2.4 (migrate the three converged
  duplicates) + 3.1–3.3 (grep-and-fix audit of the rest) + `spec.md`'s "Every
  icon-only interactive element has a visible or accessible tooltip/label"
  requirement (correctly phrased as OR, matching the ticket AC's wording, not AND).
  Full coverage.

- **Factual claims in `design.md`'s Context section, checked against the actual repo**
  (all confirmed accurate):
  - `.cmd-btn.cmd-btn--icon` in `frontend/src/app/App.css:163` — confirmed, with the
    exact `--control-sm`/`--app-radius-sm`/transparent-bg shape described.
  - `.ui-modal__close` in `frontend/src/shared/ui/Modal.css:123`, used by
    `Modal.tsx:184` — confirmed.
  - `.preferences-editor__icon-btn` in `PreferencesEditor.css:135`, used twice in
    `PreferencesEditor.tsx:217,301` — confirmed.
  - `CommandBar.tsx`'s existing `aria-label`+`title` pairing on Undo/Redo (lines
    185–186, 195–196), "Refine with AI" (213–214), quick-launcher (228–229), and
    theme toggle (238–239) — confirmed verbatim, including the claimed
    Undo/Redo-are-icon+text (not icon-only) distinction (`<FontAwesomeIcon .../> Undo`
    at line 188) that task 2.1 relies on to exclude them from migration.
  - The archived `2026-08-18-icon-glyph-cleanup` change's proposal.md explicitly
    states "HEL-718's `IconButton` primitive has not landed yet" — confirmed at
    `openspec/changes/archive/2026-08-18-icon-glyph-cleanup/proposal.md:20`.
  - `openspec validate icon-button-primitive-tooltip --strict` → `Change
    'icon-button-primitive-tooltip' is valid`.

- **Adversarial check on Decision 5's audit-target file list**: spot-checked
  `RefinementChatDrawer.tsx` (close button, line ~236, has `aria-label="Close"`),
  `Toast.tsx` (close button, line 75, has `aria-label="Dismiss notification"`),
  `SidebarBody.tsx` (rename/pin row actions, ~line 331/339, have `aria-label`),
  `Sidebar.tsx` (collapse toggle, line 45, has `aria-label`), `BottomNav.tsx` (has
  `aria-label` + visible text, not icon-only), `PipelineShareDialog.tsx` ("Revoke"
  button has visible text, not icon-only). Most of the named files already comply
  with the OR requirement. This does not weaken the design — `design.md`'s own
  language frames these as files "to grep... for any icon-only control lacking
  either" a label or tooltip, not as a list of confirmed defects, and `tasks.md`
  3.1–3.2 correctly frame the audit as find-then-fix-or-note, not a fixed defect
  count. Non-blocking.

- **Non-`<button>` icon-only element risk**: checked whether the codebase has any
  icon-only interactive elements outside literal `<button>` (which is all task 3.1's
  grep targets) — no `role="button"` divs/spans found anywhere in `frontend/src`, and
  every icon-only `<Link>`/`<NavLink>` found (`BottomNav`, sidebar nav) carries
  visible text, so it's out of the "icon-only" AC's scope. Task 3.1's `<button>`-only
  grep scope is therefore adequate against the current codebase. Non-blocking.

- **Test-plan feasibility**: confirmed `Modal.test.tsx` queries the close button by
  accessible name (`getByRole("button", { name: "Close" })`), which the migration
  preserves (task 2.2 keeps `aria-label="Close"`), so task 5.1's "assert the
  accessible name/tooltip is still present" is achievable without rewriting existing
  assertions. Confirmed no `CommandBar.test.tsx` currently exists — task 5.1's
  "Update/add tests" correctly anticipates a net-new test file there, not just an
  update.

- **DESIGN.md consistency check**: read §5 (Buttons) and §6 (Shared components) in
  full. The planned `IconButton` recipe (ghost/secondary/danger, `--control-sm/md`,
  `--app-radius-sm`) is exactly the pattern §5 already prescribes for hand-rolled
  buttons — this is formalization, not a new fourth style, consistent with §5's
  binding "[judgment] A new button style is a defect, not a variant" rule.

- **No placeholders/TBDs/deferred decisions** found in any artifact. Every open
  question in `design.md`'s Decisions section (props shape, sizing map, variant
  defaults, DESIGN.md placement, migration order) is resolved with a specific,
  grounded answer, not left for the executor to decide.

- **No contract/schema impact** — this is a frontend-only primitive with no
  API/schema surface, so the "missing contract updates" check does not apply.

### Verdict: CONFIRM

### Non-blocking notes

1. The primitive's `icon: ReactNode` prop leaves it to each call site to add
   `aria-hidden="true"` to the icon element it passes in (matching today's scattered
   convention, e.g. `<Pencil size={14} aria-hidden="true" />`). Centralizing that
   inside `IconButton` (wrapping the `icon` child in an `aria-hidden` span) would
   remove one more place a future call site could forget it. Not required for this
   change to ship, since it doesn't regress current behavior.
2. Task 3.1's audit is scoped to literal `<button>` elements; if a future change
   introduces an icon-only `role="button"` div or icon-only unlabeled `<Link>`, it
   would fall outside this grep. No such pattern exists in the codebase today, so
   this is forward-looking only.
