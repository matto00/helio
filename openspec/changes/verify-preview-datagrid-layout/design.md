## Context

See proposal.md - Why. Three `DataGrid variant="preview"` call sites plus `SourcePreviewSkeleton`'s
hand-rolled markup need to be reached in the running app, in both themes, and measured against
`a6bde0d3^` (HEL-451's parent). Five prior attempts (executor, evaluator x2, final-gate skeptic)
across HEL-451's own delivery all failed to reach any of them. A live measurement, not a CSS read
or a Jest run, is what the ticket requires (per its own Note and per MISTAKES.md's
`feedback_visual_cohesion_gate` and `feedback_fixture_change_is_a_symptom` precedent — a passing
Jest suite proved nothing for HEL-451's four post-implementation defects).

An unverified hypothesis (from the driver, corroborated by two other in-flight lanes HEL-465/HEL-1065):
the dev-environment user may own zero Outputs (HEL-904 shared-dev-DB residue), 403-ing the writes
needed to create a source/pipeline/step to preview — which would explain why five attempts bounced.

## Goals / Non-Goals

**Goals:**
- Reach each of the three call sites (pipeline step preview, source detail preview, SQL schema
  preview) plus `SourcePreviewSkeleton`, in the running dev app, light and dark theme.
- At each, measure the rendered space above the `.ui-data-grid` element (`getBoundingClientRect` /
  computed margin, via Playwright `browser_evaluate`) and record it, then repeat against a checkout
  of `a6bde0d3^` for the same call site, same data shape, same viewport.
- Diagnose and (if confirmed) resolve why five prior attempts failed to reach these surfaces, so this
  attempt does not become a sixth unverified report — and so the diagnosis is durably recorded either
  way (fixed root cause, or confirmed dead end with the real blocker named).
- Fix only if a genuine geometry regression is measured; otherwise record "measured, no regression."

**Non-Goals:**
- Adding filtering to `preview` (HEL-451's own out-of-scope, restated in the ticket).
- Any change to `--full`-variant DataGrid behavior.
- A general fix for the HEL-904 zero-Outputs dev-DB gap beyond what's needed to reach these three
  call sites (that gap, if confirmed, is bigger than this ticket and gets recorded, not solved here).

## Decisions

- **Reach strategy, in order:** (1) try each call site cold via Playwright exactly as a user would
  (Sources > add/open a source > SQL tab connection test; open a source's detail panel; open a
  pipeline's step card). (2) If step (1) 403s or the UI has no create affordance reachable without
  existing data, inspect the network response body for the 403's cause before assuming HEL-904 -
  confirm via the backend logs / a direct API probe (`curl` against the dev backend with the
  session cookie) rather than assuming the hypothesis is correct. (3) Only if confirmed, seed the
  minimum fixture (e.g. one Output-producing pipeline, or a raw DB row insert scoped to the dev user)
  needed to make the preview reachable, and record exactly what was seeded and why in the eval
  report - this is a dev-environment fixture, not a schema or migration change, and never ships in
  the PR diff.
- **Comparison method, datum (skeptic-design-1.md CR1):** "relative to its previous sibling" is not
  usable as the measurement datum — the reframe changed what the previous sibling *is* (post-reframe
  it's frame chrome inside `.ui-data-grid__frame`; pre-reframe it was the consumer's own preceding
  content, e.g. `SqlTab.tsx`'s `.add-source-modal__preview-hint`). Measure instead, per call site, the
  distance from the **bottom of the nearest preceding consumer-owned element** (named explicitly per
  call site below) to the top border-box of `.ui-data-grid--preview`, at a fixed viewport
  (1280x800), via `browser_evaluate` `getBoundingClientRect()`. Report the computed `margin-top` too,
  as a secondary diagnostic, not the primary number:
  - StepCard: bottom of the step's header/summary row immediately preceding the preview block.
  - SourceDetailPanel: bottom of the preview section's own heading/control row preceding the grid.
  - SqlTab: bottom of `.add-source-modal__preview-hint` (`SqlTab.tsx:219`).
- **Comparison method, baseline isolation (skeptic-design-1.md CR2):** HEAD vs `a6bde0d3^` is
  confounded — three further `DataGrid`-touching commits (`dae1117e` HEL-465, `3baa1ebf` HEL-458,
  `9d1734fa` HEL-1065) sit between them. Measure the **isolating pair `a6bde0d3` vs `a6bde0d3^`** to
  attribute any delta to the reframe specifically, and separately measure HEAD as a third data point
  for today's shipped geometry. If HEAD differs from `a6bde0d3`, the cause is one of those three later
  commits, not the reframe — state this explicitly in the report rather than conflating the two.
- **Comparison method, worktree hygiene (skeptic-design-1.md CR3):** `git stash`+checkout in the
  delivery worktree is forbidden — it mutates the tree under review mid-run (the same class of hazard
  as the recorded cleanup-mid-review incident). Use a separate throwaway worktree only (via
  `git worktree add`, its own scratch dev/backend ports), and verify its teardown with `git worktree
  list` output (not an assertion) once measurement is done.
- **`SourcePreviewSkeleton` drift check:** diff its rendered DOM class list/structure directly
  against `DataGrid`'s resolved `--preview` markup (both mounted in the running app) rather than
  only reading source - confirms the `ui-data-grid ui-data-grid--preview ui-data-grid--condensed`
  classes it hand-rolls are still exactly what `DataGrid` itself emits for `variant="preview"`.
  **Pre-stated expected finding (skeptic-design-1.md non-blocking):** `SourcePreviewSkeleton.tsx:30`
  already renders a bare `.ui-data-grid` with no `__frame` wrapper, while a real resolved
  `variant="preview"` render now emits `.ui-data-grid__frame > .ui-data-grid`. This is an *expected*,
  pre-existing divergence (the skeleton never needed frame chrome — it has none of the toolbar/
  quick-filter elements the frame exists to host), not itself the regression this ticket hunts for.
  Task 2.3 must render an explicit ship/no-ship judgement on whether that skeleton→resolved DOM swap
  is visually acceptable (a wrapper appearing/disappearing at load-resolve boundary), not just a
  bare pass/fail on class-list identity.
- **Empty-state preview coverage (skeptic-design-1.md non-blocking):** the zero-row preview path
  renders no frame at all (`DataGrid.css:7` comment). Measure the empty state at one call site (e.g.
  SqlTab with an empty inferred-fields result, or SourceDetailPanel's "no rows" path) alongside the
  populated-state measurements, so the "frame is neutral for preview" claim is checked across all
  three preview structural states (skeleton, populated, empty), not just the populated one.
- **No spec changes** (`skip_specs: true`): this ticket's own deliverable is a measurement/record,
  not a new or modified capability. A regression fix, if any, is a bug-level correction to existing
  HEL-451 behavior already specified, not a new requirement.

## Risks / Trade-offs

- [Risk] Fixture seeding for HEL-904 could itself be non-trivial or risk touching shared dev DB
  state other lanes depend on → Mitigation: seed the minimum row set scoped to the dev user only,
  record exactly what was added, and coordinate via MISTAKES.md-style note rather than a silent
  side effect; never touch another user's rows.
- [Risk] A second worktree at `a6bde0d3^`/`a6bde0d3` doubles dev-server/DB setup cost → Mitigation:
  reuse `setup-worktree.sh`-style scratch ports on a throwaway comparison worktree, torn down
  immediately after measurement (verified via `git worktree list`); this is throwaway tooling, never
  part of the shipped diff, and never a `git stash` in the delivery worktree itself (CR3).
- [Risk] Genuinely cannot reach a call site even after real effort → Mitigation: per the ticket's
  explicit instruction, escalate to the driver rather than parking it a sixth time.

## Migration Plan

None - this ticket ships no schema/migration/API change. If a CSS/markup regression fix is needed,
it is a normal frontend patch with its own Jest guard, delivered and reviewed like any other change.

## Planner Notes

- Self-approved `skip_specs: true` - no spec-level behavior is introduced or (pre-emptively) changed;
  see proposal.md Capabilities.
- Self-approved the "measured, no regression, recorded" outcome as a fully successful, non-code
  deliverable per the ticket's own explicit framing - no design-gate concern here since the ticket
  itself pre-approves this outcome.
