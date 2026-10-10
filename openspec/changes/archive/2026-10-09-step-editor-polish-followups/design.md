## Context

HEL-1416 (ce6991111, #870) made fillnull/window/pivot reject clearly invalid enum values at write time and passed the server's 422 message to each editor as `saveError`, rendered as a trailing `<InlineError>`. HEL-1422 lists five follow-ups. Premise validation against origin/main 428e1d2d4 confirmed all five (evidence: `.concertino/runs/HEL-1422/evidence/premise-validation.md`). Since filing, HEL-1417 (#906) added `PipelineStep.rawConfigProblem` and resolve-time step-create checks, HEL-1414 (#905) added StepCard warnings, HEL-1407 (#884) aria-linked the aggregate `p` error. None of them touch these five items.

## Goals / Non-Goals

**Goals:** the five ticket items, each closed by the smallest change the existing precedent supports.

**Non-Goals:**
- Changing the silent-swallow behaviour of every other op kind's rejected save (`useStepCardState.persist` `captureErrors`, design Decision 6 of the upsertsource change). That is out of scope here as well.
- Changing what the server accepts or rejects. Write-time rules (`validateRawConfig`), analyze (`StepConfigValidation`) and the auto-run gate are unchanged. Only the run-time throw order in `WindowStep.apply` moves.
- Restyling `DedupeConfig`, which shares the unstyled `pipeline-detail-page__dedupe-config` root class.

## Decisions

### D1: Item 1. FillNullConfig uses the shared tokenized container
`pipeline-detail-page__dedupe-config` has **no CSS rule at all** (grep of `frontend/src/**/*.css`), so FillNullConfig's children, including the trailing InlineError, stack with no gap. WindowConfig and PivotConfig use `pipeline-detail-page__aggregate-config` (`PipelineDetailPage.css:1557`, `display:flex; flex-direction:column; gap: var(--space-5)`). FillNullConfig's root switches to that same class. This uses a DESIGN.md §3 `--space-*` token and adds no CSS. Side effect: fillnull's Columns/Strategy/Constant-value sections also gain the `--space-5` gap, which makes them match window/pivot section spacing. The evaluator must confirm this in the running app in both themes. Adding a rule to `__dedupe-config` was rejected because it would also restyle DedupeConfig (a non-goal).

### D2: Item 2. Keep the user's choice and mark the offending control invalid (decided by precedent, no escalation)
Two precedents both point to "keep and mark invalid", so a revert would be the outlier:
1. `useStepCardState.persist` already states the editor rule: "local state always reflects user intent even if the PATCH fails (pre-existing behavior)" (`useStepCardState.ts:311-312`). A revert would break it, and only for three kinds.
2. Form-error precedent: HEL-1407's aggregate `p` field keeps the typed value and marks it `aria-invalid` + `aria-describedby={errorId}` through `FormField`'s `errorId` (`AggregateConfig.tsx:267-283`). `Select` already exposes `ariaInvalid`/`ariaDescribedBy` for exactly this purpose (HEL-1084). DESIGN.md §6 names `FormField`, which carries `errorId`, as the form-row recipe. These sources together decide it.

**What a rejected save can actually come from today, and what the marking protects.** In the running app none of the three editors can currently produce a 422:
- The frontend enum lists match the backend sets exactly: `FILL_NULL_STRATEGIES` ↔ `FillNullStep.SupportedStrategies`, the pivot agg list ↔ `PivotStep.SupportedAggs`, `WINDOW_FUNCTIONS` ↔ `WindowStep.SupportedFunctions`.
- The narrowing functions convert stored invalid values to valid defaults.
- Write-time validation checks only enums, the window offset, and shape/type mismatches.

So the marking guards against future frontend/backend enum drift, and against any other 422 the server may add for these kinds. That is the same hazard HEL-1416's inline error itself guards against. It is defence in depth, not a fix for an observable bug, and the PR must say so.

Mechanics:
- `InlineError` (text variant) gains an optional `id` prop rendered on its `<p>`. The banner variant is unchanged. Every existing call site omits it, so their output is unchanged.
- `persist` additionally records whether the captured rejection is a validation rejection (an `AxiosError` with HTTP status 422). It is exposed as `saveErrorIsValidation: boolean` (name may vary) next to `saveError`, reset at the same point `saveError` is. A network or 5xx failure still shows its message, but no control is marked `aria-invalid`, because the value itself is not known to be invalid in that case.
- Which control gets marked mirrors the server's shared rule order (`FillNullStep.strategyProblem`, `PivotStep.aggProblem`, `WindowStep.enumProblems`):
  - fillnull: the strategy `Select`.
  - pivot: the agg `Select`.
  - window: the function `Select`. There is no offset branch: `windowConfigOf` (`stepNarrowing.ts:717`) turns any stored offset of 0 or less into 1, and `WindowConfig.handleOffsetChange` (:97-102) ignores values of 0 or less. The client therefore never holds or sends a non-positive offset, and an offset-marking branch would be dead code (design-gate skeptic round 1, CR1).
- Each editor gives its InlineError a stable per-instance id (`useId`, as AggregateConfig's `idBase` already does) and passes it to the marked control's `aria-describedby` only while marked.

### D3: Item 3. Comment-only alignment
Reword `PivotStep.validateRawConfig`'s doc (`PivotStep.scala:164-165`) to the FillNullStep template (`FillNullStep.scala:217-219`): what is rejected, which drafts stay accepted (HEL-814 D2), that a decode failure is left to the shared shape check, and that analyze and the auto-run gate short-circuit on the result. Only claim behaviour PivotStep actually has, and verify each clause against the code. Reword `StepConfigValidation.validatePivot`'s inline comment (`:124`) to match `validateWindow`'s (`:99`) form. Make no code change.

### D4: Item 4. Missing `field` before a bad offset at run time (decided by precedent, no escalation)
- Before HEL-1416 (`ce6991111^:WindowStep.scala:98-119`), `apply` checked an unsupported function, then a missing field, then the offset. HEL-1416 accidentally reversed field and offset by hoisting `enumProblems`.
- Analyze (`StepConfigValidation.validateWindow`) already lists the field problem first: `fieldProblem.toVector ++ WindowStep.enumProblems(cfg)`.
- It is also the more useful order. A step with no `field` cannot run whatever its offset is, and fixing the offset first would leave the user facing a second error.

`apply` is therefore reordered: unsupported function, then empty-function draft, then missing field (for `FieldRequired` functions), then offset. `enumProblems` itself is unchanged, because write time and analyze still use it as-is. The unsupported-function error must still win over the field error. `FieldRequired` only holds supported functions, so this falls out naturally, but a test pins it. Messages are unchanged.

### D5: Item 5. Spec deltas
ADDED requirements in the three op specs: write-time rejection (HEL-1310 aggregate wording pattern, `pipeline-aggregate-op/spec.md:156-162`), drafts stay saveable, the editor's rejected-save behaviour (D1/D2), and window's run-time error order (D4).

## Risks / Trade-offs

- [The class swap changes fillnull section spacing beyond the error] → this is intended (D1). It needs before/after screenshots of all three editors in both themes.
- [Single-control marking per kind may not be the field the server actually objected to in some future 422] → each kind marks its one enum control, the field its write-time rule targets. The message text always names the real problem.
- [No 422 is reachable in the running app] → running-app screenshots inject a 422 for the step PATCH with Playwright `page.route`, carrying a realistic server message, and the evidence states plainly that the 422 was injected.
- [Tests that select fillnull by `__dedupe-config`] → the executor greps and updates them.

## Gate-Chain Implications Checklist

Not applicable. No `.husky/**` file or pre-commit-invoked script is touched.
