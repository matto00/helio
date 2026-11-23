# HEL-1794 mutations (design.md D4)

Each mutation was applied to the implementation on its own, the named test files run in full (jest, 3 workers), and the mutation reverted (file restored from a copy; `git diff` shows no residue). A mutation is "killed" when the named test turns red.

| # | Mutation | Killed by (test turned red) |
|---|---|---|
| M1 | remove the read-only modifier (`step-focused__fieldset--readonly` / `output-editor-sheet--readonly` opacity rule restored to the shared 0.55 dimming) | e2e `hel1794-viewer-read-only.spec.ts` "viewer on desktop ...": `desktop/light: step field 0 value contrast` (3.61, needs 4.5), `step field 1` (3.61), `output name value contrast` (2.39) |
| M2 | remove the D2 hook guard (UI still gated) | `usePipelineDraft with editable: false › every mutator leaves hasDraft false and writes no kept draft` |
| M3 | remove the routing guard (config change) | `usePipelineDraftRouting with editable: false (hasDraft false) › fires no write and records no op for any edit handler`<br>`usePipelineDraftRouting with editable: false (hasDraft true) › fires no write and records no op for any edit handler` |
| M3b | remove the routing guard on an immediate handler (duplicate) | `usePipelineDraftRouting with editable: false (hasDraft false) › fires no write and records no op for any edit handler`<br>`usePipelineDraftRouting with editable: false (hasDraft true) › fires no write and records no op for any edit handler` |
| M4 | drop readOnly from the step fieldset | `desktop edit affordances by caller role › a viewer sees no edit control on the page, in the step editor or in the actions menu`<br>`phone edit affordances by caller role › a viewer: no menu, no schedule chip, no add/new controls, and a read-only step sheet` |
| M5 | render New output for viewers | `SpineOutputs readOnly (HEL-1794) › flipping readOnly removes and restores New output (a role flip reaches the DOM)`<br>`desktop edit affordances by caller role › a viewer sees no edit control on the page, in the step editor or in the actions menu`<br>`desktop edit affordances by caller role › while the role is unknown (pending) no edit control is offered either` |
| M6 | render the row menu for viewers | `desktop edit affordances by caller role › a viewer sees no edit control on the page, in the step editor or in the actions menu`<br>`desktop edit affordances by caller role › while the role is unknown (pending) no edit control is offered either`<br>`phone edit affordances by caller role › a viewer: no menu, no schedule chip, no add/new controls, and a read-only step sheet` |
| M7 | render the null-schedule "Add schedule" chip for viewers | `desktop edit affordances by caller role › a viewer sees no edit control on the page, in the step editor or in the actions menu`<br>`desktop edit affordances by caller role › while the role is unknown (pending) no edit control is offered either` |
| M8 | canEditFromUi true for pending | `canEditFromUi › pending -> false`<br>`desktop edit affordances by caller role › while the role is unknown (pending) no edit control is offered either` |

M2 note: with the UI still gated, only the hook test sees the missing D2 guard, because the routing guard (M3) also stops the page-level change event; the D2 guard is therefore proven by `usePipelineDraft.viewer.test.tsx` alone, by design (defence in depth).
M3/M3b: removing the guard from either a draft-branch handler (`handleStepConfigChange`) or an immediate-branch handler (`handleDuplicateStep`) turns the same test red in both draft states.

Final-green evidence: `.concertino/runs/HEL-1794/evidence/contrast-{desktop,phone}-{light,dark}.json` were regenerated from a clean green run on the cycle-2 HEAD (every value between 8.7 and 15.9, all >= 4.5:1); the M1 run's own figures are quoted in the M1 row above only (its json was not kept). Screenshots in the same directory are from the cycle-1 green run.
