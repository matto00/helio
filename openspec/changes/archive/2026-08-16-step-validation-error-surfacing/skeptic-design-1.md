## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**1. "Already shipped" claim for ticket bullets 1-2 (HEL-407 final-gate fix + HEL-404 plumbing)**

- `StepCard.tsx:339` — `{step.opType.id !== "compute" && <InlineError error={validationError ?? null} />}`
  renders the generic error for every non-compute op in the expanded body. Read the full file
  (513 lines, `wc -l` confirms the plan's stated pre-change size).
- `ComputeFieldConfig.tsx:84` — `<InlineError error={validationError ?? null} />` is the compute
  op's own render (receives `validationError` as a prop from `StepCard.tsx:364`), so there is no
  double-render — confirmed by reading both files, not just the plan's claim.
- Prop wiring for every op: `PipelineDetailPage.tsx:235-241` defines
  `getAnalyzeValidationError(stepId)` reading `analyzeResult.steps.find(...).validationError`
  (no compute-only gating), passed at `PipelineDetailPage.tsx:514` to `PipelineRiverView`, which
  calls it per-step and passes the result as `validationError={...}` to every `StepCard` at
  `PipelineRiverView.tsx:180` (unconditional, all ~20 op branches share one `StepCard` render
  path). This is universal wiring, not compute-specific.
- Commit provenance: `git show ea726167` confirms this is HEL-407's final-gate CR1/CR2 fix,
  merged into `e2fa88b1` (this branch's base) — matches the plan's cited commit exactly.
- Existing test coverage matches the plan's description precisely: `StepCard.test.tsx:558-596`
  ("StepCard validationError surfacing (skeptic-final-1.md CR1)") already has three tests —
  non-compute shows message (559), absent shows nothing (567), compute renders exactly once
  (575) — i.e. the "compute-no-double-render" coverage the design.md flags as possibly needed is
  in fact already present. No gap found; the plan's "verify + codify, don't re-implement"
  framing for AC1 is accurate.

Conclusion: ticket bullets 1-2 are genuinely shipped. No under-delivery risk from treating this as
verification-only work.

**2. Errored-card marking — Decision 2's "non-interactive content inside the toggle button" claim**

- Read the post-HEL-407 header structure (`StepCard.tsx:260-325`): the toggle `<button>` already
  contains non-interactive static content as siblings-within-the-button — the icon (aria-hidden),
  label `<span>`, and a row-count `<span className="...step-card-count">` (line 278-282,
  unconditional on `rowCount !== null`). The drag handle and Move up/down buttons are genuine
  siblings of the toggle button (in `.step-card-actions-cluster`, `StepCard.tsx:290-324`) — outside
  it, per the in-code comment citing the `SidebarItemList.renderRowAction` precedent.
- Read `SidebarItemList.tsx:57-67` directly: it draws exactly the interactive/non-interactive line
  the design.md claims — `renderBadge` "renders *inside* that button" (non-interactive), while
  `renderRowAction` is "a genuine sibling element, not nested inside the row's own `<button>`...a
  clickable control here needs no `stopPropagation()`". A live consumer,
  `SidebarBody.tsx:210-214`, renders `renderBadge` as a static `<span className="dashboard-list__badge">Content</span>`
  inside the row button — the same pattern (static chip nested in a clickable row control) the
  design proposes for the new error chip.
- This is a real, pre-existing codebase precedent that distinguishes interactive-must-be-sibling
  from static-content-may-nest — not a post-hoc rationalization. The design's claim survives
  scrutiny.
- DESIGN.md:229 ("Color is never the sole carrier of meaning") is satisfied: the chip carries an
  icon shape (triangle-exclamation) plus `role="img"` + `aria-label`, not color alone.
- `faTriangleExclamation` exists in the installed `@fortawesome/free-solid-svg-icons` package
  (verified via `ls node_modules/@fortawesome/free-solid-svg-icons/ | grep -i triangle`).

**3. Token family, card-modifier precedent, and other spec grounding**

- `--app-error` and `--app-error-surface` are defined in both theme blocks —
  `frontend/src/theme/theme.css:112-118` (dark) and `:156-162` (light) — and are the exact tokens
  `InlineError.css:3` already consumes (`color: var(--app-error);`). DESIGN.md:88 lists
  `--app-error` (+ `--app-*-surface` washes) under the "Intent" token family, so this is an
  in-family reuse, not a new token.
- `--expanded` card-modifier precedent: `PipelineDetailPage.css` (`.pipeline-detail-page__step-card`
  base rule immediately followed by `.pipeline-detail-page__step-card--expanded { border-color:
  var(--app-border-strong); background: var(--app-surface-raised); }`) — confirms the plan's
  "`--expanded` modifier precedent at PipelineDetailPage.css:347+" claim; `--errored` as a sibling
  modifier on the same selector is a natural, consistent extension.
- Analyze refresh auto-clears the prop: `PipelineDetailPage.tsx` debounces the analyze re-fetch at
  300ms (`:186`), matching the design's claim that a config fix propagates without manual action —
  supports AC3's "clears on fix" holding by construction once the marking derives from the same
  prop (Decision 2/3).
- The new spec fills a real gap: `openspec/specs/pipeline-step-reorder/spec.md:64` already
  references "the existing per-step validation display" but no spec defines it — codifying it now
  is legitimate, not scope invention.
- Traced all 5 ACs to concrete evidence: AC1 → already-shipped code above (task 2.1
  verification-only); AC2 → new `--errored` modifier + header chip (tasks 1.1/1.2, tests 3.1);
  AC3 → single-source-of-truth from `validationError` prop, tested in 3.2; AC4 → DESIGN.md-token
  usage + existing/new `StepCard.test.tsx` coverage; AC5 → frontend-only, reads existing prop, no
  wire change (proposal.md Impact section, confirmed no backend files touched by design's plan).

### Verdict: CONFIRM

The scope-narrowing claim is accurate and independently verifiable against ground truth — no part
of ticket bullets 1-2 is missing. The new work (Decisions 1-3) is minimal, token-only, reuses an
established interactive/non-interactive-content precedent from `SidebarItemList`, and every AC
traces to either already-shipped code or a concrete planned task. No placeholders, no internal
contradictions between proposal/design/tasks, no missing acceptance signal, no scope drift.

### Non-blocking notes

- Design's growth estimate (513 → ~525 lines, ≤~12) is plausible but not verified since no code
  exists yet — routine to confirm at the final gate via `files-modified.md` per task 3.4.
- The `--errored` BEM-modifier name diverges slightly from other error-state modifiers in the
  codebase (`--error` in `ToolCallIndicator.css`/`StatusMessage.css`, `--invalid` in
  `PanelGrid.css`) but reads clearly as parallel to the existing `--expanded` modifier on the same
  selector; not worth blocking on.
