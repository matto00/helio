# HEL-1056: Verify DataGrid preview-variant layout neutrality after the HEL-451 frame reframe

## Description

Spun off from HEL-451 (PR matto00/helio#608, `a6bde0d3`).

HEL-451's D10 reframe introduced a new outer element, `.ui-data-grid__frame`, wrapping the scroll container in every `DataGrid` render path — including the three `variant="preview"` consumers, which the reframe was not otherwise about.

The frame was designed to be layout-neutral for `preview` (it takes no full-variant flex rule there, and `--preview`'s `max-height: 320px` stays on the scroll container). Jest coverage asserts the preview frame gets no `--full` class. But layout neutrality was never verified in the running app.

Five attempts across four agents — executor, evaluator (twice), and the final-gate skeptic — failed to reach any preview call site in the running app, including via the SQL source's own "Preview" control. Each reported it unverified rather than closing it as verified.

## Named risk

`.ui-data-grid--preview` sets `margin-top: var(--space-3)`. Before the reframe its parent was the consumer's own container; now it is the flex frame. Margins do not collapse through a flex container, so the rendered spacing above a preview grid may differ. This is the specific mechanism the final-gate skeptic named; it is a hypothesis, not a confirmed defect.

## Call sites

* `frontend/src/features/pipelines/ui/StepCard.tsx:382`
* `frontend/src/features/sources/ui/SourceDetailPanel.tsx:288` (`:289` variant prop)
* `frontend/src/features/sources/ui/forms/SqlTab.tsx:223`

Also `frontend/src/features/sources/ui/SourcePreviewSkeleton.tsx:30`, which hand-rolls the `ui-data-grid ui-data-grid--preview ui-data-grid--condensed` classes rather than rendering `DataGrid` — worth checking it has not drifted from the real component's markup now that a frame exists.

## Acceptance criteria

* Each of the three call sites is reached in the running app and its rendered geometry compared against pre-reframe (`a6bde0d3^`), with the measurements recorded — not inferred from CSS or from Jest.
* The `margin-top` question is answered explicitly: unchanged, or changed with the delta stated.
* If a regression is found, it is fixed and guarded; if none, that is recorded so a future reader does not re-litigate it.
* `SourcePreviewSkeleton`'s hand-rolled markup is confirmed still consistent with `DataGrid`'s.
* Both themes (light/dark) checked.

## Explicitly NOT in scope

Adding filtering to the `preview` variant — HEL-451 lists that as out of scope and it remains so. This ticket is a regression check on a structural change that touched preview incidentally.

## Note

This is a regression-check ticket, not a normal implementation ticket. "Measured, no regression, recorded" is a complete and successful outcome — do not manufacture a fix to justify the run. Do not close it from static analysis or a Jest run alone; HEL-451's four post-implementation defects were all invisible to a fully green Jest suite, and two required live measurement.

## Known hazard from prior attempts

A hypothesis (unverified — treat as a lead, not a fact): the dev-environment user may own zero Outputs (HEL-904 shared-dev-DB residue), which could 403 the writes needed to reach a preview (creating a source/pipeline/step). If so, seeding minimal fixture data may be the actual unlock for reaching these call sites, and is worth recording explicitly regardless of outcome.
