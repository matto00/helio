## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold re-derivation. I read `ticket.md`, `design.md`, `tasks.md`, `enumeration.md`,
`spacing-scan.js`, `tokenAuditSweep.css.test.ts`, `touchTargetProbe.ts`, and the
HEL-1022 comments in `OutputsRail.css` / `PipelineDetailPage.css` directly, and
re-measured every number the artifacts now assert. Base `58855835`, worktree
clean apart from the change dir.

## What I verified (with evidence)

**CR1 (from-scratch baseline regeneration) — addressed correctly.**
`design.md` "Baseline regeneration procedure (no line-shift arithmetic)" states
the mechanism, the reason (inline comments shift line numbers; 42 of 62 entries
are in `PipelineDetailPage.css`), and cites the HEL-442/HEL-732 precedent at
`tokenAuditSweep.css.test.ts:137-143`. `tasks.md` step 4 now (a) is explicitly
sequenced **after** all CSS edits, (b) requires regeneration by running the test
file's own `SPACING_PATTERN` + `spacingIsDisallowed` over `SWEPT_FILES`, (c)
forbids offset arithmetic by name, (d) requires the regenerated-vs-62 diff as the
reviewable artifact, and (e) adds a red-then-green mutation check. That is the
requested revision, not a mention of it.

**CR2 (exact baseline scope) — addressed, and every number reproduces.**
I recomputed all of them from `enumeration.md` × `tokenAuditSweep.css.test.ts`:

| design.md claims | I measured |
|---|---|
| 102 literals / 18 files | 102 / 18 |
| 94 distinct lines | 94 |
| 52 worklist lines in `SPACING_BASELINE` | 52 |
| 42 worklist lines not baseline entries | 42 |
| ...of which 20 in `SWEPT_FILES` but `var(--space`-masked | 20 |
| ...and 22 in non-swept files | 22 |
| 10 of 18 worklist files not in `SWEPT_FILES` (9 swept) | 10 / 9 |
| 10 baseline entries not in worklist, must remain | 10 |
| current baseline size 62 | 62 |

The vague "shrinks accordingly" is gone and replaced with a checkable prediction
plus the explicit instruction not to hand-edit toward a predicted number.

**CR3 (touch-target measured, not inferred) — addressed correctly.**
`design.md` now names the HEL-813 spec's 7 covered surfaces, states outright that
none is a page this ticket touches, and requires importing
`e2e/support/touchTargetProbe.ts` directly against every control whose padding is
reduced, at 430px and 768px, before and after, with a remediation rule (less
aggressive step, not accepted regression). `tasks.md` step 6 mirrors it and keeps
the existing suite only as regression coverage, not as the evidence. I confirmed
`touchTargetProbe.ts:1-15` exists, exports `DEFAULT_MIN_PX = 44`, and its own
header documents it as shared/importable outside the steady-state guard.

**CR4 (the 14px coupled cluster) — addressed correctly.**
`design.md` has a dedicated "Coupled cluster: the `14px` shared-left-edge group
(must snap together)" section quoting both HEL-1022 comments, fixing **one**
shared target (16px / `--space-4`) decided once, requiring both comments be
updated, and explicitly excluding `PipelineDetailPage.css:1114`/`:1231` and the
two `PanelDetailModal` sites as non-members. `tasks.md` step 2 carries the same
constraint as a bolded exception to per-site judgment.
I independently resolved the cluster from source: the comments name
`.pipeline-detail-page__step-card-header` and `-body`, which are
`PipelineDetailPage.css:348` (`padding: 10px 14px`) and `:694`
(`padding: var(--space-3) 14px`); together with `OutputsRail.css:18` and
`PipelineDetailPage.css:462` that is exactly a 4-member cluster, and a tree-wide
`14px` grep found no fifth site participating in that left edge.

**Non-blocking notes 1-3 from round 1 — all folded in.** The `/g` blind spot is
documented in design.md with the executor obligation to re-check on a moved base
(and `tasks.md` step 1 carries it); the script path is now the real
`openspec/changes/snap-off-scale-spacing/spacing-scan.js` (file present) rather
than `/tmp`; the literal-vs-line unit distinction has its own "Unit note".

**Nothing else newly broken.** HEL-680 reconciliation still matches HEL-680's
sanctioned option (literals only, no `--chip-padding` property); the snapping
policy is still per-context with inline-comment justification, satisfying the
ticket's "judgement call per context, not a blanket rounding rule"; ACs 1-7 each
trace to a task (1→t1, 2→t2/t3, 3→t7, 4→t4/t5, 5→t6, 6→t2, 7→t3).

## Verdict: CONFIRM

All four required revisions were actually made, and the numeric claims the design
now rests on reproduce exactly against ground truth. Sound enough to implement.

## Non-blocking notes

1. `PipelineDetailHeader.css:25` (`padding: var(--space-2) 14px`) and `:369`
   (`padding: 0 14px`) are neither listed as cluster members nor as non-members.
   They are the *page* header, not the *step-card* header, so they are correctly
   outside the cluster — but an executor skimming "step-card header/body" could
   pull them in. Worth one sentence naming them as independent sites.
2. The cluster's 16px target is a judgment I can't refute, but note
   `PipelineDetailPage.css:348` is `padding: 10px 14px` — its 10px snaps under
   the separate 10px rule, so that one declaration gets two independent
   decisions. Keep them visibly separate in the diff/comment.
