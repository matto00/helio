# HEL-1478: After HEL-1465: finish splitting usePipelineDetailPage.ts (load/SSE, outputs, run/save) and split useStepCardState.ts (~602)

## Description

origin_kind: followup. origin_ticket: HEL-1465.

HEL-1465 (#923, 744c37720) split `StepCard.tsx` and extracted five in-place sub-hooks from
`frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` (1443 -> 816 lines): `usePipelineAnalyzeDeferWatchdog`
(clearDeferWatchdog / forceDeferredAnalyze / unmount cleanup only), `usePipelineAnalyzeLookups`,
`usePipelineStepStructure`, `usePipelineStepMutations`, `usePipelineRootAndToggleActions`. These files are still over
CONTRIBUTING's ~250-line budget afterwards:

1. **First item: the hidden `react-hooks/refs` errors.** The host's debounced re-analyze `useEffect` (~L356-432) carries
   an existing `// eslint-disable-next-line react-hooks/exhaustive-deps` (~L423). That suppression makes the React
   Compiler lint skip the whole function, masking 7 `react-hooks/refs` errors on the host's render-time ref accesses.
   Removing the suppression, or moving the effect out of the host, re-surfaces them (HEL-1465 evidence
   `eval-D2b-probe.txt`). Fixing it is a behaviour change (ref writes move into effects / layout effects), so it needs
   its own characterization and proof, not a verbatim move.
2. Then extract the debounced re-analyze effect itself (it can only move cleanly once item 1 is resolved).
3. `usePipelineDetailPage.ts` remainder: pipeline load + SSE wiring at the top, outputs / output-sheet / search-param
   handlers, source edit + schedule toggle, run / dry-run / save / cancel handlers.
4. `frontend/src/features/pipelines/hooks/useStepCardState.ts` (~602 lines, grown by HEL-1422 / #912).
5. Minor: HEL-1465's `usePipelineStepStructure.ts` landed at 271 lines (mostly verbatim comments).

Same behaviour-preserving proof standard as HEL-1365/1399/1430/1465: byte-move check with red runs, hook primitive call
sequence unchanged, deps arrays = base + provably-stable additions only, tests import-only in split commits,
characterization test on base first for any non-verbatim restructuring (HEL-1465's F-146 identity test is reusable),
running app compared before/after in light and dark.

## Acceptance Criteria

- AC1: The 7 `react-hooks/refs` errors are fixed (zero render-time ref reads/writes in the host), each with a
  characterization proof that observable behaviour is unchanged; any site that cannot be fixed without a non-trivial
  behaviour change is reported and filed as a follow-up instead.
- AC2: The debounced re-analyze effect is moved out of the host as a byte-proven move.
- AC3: The host remainder clusters (load/SSE, outputs/sheet/search-param, source/schedule, run/save/cancel) are
  extracted into in-place sub-hooks under the HEL-1465 proof standard.
- AC4: Zero-warnings lint holds; no new `eslint-disable`.
- AC5: Running app compared before/after in light and dark; no visual or behavioural difference.
- AC6 (fold-in leftovers): the stale "the debounce effect below" comment in `usePipelineAnalyzeDeferWatchdog.ts` is
  corrected; the `pipeline-analyze-schema-warnings` scenario title at spec.md:66 no longer says "source key"/"lookup
  key".
- Scope (driver-approved): one reviewable PR. Items 4 (`useStepCardState.ts`) and 5 (`usePipelineStepStructure.ts`)
  are filed as a follow-up ticket if they do not fit, cited in the PR body.
