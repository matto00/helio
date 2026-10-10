# HEL-1465: After HEL-1414: split StepCard.tsx (~508) and usePipelineDetailPage.ts (~1443); duplicate id="lookup-key" across lookup cards; lookup warning wording vs card labels

## Description

Origin: HEL-1414 (matto00/helio#905, e6c37d54), lane-reported. Priority Low, label Follow-up. Owner-approved priority: big refactors.

1. `StepCard.tsx` (~508 lines) and `usePipelineDetailPage.ts` (~1443 lines) are over CONTRIBUTING's budget. Split them behaviour-preserving (the HEL-1365/1399/1430 proof standard); the matto00/helio#905 PR body proposes seams (a `StepCardDiagnostics` component for the warning/error indicators and region; the analyze selectors into their own hook). The 1443-line hook may warrant its own ticket.
2. Duplicate `id="lookup-key"` across multiple lookup step cards (pre-existing): invalid DOM, and it breaks label association. Make ids unique per step, with a test.
3. The lookup warning messages say "source key"/"lookup key", but the card labels say "Match on field"/"Reference match field". Align the wording (user-facing copy).

## Acceptance Criteria

- AC1: `StepCard.tsx` is split into focused modules, behaviour-preserving, each new/remaining file within CONTRIBUTING's ~250-line soft budget where practical (StepCard.tsx itself <= ~250).
- AC2: `usePipelineDetailPage.ts` is split behaviour-preserving for the clusters named in design.md (scope bounded for one reviewable PR); the remainder is filed as a follow-up ticket (stated in planning and in the PR body).
- AC3: Split proof per HEL-1365/1399/1430: byte-move check (`git diff --color-moved` / moved-line accounting) with every non-moved line justified, with a red run proving the check detects an edit; hook primitive call count and sequence unchanged for StepCard and usePipelineDetailPage; test files changed import-only in the split commits; a characterization test committed green on the base first for any non-verbatim restructuring; the RUNNING app compared before/after in light and dark (pipeline editor with join/lookup/aggregate/compute steps, warnings showing).
- AC4: Each lookup card's "Reference match field" input has an id unique per step, its `<label htmlFor>` matches it, with a test rendering two lookup cards (red on base). Separate commit from the split.
- AC5: Lookup analyze warning messages name the keys with the card's own labels ("match field" / "reference match field") instead of "source key"/"lookup key"; backend spec tests updated; separate commit from the split.

## Driver context (claims verified at Setup — see premise-validation evidence)

- HEL-1422 (#912) changed `useStepCardState.ts` (602 lines, over budget, not named in ticket) and step editors; HEL-1414 (#905) added warnings to StepCard.
- The `lookup-key` id lives in `stepConfigs/LookupConfig.tsx`; the warning copy is generated in backend `AnalyzeSchemaWarnings.scala`.
