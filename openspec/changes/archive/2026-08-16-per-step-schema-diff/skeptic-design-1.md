## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

All planning artifacts read in full: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/pipeline-step-schema-diff/spec.md`. Cross-checked every specific ground-truth claim
against the actual worktree code (base `e71968c5`, HEL-404 merged).

1. **Hardcoded placeholder chips, fallback branch only.** Confirmed at
   `frontend/src/features/pipelines/ui/StepCard.tsx:374-384` (design cites 374-383, off by one
   line at the closing `</div>` — immaterial): `+ col_a` / `− col_b` / `~ col_c` inside the
   `else` arm of the giant `step.opType.id === ... ? ... : (...)` ternary that starts at line
   254 and covers all 21 op kinds before falling through to this fallback at line 369. Verified
   the fallback is genuinely the *only* place these chips render (grep for `col_a` in the file
   returns only this block).

2. **CSS recipe.** `frontend/src/features/pipelines/ui/PipelineDetailPage.css:413-443` (design
   cites 413-445; line 445 is actually the next class, `__step-card-actions` — immaterial)
   contains `.pipeline-detail-page__step-card-diff` (flex/wrap container) and
   `-diff-chip`/`--added`/`--removed`/`--changed`, all token-based
   (`--app-accent-surface`, `--app-accent`, `--app-accent-mid`, `--app-error-surface`,
   `--app-error`, `--app-accent-dim`, `--app-accent-strong`) except one pre-existing literal
   (`padding: 2px 7px` on the base class, line 422). Verified every cited token is real and
   themed (light/dark values in `frontend/src/theme/theme.css:100-162`), not hallucinated.
   Design correctly defers tokenizing that literal to HEL-680 rather than scope-creeping it in.

3. **`renamesOf` + rename config shape.** `frontend/src/features/pipelines/state/stepNarrowing.ts:249-251`:
   `renamesOf(step)` returns `(step.config as RenameConfigType).renames` when
   `step.opType.id === "rename"`, else `{}`. `RenameConfig.renames: Record<string, string>`
   confirmed at `frontend/src/features/pipelines/types/pipelineStep.ts:8-10`, and the
   old→new-map convention is independently confirmed by `openspec/specs/pipeline-rename-op/spec.md:6-10`
   (`renames: {"price": "cost"}`). `renamesOf` is already a proven helper (consumed today by
   `useStepCardState.ts:28,114,155`), so the design isn't inventing new plumbing.

4. **`AnalyzeStepResult` carries `type` + typed `config`.** Confirmed at
   `frontend/src/features/pipelines/types/pipelineStep.ts:309-433` — `BaseAnalyzeStep` carries
   `inputSchema`/`outputSchema`/`validationError`, and each variant (e.g. `RenameAnalyzeStep`)
   adds a `type` discriminant + typed `config`. `SchemaField = {name, type}` confirmed at
   line 304-307, matching the diff algorithm's name→type map approach.

5. **Backend identity fallback.** `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala`:
   every `infer*` function returns `(inputSchema, Some(errorMessage))` on any config/validation
   failure — i.e. `outputSchema == inputSchema` whenever `validationError` is set (doc comment
   at line 39 states this explicitly; verified against ~15 individual `infer*` implementations,
   e.g. `inferSplitText`/`inferPivot`/`inferUnpivot`/`inferAssert`). Confirms the design's
   "identity diff renders nothing" premise.

6. **No existing spec covers the diff chips.** Grepped all of `openspec/specs/` (`pipeline-step-preview`,
   `pipeline-editor-page`, `pipeline-rename-op`, and a repo-wide `col_a`/`diff`/`chip` search) —
   zero hits describing this behavior, real or placeholder. `pipeline-step-preview/spec.md`
   (HEL-404's spec) covers only the rows+output-schema preview tray, a structurally separate
   piece of the expanded card body; the proposal's "new capability, never spec-covered" claim
   and its "Modified Capabilities: none" claim both hold up.

7. **Props plumbing / no wire change.** `analyzeSchema`/`analyzeOutputSchema` are already
   StepCard props (`StepCard.tsx:75,79,93-95`), sourced from `PipelineDetailPage.tsx:212-229`'s
   `getAnalyzeSchema`/`getAnalyzeOutputSchema` (per-step lookup into the existing analyze
   response, no new fetch) and threaded via `PipelineRiverView.tsx:97-103`. Ticket AC4
   ("no wire change") is accurate.

8. **AC ↔ task traceability.** All four ACs map to concrete tasks: AC1 (real diff, placeholder
   gone) → tasks 1.1/2.1/2.3; AC2 (rename shown as rename where determinable) → design Decision 1
   + task 2.3's `renamesOf` gating; AC3 (unit-tested helper) → task 3.1's 8 pure-function cases,
   which cover every spec.md scenario; AC4 (DESIGN.md + backward-compat) → verified token reuse
   (item 2) and no backend/wire changes (item 7, and ticket's "Out of scope" is honored — no
   `PipelineAnalyzeService` edits planned).

9. **No placeholders/TBDs in the planning artifacts themselves** — grep for `TODO|TBD|FIXME|XXX`
   across all five change-dir docs returns nothing.

10. **File-growth budget is realistic.** Removing the 11-line placeholder block and adding one
    ~6-line render call + 2 import lines nets StepCard.tsx roughly flat to slightly smaller,
    consistent with the design's "≤~10 lines" budget and CONTRIBUTING.md's 400-line file
    guidance (already flagged in the ticket's delivery notes, correctly not bundling the
    HEL-682 split here).

### Verdict: CONFIRM

### Non-blocking notes

1. **`--renamed` chip token choice is underspecified.** Design Decision 3 says the new modifier
   should follow "the same token-only pattern as its three siblings" but doesn't pick a specific
   token combination distinct enough from `--added`/`--changed` to stay visually
   distinguishable (both currently use accent-family tokens). Not blocking at the design gate —
   this is exactly the kind of subjective call the final-gate visual review can catch if the
   executor's choice reads ambiguous next to the other three chips.
2. **The `renamed` bucket's `type` field (Decision 1's `Array<{from; to; type}>`) has no
   corresponding display** — the chip vocabulary (Decision 3) only renders `name → newName`,
   never a type change on a renamed column. A column that is both renamed and retyped in the
   same step will silently lose the retype signal in the UI even though the helper computes it.
   This is a defensible simplification (rename pairing removes the column from both add/drop
   *and* it can never land in the same-name `retyped` bucket by construction) but it isn't
   called out as a non-goal; worth a one-line acknowledgment if it comes up in review, not worth
   blocking the design over.
3. Task 2.3's phrasing ("pass `renamesOf(step)` only when `step.opType.id === 'rename'`") is
   redundant with `renamesOf`'s own internal gating (it already returns `{}` for every non-rename
   op), so the conditional the task describes is a no-op either way — harmless, just imprecise
   wording to be aware of during implementation/review.
