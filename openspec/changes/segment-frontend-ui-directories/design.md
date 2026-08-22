## Context

Measured on the current tree (`649f1490`, after merging `origin/main`), not from the ticket text. The ticket was
written 2026-07-27 and its enumeration has aged by roughly 72 files:

| Directory | Ticket claims | **Actual now** | Delta |
| --- | --- | --- | --- |
| `features/pipelines/ui/` | 71 | **101** | +30 |
| `features/panels/ui/` (root only) | 40 | **76** | +36 |
| `features/sources/ui/` | 24 | **30** | +6 |

`panels/ui/` additionally holds 69 files across four existing subdirectories (145 recursive), untouched here. Further
staleness: the ticket assigns `PipelineScheduleBar` to `schedule/` and **that file no longer exists** (nor do
`BoundSourceBar`/`BoundTypeBar`); it lists 20 step-op configs where there are **21** (`AssertConfig`); it says 14
`PanelDetailModal.*` files where there are **20**. The groupings are sound; only the enumeration aged.

## Goals / Non-Goals

**Goals:** segment the three directories; account for all 207 affected files; prove content identity across the move.

**Non-Goals:** component splits, prop changes, CSS rewrites, renames, deletions, anything outside `frontend/`, and any
fix to the pre-existing defect noted under Risks.

## Decisions

### D1 — Placement map (counts reconcile exactly)

**`pipelines/ui/` 101 = 42 + 5 + 5 + 6 + 6 + 37**
- `stepConfigs/` (42) — 21 ops × `{Op}Config.tsx` + `.test.tsx`: Aggregate, **Assert**, CastFields, ChunkByTokenCount,
  ComputeField, DateBucket, Dedupe, ExtractHeadings, FillNull, Filter, Limit, Lookup, Pivot, RenameFields,
  SelectFields, Sort, SplitText, StringOps, Union, Unpivot, Window.
- `computedFields/` (5) — `ComputedFieldForm.{tsx,css}`, `ComputedFieldsEditor.{tsx,css,test.tsx}`.
  Note `ComputeFieldConfig` (step op) is a *different* component from `ComputedField*` and goes to `stepConfigs/`.
- `schedule/` (5) — `PipelineScheduleDialog.{tsx,css,test.tsx}`, `schedulePreview.{ts,test.ts}`.
- `shapes/` (6) — `ShapeParamsFields.{tsx,css,test.tsx}`, `ShapePickerModal.{tsx,css,test.tsx}`.
- `proposalReview/` (6) — `PipelineProposalReview.{tsx,css,test.tsx}`, `PipelineProposalReviewPage.{tsx,test.tsx}`,
  `PipelineProposalSummary.tsx`.
- root (37) — `CreatePipelineModal.*`, `OpDropdown.*`, `PipelineDetailFooter`, `PipelineDetailHeader.*`,
  `PipelineDetailPage.*` (incl. `.css.test.ts`), `PipelineDetailSkeleton`, `PipelineEmptyState`, `PipelineListTable.*`,
  `PipelinePreviewModal.*`, `PipelineRiverView.*`, `PipelineShareDialog.*`, `PipelinesPage.*`, `RibbonSegment.*`,
  `RunHistoryModal.*`, **`StepCard.*`**, `StepSchemaDiffChips`. (Verified member-for-member against the tree.)

**`panels/ui/` 76 = 20 + 19 + 37**
- `detailModal/` (20) — every `PanelDetailModal.*`: 1 component, 5 CSS (`.css`, `.appearance.css`, `.binding.css`,
  `.mobile.css`, `.sections.css`), 2 `.css.test.ts`, and 12 further `.test.tsx` files.
- `grid/` (19) — `PanelGrid.{tsx,css,test.tsx}`, `PanelGridSkeleton.{tsx,test.tsx}`, `panelGridConfig.ts`,
  `panelGridSkeletonStubs.{ts,test.ts}`, `DesktopPanelGrid.tsx`, `DesktopPanelGridSkeleton.{tsx,test.tsx}`,
  `MobilePanelStack.{tsx,css,test.tsx,css.test.ts}`, `MobilePanelStackSkeleton.{tsx,test.tsx}`,
  `mobilePanelHeights.{ts,test.ts}`.
- root (37) — `ChartPanel.*`, `DividerPanel.*`, `echartsCore.ts`, `ImagePanel.*`, `MarkdownPanel.*`, `markdownUrls.*`,
  `PanelBodySkeleton.*`, `PanelCard.*`, `PanelCardBody.predispatch.test.tsx`, `PanelCardSkeleton.*`, `PanelContent.*`,
  `PanelCreationModal.*`, `PanelCreationPreview.*`, `PanelList.*`, `useChartCompact.ts`.

**`sources/ui/` 30 = 13 + 17**
- `forms/` (13) — `CsvForm.tsx`, `RestApiForm.tsx` (neither has a test), `SqlTab.{tsx,css,test.tsx}`,
  `StaticSourceForm.*`, `TextSourceForm.*`, `PdfSourceForm.*`, `ImageSourceForm.*`.
- root (17) — `AddSourceModal.*`, `EmptySchemaAffordance`, `InferredFieldsTable`, `SourceDetailPanel.*`,
  `SourcePreviewSkeleton`, `SourcesPage.*`, `SourceTypeToggle.*`, `TestConnectionAffordance.*`.

### D2 — `proposalReview/` is a new group the ticket never saw

Six proposal-review files landed after the ticket was written. Left at the root they would be the second-largest
cluster there. Grouping them is consistent with the ticket's own principle. **Self-approved; flagged for the gate.**

### D3 — Path-sensitive coupling: swept, and narrower than feared

All verified against the tree, not assumed:

- **`jest.config.cjs` needs no change** — `testMatch` is recursive `<rootDir>/src/**/*.test.ts(x)`; all 6
  `moduleNameMapper` keys are extension- or module-name-based, never directory-based.
- **No `tsconfig` `paths`/`baseUrl`, no `vite` alias.** Every reference is a relative specifier, each move shifting
  depth by exactly one level.
- **CSS-content tests resolve via `path.join(__dirname, ...)`,** so they stay correct provided each moves with the CSS
  it reads. D1 satisfies this, so **not one of these path strings changes**.
- **Live docs:** only `docs/compute-expression-grammar.md` cites a moved path (`ComputeFieldConfig.tsx`).
  `docs/uploads.md` (`markdownUrls.ts`) and `notes/mobile-pwa-handoff.md` (`renderers/`) stay put. Archived
  `openspec/changes/**` are historical records, deliberately not rewritten.
- **`scripts/` is swept too** — a pre-commit gate *can* hard-code such a path: `check-schema-drift.mjs:28` pins
  `features/dashboards/ui/ProposalReview.tsx`. Different feature, untouched, nothing breaks — but the class is real.
  That file is unrelated to the new `pipelines/ui/proposalReview/`; do not conflate them.
- Also clean: `eslint.config.cjs`, `.prettierignore`, `.github/workflows/ci.yml`, `.husky/pre-commit`, `e2e/`,
  `playwright.config.ts`. No `@import` in any moved CSS; no `__snapshots__` directories.

### D4 — Prove content identity by normalize-and-compare, against a pinned base

A green suite does not distinguish a correct move from one that silently dropped, truncated, or rewrote a file.
Round 2 killed three parts of the first attempt; what follows is the corrected mechanism.

**Base, re-derived every run — never `HEAD`, and never hard-pinned either.** `git diff -M --name-status HEAD` is
**vacuous the moment the work is committed** (verified: 0 lines, exit 0), and task 7.6 re-runs this gate after
committing. But a hard-pinned SHA is wrong in the opposite direction: `main` advances (7 of the last 10 commits touched
`frontend/`), and 7.6 mandates a run *after* merging an advanced `main`, at which point every unrelated `main` commit
joins the change set — measured at a 3-commit advance, 16 `A` + 22 `M` under `frontend/` this change never touches,
failing the path-set and content checks and inviting the executor to "fix" it by narrowing scope back to the three
dirs, reopening the hole the whole-tree assertion closed.

So: `BASE = git merge-base origin/main HEAD`, **re-derived at every run**. `BASE_SHA` in `workflow-state.md` is the
*expected* value; a mismatch means re-derive and record, not fail. This keeps every property required earlier — never
`HEAD`, never vacuous, `git show $BASE:<oldpath>` still resolves — and is strictly *more* correct when `main` edits a
file this change moves: the merge applies that edit to the relocated file, which a pinned base misreports as a content
difference and a re-derived base handles correctly. **Non-vacuity assertion:** fail if the change set holds fewer than
116 `R` entries, so an empty or mis-derived base can never read as a pass.

**Scope split — content check under `frontend/`, status assertion whole-repo.** The content check cannot run
repo-wide: task 5.3 edits `docs/compute-expression-grammar.md`, which cites the moved path in **backticks,
repo-root-relative** — the normalizer requires a quote delimiter and a `./` prefix, matches nothing, and the file would
fail with certainty on the first run before any corruption exists. The same applies to this change's own `openspec/`
artifacts, which are legitimately `A`. So the content check (below) covers files under `frontend/`, and the lost
whole-repo coverage is replaced by an explicit status assertion: no `D` or `T` anywhere; `A` only under
`openspec/changes/segment-frontend-ui-directories/` — which now also holds the checker itself (see below); it is
committed (below) and `scripts/*.mjs` is not gitignored, so omitting it would fail the gate on every run after it
lands; the only `M` outside `frontend/` is `docs/compute-expression-grammar.md`, confirmed by its one-line diff.

**Baseline derived from `$BASE`, not pinned.** Releasing the pin on `BASE` (above) is only half the fix: the thing
`BASE` is compared *against* must move with it. So the baseline path set is `git ls-tree -r --name-only $BASE --
frontend/` and the per-feature counts are derived from that same tree, re-derived each run — never a one-time manifest
and never hard-coded numbers, since `main` advances (8 of `origin/main`'s last 12 commits touched `frontend/`) and
task 7.6 re-runs this after merging it. `$BASE` predates the moves by construction, so this is **not** the
post-move-tree tautology D6(e) guards against; deriving from the *working tree* would be.

**Whole-tree path-set assertion (closes `A`/`D`/`T` globally).** `R`+`M` is not the whole change set. A deleted or
truncated `pipelines/hooks/useStepCardState.ts` — one of the two largest reference sites, and outside the three `ui/`
dirs — would be invisible to a directory-scoped check. So: the sorted set of tracked paths under `frontend/` after the
change must equal the baseline set with the 116 rename pairs applied, exactly. Any extra, missing, or type-changed
path fails.

**The comparison: normalize, do not strip.** For each changed file, take old and new content and in **both** replace
every quoted relative-path literal — `(['"])(\.{1,2}/[^'"]*)\1` — with the **fixed-length, syntactically valid**
literal `"./__SPEC__"`. Then run prettier (repo config) over both texts and require byte-identity.

Two properties matter, and each answers a specific failure:

- *Nothing is deleted from either side, so the filter cannot over-consume.* A line-stripping filter can, and the
  round-1 draft provably did — it swallowed `import("react").ReactNode` and `renamed from "Test connection"` comment
  lines. This regex matches neither, since neither quoted string begins with `./` or `../`.
- *A fixed-length valid token, plus prettier on both sides, makes the comparison insensitive to re-wrapping driven
  purely by specifier length.* Specifiers only ever grow here (`../`→`../../` is +3; `./X`→`./stepConfigs/X` is +12).
  `printWidth` is 100, and 13 lines cross it after the move; the 5 with more than one named specifier get re-wrapped
  by prettier — e.g. `PanelGrid.tsx:7` (99 → 102), `stepNarrowing.ts:63` (95 → 107). All 4 affected files are
  prettier-clean today, so a raw byte-identity rule would contradict task 7.5 (`format:check`) and force an ad-hoc
  "expected" exemption that destroys the gate. Substituting the invalid token `<SPEC>` would also make the text
  unparseable by prettier. `.css` files carry **zero** relative literals (measured), so they are compared raw.

**Verified at design time, against real prettier output** (`PanelGrid.tsx:7`, 99 → 102 chars, which prettier re-wraps
into a 4-line import): normalize-only byte-identity reports DIFFERENT — a false failure on legitimate formatted code,
exactly as round 2 measured. Fixed-length token + prettier on both sides reports IDENTICAL, and still reports
DIFFERENT for both a corrupted type token and a deleted named import (red case b′). The prettier step is load-bearing:
without it the 1-line-vs-4-line shape difference survives normalization.

**A prettier invocation that errors on either side is a FAILURE, never a skip.** Prettier exits non-zero with empty
stdout on invalid input; a checker that swallows that and substitutes `""` compares `"" == ""` and reports IDENTICAL —
a false pass in the dangerous direction. Assert exit 0 and non-empty output on both sides.

**Substitution-site check — statement-level, not per-line.** Normalization ignores the *contents* of relative
literals, so a changed literal that is not a specifier would be masked. The checker therefore reports every
substitution site and requires each to belong to an accepted form. The accepted set is stated to match the tree:
an `import`/`export` **statement including its continuation lines** (a `} from "…";` closer belongs to the statement
above it), `require(`, `jest.mock(`, `jest.requireActual(`, and dynamic `import(`. Per-line regex is not sufficient:
of 623 measured sites across the 132 in-scope files, **23 sit on a wrapped-import closer or a `jest.requireActual`**
(e.g. `PanelDetailModal.tsx:21`, `SqlTab.test.tsx:14`), and CR2's re-wrapping adds ~5 more. Record 623 and the
present-today form set as the baseline; a site in any **other** position is new, and fails.

**Specifier-target check — closes the masked class.** Normalization hides specifier *contents*. The earlier
justification ("a wrong module path fails `tsc`/`vite`/`jest`") is true for code modules and **false for `.css`**:
CSS is imported for side effects, `jest.config.cjs` maps every `\.(css)$` to `styleMock.js` regardless of path, and
`tsc`/`vite` accept any existing path — swapping `"./PanelGrid.css"` for `"./MobilePanelStack.css"` compares
IDENTICAL, and 14 `.css` files move. The checker already enumerates all 623 sites and holds the rename map, so closure
is cheap: resolve each old specifier against the old file's directory and each new specifier against the new file's
directory, apply the rename map, and require both to name the same target. This also catches wrong-depth errors before
`tsc` does.

Resolution **must be extension-aware**: the rename map is keyed on real filenames (`DesktopPanelGrid.tsx`) while about
1030 of ~1073 specifiers are extensionless, so a naive implementation reports hundreds of false mismatches on correct
work (measured: 3 of 7 specifiers in a single prototype file). Canonicalise extensions on both sides. The tempting
wrong remedy is "skip what I cannot resolve" — so, explicitly: **an unresolvable specifier is a FAILURE, never a
skip**, the same rule that already governs a prettier error. The residual masked class is effectively nil: all 43
extension-bearing specifiers are `.css`, there are zero side-effect-only non-CSS relative imports anywhere in
`frontend/src`, and one default export repo-wide.

**Where the checker lives.** It is committed *inside this change directory*, not in `scripts/`, so the
evaluator and the final-gate skeptic can re-run it. Otherwise the red cases below are the only evidence it ever worked.

### D5 — Measured reference-update set (replaces the earlier guess)

The earlier enumeration was wrong in both directions. It named `app/App.tsx` and `shared/ui/`, which need **no**
change (they import `CreatePipelineModal`/`PanelBodySkeleton`/`PanelCardSkeleton`, all staying at their roots); and it
omitted the two largest sites, in the same feature's **non-`ui/`** dirs: `pipelines/hooks/useStepCardState.ts` and
`pipelines/state/stepNarrowing.ts`, each importing 17 `../ui/*Config` types (verified: 17 lines each).

Measured in-place set — **15 files / 78 lines**: `pipelines/ui/StepCard.tsx` (21), `pipelines/hooks/useStepCardState.ts`
(17), `pipelines/state/stepNarrowing.ts` (17), `sources/ui/AddSourceModal.tsx` (7), `panels/ui/PanelList.tsx` (3),
`PanelList.{test,onboarding.test,gridWidthSharing.test}.tsx` (2 each), and 1 each in `app/AppRoutes.tsx`,
`dataTypes/ui/TypeDetailPanel.tsx`, `proposals/ui/CombinedProposalReview.tsx`,
`panels/ui/creationSteps/ShapeInstantiateStep.tsx`, `panels/ui/PanelCardBody.predispatch.test.tsx`,
`pipelines/ui/{PipelineDetailPage,PipelineRiverView}.tsx`.

### D6 — Red-before-green: seven cases, one per mechanism

A checker never observed failing is not evidence. Each mechanism gets its own red case, shown FAILING with pasted
output before the checker is trusted:

- **(a) byte-identity** — mutate a plain content line in a moved file.
- **(b′) normalization does not over-consume its own line** — on a substitution-bearing line, mutate a token outside
  the literal (e.g. drop one named import from `PanelGrid.tsx:7`). Successor to round 1's over-consumption finding.
- **(c) in-place-modified files are in scope** — mutate a content line in `pipelines/state/stepNarrowing.ts`.
- **(d) the substitution-site check fires** — introduce a quoted relative literal in a non-import position; it must
  fail via the site check, not byte-identity.
- **(e) the whole-tree path set fires** — delete `pipelines/hooks/useStepCardState.ts` (outside the three dirs).
- **(f) non-vacuity fires** — run against a base yielding no renames; it must fail, not report clean.
- **(g) the specifier-target check fires** — swap `"./PanelGrid.css"` for `"./MobilePanelStack.css"`. It must show the
  specifier-target check FAIL **and** the content check IDENTICAL *in the same run*: the one case demonstrating that
  the target check catches what byte-identity provably cannot.

(e), (f) and (g) matter most: they guard the three assertions whose failure mode is *silent*. A tautological baseline —
reconstructed from the post-move tree because task 1.2 was skipped or lost — passes forever, and neither the evaluator
nor the final skeptic can detect that by re-running it, since they would re-run the same tautology and see green.
All seven mutations are reverted and each revert confirmed.

## Risks / Trade-offs

- **The largest risk is a silently dropped or half-rewritten file**, not a broken import — imports fail loudly at
  `tsc`/build. D4 exists for the silent case, and D4's scope now includes the 15 in-place-modified files.
- **Misleading filename, deliberately preserved:** `PanelDetailModal.css.test.ts` reads `PanelDetailModal.mobile.css`.
  Not a broken guard — it is the HEL-245 tap-target test and those overrides genuinely live in `.mobile.css` (15 ×
  `min-height: 44px` there, 0 in `PanelDetailModal.css`); spec line 42 records this deliberately.
  `PanelDetailModal.mobile.css.test.ts` is a different guard (HEL-772). Only the filename is stale; renaming is out of
  scope, raised as a follow-up. Binding constraint: both tests and all 5 CSS move together.
- **Rename detection is safe:** worst-case changed-line fraction across the 116 movers is 13.9% (round 1 reported
  6.5%; re-measured in round 4 — conclusion unaffected), far below git's 50% rename threshold, so the non-vacuity
  check will not spuriously see `A`/`D` where it expects `R`.
- **Merge conflict exposure** for in-flight work in these dirs. HEL-633 is backend-only, so no overlap. `origin/main`
  is merged into the branch before the gates so the squash diff is correct by construction.
- **Review cost:** a ~200-file rename diff is unreviewable line-by-line; reviewers must lean on the D4 gate.

## Planner Notes

Self-approved: D2 (`proposalReview/`); `schedulePreview.*` into `schedule/` beside the dialog; keeping `markdownUrls`,
`echartsCore`, `useChartCompact` at the `panels/ui/` root as shared utilities rather than inventing a `util/` group the
ticket never asked for; extending the ticket's `grid/` list with the 8 skeleton files (`PanelGridSkeleton.*`,
`panelGridSkeletonStubs.*`, `DesktopPanelGridSkeleton.*`, `MobilePanelStackSkeleton.*`), which the ticket predates.

Not updating the pipeline-op wiring checklist: it names `StepCard` (unmoved) and the `{Op}Config` pattern but records
**no path strings**, so nothing needs re-pointing. Adding the new `stepConfigs/` location would edit a file under `~/`,
which needs explicit user approval — raised at delivery, not done unilaterally.

Introducing the `frontend-ui-directory-structure` capability: the change is behaviourally inert, so no *existing*
requirement changes, but `openspec validate` requires a delta and repo precedent for structural changes (HEL-775,
HEL-657) is a capability rather than `--skip-specs`. Consequence: this change archives **normally**.
