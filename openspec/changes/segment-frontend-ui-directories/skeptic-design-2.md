## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold review. Every conclusion below is derived from the tree at `ecee3af8` and from commands I ran
myself, not from round 1's report or from the artifacts' narrative. Round 1's confirmed-sound
findings (enumeration, placement map, D3 sweep, `PanelDetailModal.css.test.ts` retraction) were
spot-checked, not redone.

### What I verified (with evidence)

**Spot checks on round 1's confirmed findings — all still hold.**

```
== pipelines/ui flat: 101 recursive: 101
== panels/ui    flat:  76 recursive: 145
== sources/ui   flat:  30 recursive:  30
```

I rebuilt the move set independently from D1's rules against the tree:

```
{ "pipelines/ui/stepConfigs": 42, "computedFields": 5, "proposalReview": 6, "schedule": 5,
  "shapes": 6, "panels/ui/grid": 19, "panels/ui/detailModal": 20, "sources/ui/forms": 13 }
total moves: 116
```

Exactly D1's numbers, zero unassigned. `npm run check:openspec` → `openspec/ is clean` (exit 0);
`npm run check:spec-structure` → `spec-structure check passed (319 canonical specs, 0 issues)` (exit 0).

**CR4 (measured impact set) — VERIFIED CORRECT.** I resolved every relative specifier in
`frontend/src` against the move map and recomputed each one. Files that are *not* in the move set
but whose specifiers change:

```
IN-PLACE MODIFIED FILES: 16  lines: 79        <- with backtick literals included
   21 features/pipelines/ui/StepCard.tsx           3 features/panels/ui/PanelList.tsx
   17 features/pipelines/hooks/useStepCardState.ts 2 PanelList.gridWidthSharing.test.tsx
   17 features/pipelines/state/stepNarrowing.ts    2 PanelList.onboarding.test.tsx
    7 features/sources/ui/AddSourceModal.tsx       2 PanelList.test.tsx
    1 each: app/AppRoutes.tsx, dataTypes/ui/TypeDetailPanel.tsx,
            panels/ui/PanelCardBody.predispatch.test.tsx,
            panels/ui/creationSteps/ShapeInstantiateStep.tsx,
            proposals/ui/CombinedProposalReview.tsx,
            pipelines/ui/{PipelineDetailPage,PipelineRiverView}.tsx,
            pipelines/ui/PipelineDetailPage.css.test.ts   <- backtick comment only
```

Drop the one backtick-comment line (`PipelineDetailPage.css.test.ts:13`, which is a `` ` ``-quoted
literal the design's regex deliberately does not touch) and the set is **exactly 15 files / 78
lines** — D5 and proposal.md's Impact match member-for-member. `app/App.tsx` and `shared/ui/` are
correctly excluded. **CR4 is genuinely addressed.**

**CR5 (planner-added marking) — SUFFICIENT.** `ticket.md` now carries a header note plus inline
`[PLANNER-ADDED]` on AC1's `proposalReview/` and AC2's 8 skeleton files. A downstream evaluator
tracing ACs can distinguish ticket requirement from planner choice at the exact clause. Adequate.

**CR1 (scope R + M) — the stated scope is right, but not complete.** See Change Request 5: `R`/`M`
is not the whole of `git diff --name-status`, and the residual statuses are unguarded outside the
three `ui/` dirs.

**CR2 (normalize-and-compare) — attacked hard. The direction is right; the specification as written
is broken in two measured, reproducible ways.** Detail in Change Requests 2 and 3.

Things I attacked that the design **survives** — these are now verified, not assumed:

- **CSS files carry no relative literals at all.** `grep -rn 'url(\|@import\|\.\./\|\./' --include=*.css`
  over all three `ui/` trees → `css-hit-count=0`. The 15 `.css` files in the move set compare
  byte-identically with no normalization involved. No unquoted `url(...)` hazard exists here.
- **No template-literal specifiers.** Across the 132 files in scope (116 moved + 16 in-place) there
  are exactly **2** backtick relative literals, both inside `//` comments
  (`stepNarrowing.ts:4`, `PipelineDetailPage.css.test.ts:13`). Zero dynamic `` import(`./x`) ``,
  zero `` require(`./x`) ``. The regex's blindness to backticks has no exploitable instance, and
  because those two lines are *not* normalized, byte-identity guards them.
- **D4's claim about the CSS-content tests is TRUE.** All seven `path.join(__dirname, "…")` sites in
  the three dirs use a **bare filename** with no `./` prefix — e.g.
  `PanelDetailModal.css.test.ts:18: const CSS_PATH = path.join(__dirname, "PanelDetailModal.mobile.css");`
  — so the regex `(['"])(\.{1,2}\/[^'"]*)\1` does not match them, they are not normalized, D1 moves
  each test with its stylesheet so the string never changes, and byte-identity therefore guards them.
  Verified for all five in-scope tests.
- **No escaped-quote or multi-line specifier hazard**, and no file in scope contains the literal
  text `<SPEC>` (token collision impossible): `grep -rn '<SPEC>' frontend/src` → no matches.
- **No import-ordering lint rule** (`eslint.config.cjs` has no `import/order`), so the move cannot
  force a reorder that byte-identity would flag.

**Can a corruption survive normalize-and-compare?** On content, essentially no — nothing is deleted
from either side, so a mutated content line always differs. The masked class is exactly what D4
says: text *inside* a quoted relative literal. That masking is acceptable for import lines (a wrong
module path fails `tsc`, `vite build`, or `jest`'s module resolution), which is why the
substitution-site check is load-bearing — and that check is the part that does not work as written
(CR3). So the mechanism is sound in concept; the two specific defects below are what break it.

### Verdict: REFUTE

CR4 and CR5 are properly fixed and I would not re-open them. CR1's scope statement is right as far
as it goes. But the replacement mechanism CR2 asked for is new and has never been adversarially
tested — and it does not survive contact with this repo. Two of its three components fail on
*legitimate* output before any corruption is introduced, and the diff base it is defined against is
empty at exactly the moment the gate is re-run. A gate that fails on correct work will be relaxed by
whoever hits it, and a gate that reports "0 files checked" is a vacuous pass — the same failure
shape round 1 refuted.

### Change Requests

1. **The diff base `HEAD` makes the whole gate vacuous the moment the work is committed — pin it to
   the recorded baseline SHA.** D4 and tasks 6.1/6.4 define the change set as
   `git diff -M --name-status HEAD` and the old content as `git show HEAD:<oldpath>`. Both are only
   correct while the moves sit uncommitted. Run against a committed tree:

   ```
   $ git diff -M --name-status HEAD
   <<<empty output above>>> exit=0
   ```

   Task 7.6 explicitly requires re-running 6.1–6.5 **after** merging `origin/main` into the branch —
   by then the moves are committed, the change set is empty, the checker iterates zero files and
   reports clean, and `git show HEAD:<oldpath>` no longer resolves (the old path is gone from
   `HEAD`'s tree, so it errors rather than yielding old content). The evaluator and the final-gate
   skeptic re-running it hit the same vacuum.
   Required: define the base as the SHA task 1.1 records (the fork point), i.e.
   `git diff -M --name-status <BASELINE_SHA>...HEAD` and `git show <BASELINE_SHA>:<oldpath>`, and
   state that this base is used for **both** the pre-commit run and every re-run including 7.6.
   Add an explicit non-vacuity assertion: the checker MUST fail if the change set contains fewer
   than 116 `R` entries, so an empty or truncated diff can never read as a pass.

2. **Byte-identity of the normalized texts produces FALSE FAILURES on 5 measured lines in 4 files,
   and those failures are unavoidable because `npm run format:check` mandates them.** `printWidth`
   is 100 (`prettier.config.cjs`). Every relative specifier in this change gets *longer* (`./`→`../`
   is +1, a `../`→`../../` hop is +3, an incoming `./X`→`./stepConfigs/X` is +12). I recomputed every
   specifier and found 13 lines crossing 100; of those, the 5 with more than one named import
   specifier are re-wrapped by prettier (prettier leaves single-specifier imports long, which is why
   4 already-107/115-char lines in these dirs are clean today):

   | file:line | before | after |
   | --- | --- | --- |
   | `frontend/src/features/panels/ui/PanelDetailModal.appearanceSentinel.test.tsx:16` (moved) | 99 | 102 |
   | `frontend/src/features/panels/ui/PanelGrid.tsx:7` (moved) | 99 | 102 |
   | `frontend/src/features/panels/ui/creationSteps/ShapeInstantiateStep.tsx:38` (in-place) | 94 | 101 |
   | `frontend/src/features/pipelines/state/stepNarrowing.ts:63` (in-place, outside the three dirs) | 95 | 107 |
   | `frontend/src/features/pipelines/state/stepNarrowing.ts:72` (in-place, outside the three dirs) | 89 | 101 |

   All four files are prettier-clean today (`npx prettier --check …` → `All matched files use
   Prettier code style!`, exit 0). Fed the post-move specifiers, prettier emits:

   ```
   import {
     panelAppearanceEditorFallback,
     panelTextEditorFallback,
   } from "../../../../theme/appearance";
   ```

   And the D4 comparison on exactly that pair:

   ```
   --- (A) design.md D4 as written: replace spec with <SPEC>, require byte-identical ---
   DIFFERENT -> gate FAILS on legitimately prettier-formatted code
   ```

   So task 6.4 and task 7.5 are in direct contradiction for these 5 lines: the executor cannot
   satisfy both. The predictable outcome is an ad-hoc "this one's expected" exemption, which
   destroys the gate.
   Required: specify a comparison that is insensitive to formatting driven purely by specifier
   length. A verified option (I ran it): substitute every relative literal on both sides with a
   **fixed-length** valid literal (`"./__SPEC__"`) rather than the invalid token `<SPEC>`, run
   prettier over both texts with the repo config, then require byte-identity:

   ```
   --- (B) fixed-length token + prettier both sides ---
   IDENTICAL (gate passes correctly)
   ```

   (An equivalent cheaper rule — collapse every `import`/`export … from <SPEC>;` statement onto one
   logical line with whitespace squeezed, on both sides, before comparing — is acceptable if
   specified precisely. Simply widening the tolerance, or exempting the 5 lines by name, is not.)
   Whichever is chosen, note that the substitution must not be extension-blind: `.css` files carry
   no specifiers (verified, 0 hits) and can be compared raw.

3. **The substitution-site check, as specified, rejects 23 legitimate sites that exist in the tree
   today — it is not implementable in its stated form.** D4 requires every `<SPEC>` substitution to
   "sit on an import/require/`jest.mock`/dynamic-import line" (task 6.5). I enumerated every quoted
   relative literal across the 132 in-scope files: **623 sites, of which 23 match none of those four
   forms** — 22 are the closing line of an already-wrapped import, and 1 is a `jest.requireActual`:

   ```
   CLOSER features/panels/ui/PanelDetailModal.tsx:21      | } from "../state/panelNarrowing";
   CLOSER features/panels/ui/panelGridSkeletonStubs.ts:41 | } from "../../dashboards/state/dashboardLayout";
   CLOSER features/sources/ui/SqlTab.test.tsx:8           | } from "../services/dataSourceService";
   OTHER  features/sources/ui/SqlTab.test.tsx:14          | ...jest.requireActual("../services/dataSourceService"),
   CLOSER features/pipelines/state/stepNarrowing.ts:57    | } from "../types/pipelineStep";
   … 18 more, full list reproducible from the scan
   ```

   Every one of these is in a file whose specifiers change, so every one is a live substitution site.
   And CR2's re-wrapping *adds* 5 more closers that do not exist yet. As written the check fires 23+
   false positives on the first run; the executor's only fast path out is to loosen it into
   meaninglessness — which would re-open the exact hole D4 introduced it to close.
   Required: state the accepted-form set to match the tree — an `import`/`export` statement
   **including its continuation lines** (a `} from <SPEC>;` closer belongs to the statement above
   it), `require(`, `jest.mock(`, `jest.requireActual(`, and dynamic `import(` — and record the
   measured baseline (623 sites, of which the only non-`import`-statement forms present today are
   `jest.mock(`, `jest.requireActual(` and dynamic `import(`) so that a site in **any other**
   position is a new one and fails. Statement-level attribution, not per-line regex, is the
   correctness requirement here; naming the closer form explicitly is the minimum.

4. **D6's three red cases do not exercise the new checker; case (b) is now a duplicate of case (a)
   and no case tests the substitution-site check at all.** Case (b) mutates one of the four
   "filter-matching" lines — but under the new design those lines contain **no** relative-path
   literal (`import("react").ReactNode`; `renamed from "Test connection"`; verified on disk at
   `PanelGrid.test.tsx:27`, `DesktopPanelGridSkeleton.test.tsx:19`, `SqlTab.test.tsx:56,80`).
   D4 says so itself: "This regex leaves all four untouched." A line the normalizer never touches
   fails for exactly the same reason as case (a) — mutated content, texts differ. Case (b) as
   written measures nothing case (a) does not.
   Required: keep (a) and (c); replace (b) and add a fourth, so each mechanism has a red case:
   - **(b′) normalization does not over-consume its own line** — on a line that *does* carry a
     substitution, mutate a token outside the literal (e.g. delete one named import from
     `PanelGrid.tsx:7`'s `import { usePanelUpdatesFlush, type PanelUpdatesFlushHandle } from …`).
     Must fail. This is the direct successor to round 1's over-consumption finding.
   - **(d) the substitution-site check actually fires** — introduce a quoted relative literal in a
     non-import position (e.g. change a string constant in a moved test to `"../fixtures/x"`).
     Must fail *via the site check*, not via byte-identity. Today nothing proves this branch runs.
   Task 6.7's revert confirmation extends to all four.

5. **`R` + `M` is not the whole change set: a file lost outside the three `ui/` dirs passes all
   three steps.** Answering the question directly — yes, there is a status that carries damage and
   is checked by nothing. `git diff --name-status` also emits `D`, `A` and `T`. Step 1 constrains
   `A`/`D` **only "in the three directories"**; step 2's counts cover only those directories; step 3
   covers only `R`/`M`. So a deleted or truncated-to-nothing
   `features/pipelines/hooks/useStepCardState.ts` or `features/pipelines/state/stepNarrowing.ts`
   (the two largest reference sites in the change, both outside the three dirs) is invisible to the
   gate — and "a silently dropped file" is the risk D4 names as the largest one it exists to catch.
   Required: add a whole-tree assertion that is cheap and total — the sorted set of tracked paths
   under `frontend/` after the change must equal the baseline set with the 116 rename pairs applied,
   exactly; any extra, missing or type-changed path fails. That closes `A`/`D`/`T` globally in one
   check and subsumes step 1's directory-scoped wording.

### Non-blocking notes

- **On design.md being 175 lines against openspec's 150-line guidance: I agree the overrun is
  justified, and I could not find any in-repo rule that enforces it.** I searched for a
  "150 lines" constraint across `.cursor/rules/`, `.claude/commands/`, `openspec/`, `concertino.config.json`
  and the repo's markdown — nothing. `npm run check:openspec` passes at 175 lines (exit 0), so this
  is guidance, not a gate. Substantively, the added length is all in D5 (the measured 15-file set)
  and D6 (the red cases) — the two things round 1 demanded — and both are load-bearing. If it must
  come down, the only genuinely compressible passages are D3's "Also clean:" list (lines 81–82,
  a negative-result inventory that could move to the round-1 report by reference) and the
  Planner Notes' second and third paragraphs (lines 169–175), which restate proposal.md. Cutting D5
  or D6 to hit the number would be a regression. Note that CRs 1–5 will *add* lines; do not let a
  line budget shape the fix.
- **A comment will go stale, and the executor must be told to leave it stale.**
  `frontend/src/features/pipelines/ui/PipelineDetailPage.css.test.ts:13` cites
  `` `../../panels/ui/PanelDetailModal.css.test.ts` ``, which moves to `detailModal/`. It is a
  backtick literal, so it is **not** normalized — meaning if the executor tidies it, the byte-identity
  check fails (correctly, as a content change). One clause in tasks §5 saying "do not update the
  backtick path comments at `PipelineDetailPage.css.test.ts:13` / `stepNarrowing.ts:4`" prevents an
  avoidable gate failure. (`stepNarrowing.ts:4` cites `../ui/PipelineDetailPage.tsx`, which does not
  move, so it does not go stale.)
- Neither D4 nor tasks §6 says **where the checker lives**. If it is a throwaway in `/tmp`, neither
  the evaluator nor the final-gate skeptic can re-run it and the only evidence is pasted output.
  Committing it (e.g. `scripts/`) or pasting it verbatim into the execution report would make the
  gate reproducible. Worth one clause.
- `git mv` destination-dir creation is now covered (task 2.1) but only under §2 (pipelines). §3 and
  §4 do not repeat it. Trivial, loud failure if missed.
- Verified and requiring no action: `.css` files in the move set contain zero relative literals;
  `path.join(__dirname, …)` strings are bare filenames and never change; no `import/order` lint rule
  exists; no `<SPEC>` token collision; the four "unresolved" specifiers my scan flagged
  (`PanelCreationModal.tsx:7,8`, `pipelineStep.ts:5`, `dataSource.ts:7`) are all backtick comments
  pointing at paths that do not move.
