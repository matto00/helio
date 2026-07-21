## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ticket / ACs read**: `openspec/changes/bound-caption-annotation-fields/ticket.md` (4 ACs),
  `design.md` (Decisions D1–D4), spec deltas under `specs/echarts-chart-panel/`,
  `specs/image-panel-type/`, `specs/panel-config-field-or-literal-pattern/`.
- **Diff read in full**: `git diff main...HEAD --stat` (21 files, +919/-57) — `schemas/panel.schema.json`,
  `ChartDisplayFields.tsx`, `BindingEditor.tsx`, `PanelContent.tsx`, `helio-mcp/src/tools/write.ts`,
  `PanelSpec.scala` (new backend tests), plus new `*.test.tsx` files and the openspec artifacts.
- **AC1 (bound annotation renders + reacts)** — traced the full chain in source:
  `ChartPanel.scala` (`fieldMapping: JsObject`, no slot allowlist) →
  `Panel.selectedFieldsFromMapping` (collects all `fieldMapping` values as query columns, confirmed no
  backend change needed) → `usePanelData.ts` generic per-slot loop (`mapped[slot] = value...`, resolves
  `annotation` the same as any other slot from the first row) → `PanelContent.tsx`
  (`annotation={panel.config.annotation ?? data?.annotation ?? null}`) → `ChartRenderer` (unchanged prop).
  **Confirmed live**: opened "Mobile Title Test" chart panel (bound to `Profit`, HEL-248 Chart Config Eval
  dashboard), switched Annotation to "Bind to field" → `profit`, saved — panel rendered `2000000` (the
  bound value). Reloaded the page from scratch (new tab) and re-navigated — value persisted, confirming
  a real PATCH → re-fetch round-trip, not just client-side state.
- **AC2 (static annotation unchanged)** — switched back to "Fixed text", typed "Static fallback note",
  saved — panel rendered the static text immediately; `PanelContent.test.tsx` covers all four
  literal/bound/both/neither permutations; `PanelContent.tsx` diff shows literal-wins
  (`config.annotation ?? data?.annotation`).
- **AC3 (image caption deferred)** — `specs/image-panel-type/spec.md` "Image caption binding is out of
  scope" requirement documents the concrete reason (image panels have no `dataTypeId`/fieldMapping/fetch
  path); static `ImagePanelConfig.caption` untouched in the diff (no image files touched at all —
  confirmed via `git diff --stat`).
- **AC4 (gates green, round-trips)** — re-ran every gate fresh myself, not trusting the evaluator's
  report:
  - `npm run lint` → clean (0 warnings).
  - `npm run format:check` → "All matched files use Prettier code style!"
  - `npm run check:schemas` → "schemas in sync... panel-type enums in sync..."
  - `npm test` (root) → `Test Suites: 114 passed, Tests: 1194 passed`.
  - `frontend/ npm run build` → succeeded.
  - `backend/ sbt test` → `Total number of tests run: 1466 ... All tests passed.`
  - Backend round-trip: `PanelSpec.scala` HEL-323 block (decode / round-trip via per-subtype format /
    `Patch.decode` / `applyPatch` / `buildQuery.selectedFields` contains `"note"`) — read and confirmed
    each assertion actually exercises the reserved-slot path, not a tautology.
  - Live round-trip: verified above (AC1/AC2), plus restored the panel to its original
    `config.annotation = "Static fallback note"` state afterward so the shared eval dashboard is left
    clean.
- **UI/design review (my domain)**: opened the panel edit modal for the "Mobile Title Test" chart,
  screenshotted the Annotation control in both "Fixed text" and "Bind to field" modes.
  **Found a duplicate-label defect** — see Change Request #1 below.
- Console: 0 errors throughout the entire session (checked via `browser_console_messages`, level=error,
  all=true → "Total messages: 4 (Errors: 0, Warnings: 1)").

### Verdict: REFUTE

### Change Requests

1. **Duplicate "Annotation" label when a DataType is bound**
   (`frontend/src/features/panels/ui/editors/ChartDisplayFields.tsx`, the `isBound` branch of the
   Annotation `data-section`, ~lines 110–124). The outer `<span className="panel-detail-modal__data-label">
   Annotation</span>` is rendered unconditionally, and `<BoundOrLiteralField label="Annotation" .../>`
   renders its *own* `<span className="panel-detail-modal__mapping-label">Annotation</span>` immediately
   below it — the same word stacked twice for one control. Confirmed live: screenshot at
   `/tmp/claude-1000/-home-matt-Development-helio/f7b66e21-1a77-4575-8f55-2230c31d7056/scratchpad/annotation-duplicate-label.png`
   (and the `-bind-mode.png` companion) shows "Annotation" / "Annotation" on consecutive lines above the
   mode toggle. Playwright's own generated locator for the region was literally
   `getByText('AnnotationAnnotationBind to')`, i.e. the accessible text content concatenates the two
   identical labels.
   This diverges from the codebase's own established precedent for this exact situation:
   `MetricBindingFields.tsx` wraps two `BoundOrLiteralField`s (`label="Label"`, `label="Unit"`) under an
   outer heading `<span data-label>Label &amp; Unit</span>` — the outer text is a *group* heading distinct
   from the individual field labels, not a repeat of a single field's name. The Chart Annotation control
   has only one field, so the outer `data-label` span duplicates rather than groups.
   **Fix**: for the `isBound` branch, drop the outer `<span className="panel-detail-modal__data-label">
   Annotation</span>` (let `BoundOrLiteralField`'s own label be the only "Annotation" text), or keep a
   single outer label and pass an empty/non-rendering label to `BoundOrLiteralField` for this single-field
   case (would require a small prop addition, e.g. an optional `label` to omit the row's own span) —
   whichever keeps the non-bound branch's existing `<label htmlFor="chart-annotation">Annotation</label>`
   association intact for the unbound TextField case.

### Non-blocking notes

- The evaluator's `evaluation-1.md` Phase 3 UI review claims live verification of the same Annotation
  control ("Happy path (AC1)... panel rendered `2000000`... Reloaded... persisted") but does not mention
  the duplicate label — an easy miss when scanning an accessibility tree or a full-page screenshot rather
  than a tight crop of the control, but exactly the kind of thing this gate exists to catch.
- Everything else in the change (backend domain reasoning in `design.md` D1, the `fieldMapping.annotation`
  reserved-slot approach, literal-wins precedence, image-caption defer, schema/MCP doc updates, and test
  coverage depth) is sound and ships-quality; only the one control needs a markup fix.

### Process note (not a code defect, disclosed for transparency)

While verifying, I mistakenly ran `scripts/concertino/cleanup.sh` against this worktree (intended for
post-merge teardown, not mid-review use). It stopped the dev servers (expected) and also unregistered the
git worktree (`git worktree remove --force` partially succeeded — it printed
`error: failed to delete '<path>': Directory not empty` but had already removed the worktree's
`.git/worktrees/hel-323` admin metadata before hitting that error). The working directory's files on disk
are untouched and still match commit `54862284`, and the branch `feature/bound-caption-annotation-fields/hel-323`
and its commit are fully intact in the main repository's refs/objects (verified via `git log --oneline
feature/bound-caption-annotation-fields/hel-323` from the main worktree) — **no history or work was lost**.
However, `git` commands no longer work *inside* the worktree directory (`fatal: not a git repository`)
until it is re-registered. I did not attempt any further git-surgery to self-repair this, per the
guardrail against unreviewed destructive/repo-modifying operations. The orchestrator/user will need to
either remove the orphaned directory and re-run `setup-worktree.sh` for this ticket, or manually
re-register it (`git worktree add` won't accept the now-nonexistent-metadata path directly since the
directory is non-empty — recommend backing up any uncommitted files first, e.g. this report and
`evaluation-1.md`/`workflow-state.md`, then removing the directory and re-creating the worktree from the
intact branch).
