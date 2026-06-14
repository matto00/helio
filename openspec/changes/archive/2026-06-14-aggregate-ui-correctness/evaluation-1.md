## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues:
- The ticket description mentions "16 direct unit tests" but the implementation delivers 15. The
  authoritative task list (tasks.md items 1.2–1.8 + single-row edge cases) maps exactly to 15
  tests, all verified present and passing. The informal ticket count is the mismatch; no actual
  AC is missing. Non-issue.
- All tasks.md items marked [x] match what was implemented.
- FN_HINTS text matches the spec-prescribed strings verbatim.
- Blur-gated alias validation matches the design spec (Set<number>, InlineError, blur-first).
- Relationship description text matches spec exactly.
- No scope creep; no regressions to other specs.
- No API contract changes (correct — change is additive UI + new test file only).

### Phase 2: Code Review — FAIL
Issues:
1. **Dead code in AggregateStepSpec.scala:13–15** — `private val stepId`, `private val pipelineId`,
   and `private val now` are declared but never referenced in any test body. The spec calls
   `AggregateStep.apply(rows, cfg(...))` directly without constructing an `AggregateStep` instance,
   so these vals serve no purpose. CONTRIBUTING.md §"No dead code" is violated.

2. **New CSS class names have no style definitions** — `AggregateConfig.tsx:114` adds
   `<p className="pipeline-detail-page__aggregate-section-description">` and `AggregateConfig.tsx:179`
   adds `<span className="pipeline-detail-page__aggregate-fn-hint">`, but no CSS entry for either
   class exists anywhere in the frontend (confirmed via grep across all `.css` files). The elements
   render as unstyled body text: the description `<p>` appears the same size/weight as the section
   label, and the fn hint `<span>` appears indistinguishable from surrounding content. The design
   spec prescribes muted, smaller-text presentation for contextual hints (DESIGN.md §3:
   `--app-text-muted`, `--text-xs`). Note: the pre-existing `pipeline-detail-page__aggregate-*`
   classes are also unstyled, so this is an extension of a pre-existing problem — but this PR adds
   two more unstyled class names without addressing the gap. Adding named classes with no CSS
   backing is a DRY/maintainability smell.

3. **Silent fallback for unknown fn** — `AggregateConfig.tsx:180`: `FN_HINTS[agg.fn as (typeof AGG_FNS)[number]]`
   will evaluate to `undefined` if `agg.fn` holds a persisted value not in `AGG_FNS` (e.g., a
   future function or corrupted config). The `<span>` renders silently empty rather than showing
   a fallback. Not a crash, but a silent failure path that CONTRIBUTING.md flags. Low severity
   since the backend enforces valid fn values, but the cast + missing guard is not clean.

### Phase 3: UI Review — PASS
Issues:
- All three key behaviors confirmed in the browser:
  1. **Relationship description** ("Group-by fields define the partition keys. Each unique
     combination becomes one output row.") renders below the "Group by" section label. ✓
  2. **Function hints** render below the fn dropdown and update reactively when the fn changes
     (confirmed sum→"Sums numeric values; ignores nulls", count→"Counts non-null values in the
     field"). All five function hints confirmed present by DOM query. ✓
  3. **Blur-gated alias validation**: no "Output name required" error shown immediately on a new
     row; error appears after Tab (blur) on empty alias; error disappears after typing a non-empty
     alias. ✓
- No console errors during the tested flow.
- Dry run returned 422 with message referencing a missing CSV upload path — this is a
  pre-existing seed-data drift between worktrees (the CSV was uploaded in the main worktree
  and does not exist at the referenced path in this worktree). Unrelated to this change.
  The aggregate engine correctness was verified instead via `sbt testOnly AggregateStepSpec`
  (15/15 passed) and the plan step was saved/reloaded successfully via the API.
- Accessible alias input name (`aria-label="Alias for aggregation 1"`) matches what the tests
  use. ✓
- No layout breakage at 768px. ✓

### Overall: FAIL

### Change Requests
1. **Remove the three unused private vals in AggregateStepSpec.scala:13–15.**
   `private val stepId`, `private val pipelineId`, and `private val now` are declared but never
   used. Delete all three lines. (CONTRIBUTING.md: no dead code.)

2. **Add CSS for the two new class names in PipelineDetailPage.css** (or a co-located
   AggregateConfig.css if preferred). At minimum:
   - `.pipeline-detail-page__aggregate-section-description` — muted, small body text. Use
     `color: var(--app-text-muted); font-size: var(--text-xs); margin: var(--space-1) 0 var(--space-2);`
   - `.pipeline-detail-page__aggregate-fn-hint` — muted hint below the fn dropdown. Use
     `color: var(--app-text-muted); font-size: var(--text-xs);`
   Without these, the hint and description are indistinguishable from other content and the
   class names serve no visual purpose. All values must use design tokens (DESIGN.md §3 [mechanical]).

### Non-blocking Suggestions
- `AggregateConfig.tsx:180`: consider adding a null-coalescing guard before the `<span>` renders,
  e.g. `{FN_HINTS[agg.fn as ...] ?? null}` or use `FN_HINTS[agg.fn as ...] || ""` to avoid
  rendering an empty span. The backend already validates fn values so this won't fire in normal
  usage, but it's cleaner.
- The `agg.fn as (typeof AGG_FNS)[number]` cast is somewhat fragile; a lookup helper
  `const hint = FN_HINTS[agg.fn as (typeof AGG_FNS)[number]]` with an early `if (!hint) return null`
  guard would be more self-documenting.
