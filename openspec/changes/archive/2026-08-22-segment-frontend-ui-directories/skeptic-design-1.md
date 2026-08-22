## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Cold review of the HEL-635 planning artifacts. Every conclusion below is derived from the
tree at `ecee3af8db3c0ccdbff914a65c5f655d615bfda3`, not from the artifacts' narrative.

### What I verified (with evidence)

**a. Enumeration — counts and placement map reconcile exactly. CONFIRMED.**

```
pipelines/ui flat: 101   recursive: 101
panels/ui    flat:  76   recursive: 145
sources/ui   flat:  30   recursive:  30
subdirs: panels/ui/{creationSteps,creators,editors,renderers} only
```

Independently classifying every file by D1's rules (script, not eyeball):

| dir | groups | total |
| --- | --- | --- |
| pipelines/ui | stepConfigs 42, computedFields 5, schedule 5, shapes 6, proposalReview 6, root 37 | **101 of 101** |
| panels/ui | detailModal 20, grid 19, root 37 | **76 of 76** |
| sources/ui | forms 13, root 17 | **30 of 30** |

Zero unassigned, zero double-assigned. `stepConfigs/` = 21 ops × 2, and the 21 names match D1's
list exactly (incl. `AssertConfig`). The `ComputeFieldConfig` vs `ComputedField*` trap D1 calls
out is real and D1 resolves it correctly. D1's root enumerations match the computed root sets
member-for-member for all three dirs. The ticket's stale names (`PipelineScheduleBar`, and also
`BoundSourceBar`/`BoundTypeBar`, which D1 does not mention) are indeed absent from the tree; the
placement map is derived from the tree, so nothing is orphaned.

**b. Path-sensitive coupling — every D3 claim independently verified, and the sweep widened.**

- `frontend/jest.config.cjs`: `testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/src/**/*.test.tsx"]` —
  recursive, depth-independent. All 6 `moduleNameMapper` keys are extension- or module-name-based
  (`\\.(css)$`, `^.*/config/env$`, `^react-markdown$`, `^remark-gfm$`, `^echarts-for-react/esm/core$`,
  `^echarts/(core|charts|components|renderers)$`). None directory-based. **Claim true.**
  (Root `jest.config.cjs` has `testPathIgnorePatterns: [... "/frontend/" ...]` — unaffected.)
- `frontend/tsconfig.json`: no `paths`, no `baseUrl`, `include: ["src", ...]`. Root `tsconfig.json`:
  no `paths`/`baseUrl`. **Claim true.**
- `frontend/vite.config.ts`: no `resolve.alias`, no path-substring `manualChunks`. **Claim true.**
- CSS-content tests: all 5 in scope resolve `path.join(__dirname, "<same-dir sibling>")` —
  `MarkdownPanel.css.test.ts:13`, `MobilePanelStack.css.test.ts:20`, `PanelDetailModal.css.test.ts:18`,
  `PanelDetailModal.mobile.css.test.ts:16`, `PipelineDetailPage.css.test.ts:15`. D1 keeps each with
  its CSS, so **not one of these path strings even changes.** **Claim true.**
- Live docs: `docs/compute-expression-grammar.md:4` cites `ComputeFieldConfig.tsx` (moves → must be
  updated); `docs/uploads.md:59` cites `markdownUrls.ts` and `notes/mobile-pwa-handoff.md:384` cites
  `renderers/` (both stay); two backend Scala comments cite `panels/ui/editors/` (untouched).
  **Claim true.**
- Extending the sweep past what D3 claims to have searched: `eslint.config.cjs` (no path-scoped
  `files:`/`ignores:` for these dirs), `.prettierignore`, `.github/workflows/ci.yml` (`paths-ignore`
  is `**.md`/`LICENSE`/`docs/**` only), `.husky/pre-commit`, `e2e/` (no `features/` references),
  `playwright.config.ts` — all clean. No `@import` in any moved CSS file. No `__snapshots__`
  directories anywhere in the three dirs (recursive count == flat count for two of them).
- Rename-detection risk on D4 step 1: worst-case changed-line fraction across all 116 movers is
  **6.5%** (`PanelDetailModal.collection.test.tsx`, 8 of 123 lines); zero files above 20%. Far above
  git's 50% similarity floor — step 1 will not spuriously report A/D.
- Op-wiring checklist (the ticket explicitly asks for it): read
  `~/.claude/projects/-home-matt-Development-helio/memory/feedback_pipeline_op_wiring.md`. It names
  `<Op>Config.tsx`, `CastFieldsConfig`, `FilterConfig`, `StepCard` but records **no directory path
  strings** — the Planner Note is factually correct, and deferring the `~/` edit for explicit user
  approval is right per CLAUDE.md.
- Repo hygiene gates run fresh against the planned artifacts:
  `npm run check:spec-structure` → `spec-structure check passed (319 canonical specs, 0 issues)` (exit 0);
  `npm run check:openspec` → `openspec/ is clean` (exit 0).

**c. The `PanelDetailModal.css.test.ts` retraction — CORRECT. Verified by measurement, not reading.**

```
PanelDetailModal.appearance.css : 0 × "max-width: 768px"   0 × "min-height: 44px"
PanelDetailModal.binding.css    : 0                        0
PanelDetailModal.css            : 0                        0
PanelDetailModal.mobile.css     : 1                       15
PanelDetailModal.sections.css   : 0                        0
```

`.panel-detail-modal__mode-toggle-btn` appears in `PanelDetailModal.mobile.css:68` and **nowhere in
`PanelDetailModal.css`**. So the test reads the file where the rules it asserts on actually live: it
is a live HEL-245/303/255/248/247 tap-target guard whose *filename and describe-block labels* are
stale, not a guard pointing at the wrong file. `PanelDetailModal.mobile.css.test.ts` is a genuinely
different guard (HEL-772 `<=430px` additive header inset). The retraction holds; preserving the
filename verbatim is the right call for a moves-only change, and D1 correctly keeps all 5 CSS files
and both tests together in `detailModal/`.

**d. `proposalReview/` and the new capability.** Judged sound as decisions (see Non-blocking notes),
but see CR5 for how they were recorded.

**e. D4 attacked directly — this is where the plan breaks.** See Change Requests 1–3. Summary of the
measurement: the residue filter demonstrably over-consumes real content lines *inside moved files*,
and steps 1 and 2 have no line-level resolution with which to bound it.

### Verdict: REFUTE

The enumeration, the placement map, the coupling sweep, and the `PanelDetailModal.css.test.ts`
retraction all survive adversarial checking — that part of the plan is genuinely good. The
move-integrity gate does not. D4 is the plan's entire defense against its own stated largest risk,
and as specified it has a hole wide enough to pass exactly the failure it was written to catch.

### Change Requests

1. **D4 step 3 leaves every in-place-modified file completely unguarded — extend the residue check
   from renamed files to all changed files.** Step 3 applies to "every renamed file" (116 files).
   Measured: **15 further files with 78 changed specifier lines are modified in place and get no
   content check at all**, and 5 of them sit *outside* the three `ui/` dirs so steps 1 and 2 never
   look at them either:

   | file | changed lines |
   | --- | --- |
   | `frontend/src/features/pipelines/ui/StepCard.tsx` | 21 |
   | `frontend/src/features/pipelines/hooks/useStepCardState.ts` | 17 *(outside the three dirs)* |
   | `frontend/src/features/pipelines/state/stepNarrowing.ts` | 17 *(outside)* |
   | `frontend/src/features/sources/ui/AddSourceModal.tsx` | 7 |
   | `frontend/src/features/panels/ui/PanelList.tsx` | 3 |
   | `PanelList.{test,onboarding.test,gridWidthSharing.test}.tsx` | 2 each |
   | `app/AppRoutes.tsx`, `features/dataTypes/ui/TypeDetailPanel.tsx`, `features/proposals/ui/CombinedProposalReview.tsx`, `features/panels/ui/creationSteps/ShapeInstantiateStep.tsx`, `features/panels/ui/PanelCardBody.predispatch.test.tsx`, `features/pipelines/ui/{PipelineDetailPage,PipelineRiverView}.tsx` | 1 each |

   These are precisely the files a bulk `sed`/`perl` import rewrite damages — the same shape as the
   sibling ticket's filter that silently deleted 493 lines while its own self-check reported clean.
   Revise D4 (and tasks 6.1–6.3) so the per-file content comparison covers **every path in
   `git diff -M --name-status HEAD`, status `R` *and* `M`**, not just `R`.

2. **The stated bound is false: steps 1 and 2 cannot bound step 3, and the filter provably
   over-consumes.** D4 asserts "Step 1 and 2 bound it from the other side". Step 1 is a per-file
   *status* check and step 2 is a *file-count* check — both file-level. The failure mode in question
   (a mutated content line that the filter swallows) is line-level, so neither can observe it. This
   is not theoretical; the filter `^[+-].*(from ["']|require\(|jest\.mock\(|import\()` swallows
   **4 real content lines inside files that are being moved**:

   - `frontend/src/features/panels/ui/PanelGrid.test.tsx:27` — `Responsive: jest.fn(({ children }: { children?: import("react").ReactNode }) =>`
   - `frontend/src/features/panels/ui/DesktopPanelGridSkeleton.test.tsx:19` — `children?: import("react").ReactNode;`
   - `frontend/src/features/sources/ui/SqlTab.test.tsx:56` and `:80` — `// ── Infer schema … (task 6.5; renamed from "Test connection" — HEL-480 design Decision 6) ──`

   Corrupt or delete any of those four and: step 1 still reports `R` (6.5% worst-case line churn is
   nowhere near the 50% similarity floor), step 2 still counts 101/76/145/30, step 3 strips the line
   and reports empty residue. **All three steps pass on a corrupted file.** (11 more such lines exist
   in files that stay put — e.g. `PipelineDetailPage.tsx:157`, `echartsCore.ts:2`,
   `PanelCreationModal.tsx:423`, `PanelList.test.tsx:193,657` — which CR1 brings into scope.)

   Replace the one-sided "strip the diff, residue must be empty" test with a two-sided content
   comparison. Any of these is sufficient; pick one and specify it:
   - strip specifier lines from the **old** file and the **new** file *independently*, require the
     two residual line sequences to be byte-identical **and** the stripped-line counts to be equal,
     then pairwise-compare each stripped line requiring that **only the quoted specifier differs**; or
   - recompute the expected new content deterministically (rewrite each relative specifier for the
     new location) and compare byte-for-byte against the `sha256` baseline task 1.2 already collects.

   Whichever is chosen, D4's "Step 1 and 2 bound it from the other side" sentence must be corrected —
   as written it is the reasoning that justifies leaving the hole open.

3. **The red-before-green test as specified will not exercise the hole.** D4 step 4 / task 6.4 mutate
   "one non-import line in one moved file" — a line the filter does *not* match, so it proves only
   that the easy case fails. Require at minimum three red cases, each shown FAILING with pasted
   output before the checker is trusted:
   (a) a plain content line in a moved file (the current case);
   (b) **one of the four filter-matching content lines named in CR2** (e.g. mutate
       `PanelGrid.test.tsx:27`) — this is the case the current design silently passes;
   (c) a content line in an in-place-modified file (e.g. `features/pipelines/state/stepNarrowing.ts`)
       — the CR1 case.
   Task 6.5's revert confirmation must cover all three.

4. **The incoming-reference enumeration is wrong in both directions — correct it.**
   `proposal.md` ("Impact": `app/AppRoutes.tsx`, `app/App.tsx`, `shared/ui/`) and `tasks.md` 5.2
   ("`app/`, `shared/`, sibling features") both:
   - name files that need **no** change — `app/App.tsx:6` imports `CreatePipelineModal` and
     `shared/ui/SuspenseFallback.tsx:3` / `shared/ui/skeletonAccessibility.test.tsx:6-7` import
     `PanelBodySkeleton`/`PanelCardSkeleton`, **all of which stay at their root**; and
   - omit the two largest reference sites, which are in the **same feature's non-`ui/` directories**
     (a category the phrase "`app/`, `shared/`, sibling features" does not cover):
     `features/pipelines/hooks/useStepCardState.ts:39-55` (17 specifier lines) and
     `features/pipelines/state/stepNarrowing.ts:59-75` (17 lines), each importing 17 `../ui/*Config`
     types that become `../ui/stepConfigs/*Config`.
   Replace the enumeration with the measured set: **15 files, 78 lines** (table in CR1). This matters
   beyond tidiness — the understated impact set is plausibly what made "renamed files only" look like
   near-complete coverage in CR1.

5. **`ticket.md`'s acceptance criteria are planner-authored and fold self-approved decisions into the
   rubric — mark them as such.** The real Linear ticket HEL-635 has no numbered ACs and **never
   mentions `proposalReview/`**; change-dir `ticket.md` AC1 lists it as though the ticket required it.
   Likewise `grid/` silently extends the ticket's named list (`MobilePanelStack`, `mobilePanelHeights`,
   `DesktopPanelGrid`, `PanelGrid`, `panelGridConfig`) with 8 further skeleton files
   (`PanelGridSkeleton.*`, `panelGridSkeletonStubs.*`, `DesktopPanelGridSkeleton.*`,
   `MobilePanelStackSkeleton.*`). Both decisions are **sound** and both are disclosed in design.md
   D2 / Planner Notes — but the final-gate evaluator traces ACs from `ticket.md`, where they now read
   as ticket requirements rather than planner choices. Annotate the planner-derived ACs (and the
   `grid/` skeleton extension) inline in `ticket.md` as planner-added, so the rubric stays
   distinguishable from the plan.

### Non-blocking notes

- **`scripts/` was never named as a swept location, and it is one.**
  `scripts/check-schema-drift.mjs:28` hard-codes
  `frontend/src/features/dashboards/ui/ProposalReview.tsx` — a *different* feature, untouched here,
  so nothing breaks. But it proves a **pre-commit gate can hard-code a `features/*/ui/` path**, and
  D3's sweep enumerates only jest/tsconfig/vite/docs. Add `scripts/` to D3's swept list. (Also worth
  noting for the executor: `dashboards/ui/ProposalReview.tsx` and the new
  `pipelines/ui/proposalReview/` are unrelated — do not conflate them.)
- `git mv` will not create the destination directory. Tasks 2.1–4.1 say `git mv … into `<subdir>/``
  with no `mkdir -p` step. Loud, immediate failure — trivial, but worth one clause.
- The capability's justification overclaims. "Recording it is also the only thing that stops new
  files drifting back to the flat root" — a prose spec with no machine enforcement documents intent,
  it does not stop drift. Note the disanalogy with the cited precedents: `openspec-spec-hygiene` and
  `openspec-archival-hygiene` are each backed by an executable checker (`check-openspec-hygiene.mjs`,
  `check-spec-structure.mjs` — both of which I ran green above); this one is not. Introducing the
  capability is still a defensible, disclosed call — building a placement lint rule would be real
  scope creep on a moves-only ticket — but soften the claim.
- The capability's scenarios are testable-in-review rather than machine-testable. The third
  requirement ("Directory segmentation preserves file content") is the strongest and is genuinely
  falsifiable; the first requirement's scenarios are conventions for future work. Acceptable, given
  the above.
- Verified and requiring no action: no `@import` in any moved CSS; all 5 in-scope disk-reading tests
  reference same-directory siblings so **zero path strings change**; no side-effect `import "…"`
  specifier changes anywhere in the change (0 of 45), so the D4 filter's blind spot on
  `import "…"` lines — real in principle, since that form matches none of its four alternatives —
  has no instances here.
- D4 step 1's wording is loose: "Every path in the three directories must appear … as `R`" is false
  for the 160 paths in those directories that do not move (they appear as `M` or not at all). CR1's
  rewrite should restate it as "every path in the *move set* appears as `R`; no path in the three
  directories appears as `A` or `D`."
