## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Narrow re-check of the exactly two stale-text items round 2 left blocking.
Items 1,2,4,5,6 of round 1 were confirmed resolved in round 2 and were not re-opened.

### What I verified (with evidence)

- **Repo-wide grep for the stale phrasings.** `grep -rn "may need a split\|which parts survive\|capabilities-at-node"` across the change dir + `ticket.md` returns hits ONLY in (a) the prior skeptic reports `skeptic-design-1.md`/`skeptic-design-2.md`, which quote the old text as historical findings, and (b) `design.md:247` and `design.md:263`, both of which are *negations* inside the resolution sections ("not 'confirm which parts survive,' a decision already made by the spec"; "…wording is superseded by this explicit contract"). No live instruction anywhere still carries the superseded framing.

- **design.md Axis B (`design.md:38-54`)** now reads **"Resolved, not a caution: … strip the Source/bound mode entirely from both files; the surviving editor is literal-only. This is not a split to evaluate case-by-case; it is a single mechanical removal applied to both files"**, and cross-references the "TextContentEditor / MarkdownEditor — resolved, not deferred" section for the exact dependents. The old "may need a split rather than a deletion" sentence is gone.

- **design.md Risks (`design.md:175-178`)** now reads "resolved above, not a case-by-case split — follow the resolution exactly: strip Source/bound mode entirely, keep the literal-content path, in both files." Consistent with Axis B.

- **design.md resolution section (`design.md:236-251`)** unchanged and still correct: spec line 76 cited, dependents named (`useBoundOrLiteralState.ts`, `BoundOrLiteralField.tsx`, `fieldOptions.ts` DataType-field-listing parts, `updatePanelTextBinding`).

- **tasks.md 2.5 (`tasks.md:22`)** now reads "For TextContentEditor.tsx/MarkdownEditor.tsx: strip the Source/bound mode entirely (resolved in design.md, not a case-by-case split) — the surviving editor is literal-only … (see task 8.4)." The "without confirming which parts survive" clause is gone, and it points at 8.4 (`tasks.md:59`), which states the same instruction. 2.5 and 8.4 agree.

- **ticket.md AC bullet (`ticket.md:96`)** now states the concrete contract: "re-pointed at its own explicit data contract: the panel's own `outputId`, `GET /api/outputs/:id` (pipelineId + display name), and `GET /api/outputs/:id/panels` (placement count) — not `GET /api/pipelines/:id/capabilities`". Matches design.md's "Panel sheet data source — resolved, not deferred" section (`design.md:253-264`) verbatim in substance, including the same endpoint triple and the same explicit exclusion. `ticket.md:44-46` carries the same contract in the scope-expansion prose, so the two places in ticket.md agree with each other and with design.md.

- **Validation, run by me:** `npx openspec validate output-picker-nav-onboarding --type change` → `Change 'output-picker-nav-onboarding' is valid`, `EXIT=0`.

### Verdict: CONFIRM

Both round-2 blockers are fully resolved with no residual contradiction anywhere in the live artifacts, and validation is clean. The design is sound enough to implement.

### Non-blocking notes

- `design.md:249-251` still says to "check for any literal-only remainder before deleting the whole file" for `fieldOptions.ts`. That is a legitimate scoped read-before-delete (the file is partially shared), not a deferred decision, and tasks 2.5/8.4 both scope it to "the DataType-field-listing parts" — no action needed.
