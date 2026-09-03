## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Fresh cold spawn. Every fact below was re-derived from files in this worktree; no
prior report was taken as fact.

### Round 4's four sub-revisions — verified by mechanism, not by narrative

1. **Task 3.5 restated to one running spec.** `grep -rn "tail-chain-item"` over the
   repo returns exactly two spec files: `e2e/hel908-trunk-reorder-drag.spec.ts`
   (`:110,116,206,209,226` — the five locators tasks.md names, matching line-for-line)
   and `e2e/hel908-tail-attach.spec.ts`. The producer is
   `frontend/src/features/pipelines/ui/TailChain.tsx:61` plus CSS at
   `PipelineDetailPage.css:416,429`. Since the second spec is quarantined (below),
   the live radius is exactly one spec. Claim reproduced.
2. **Task 3.6 quarantine premise.** `grep -n "hel908-tail-attach" playwright.config.ts`
   => `43` (comment) and `47` (`"**/hel908-tail-attach.spec.ts"` inside `testIgnore`).
   The surrounding comment records the HEL-962 reason verbatim: the "Add tail step"
   locator resolves to 0 elements. Collected by nothing. The decision to leave it
   untouched is recorded in the task.
3. **The false rename attribution is gone, and its replacement is true.**
   `grep -rn "Add tail step" frontend/` returns nothing (empty output). The affordance
   is labelled `Branch` at `PipelineRiverView.tsx:415-421`, gated on
   `!stepTree.tailsByStepId[step.id]` at `:412`. So the quarantined spec's locators are
   pre-existing breakage, exactly as tasks.md now states — not collateral of this rename.
4. **Task 9.1a exists and demands observation, not inference:** run
   `hel908-trunk-reorder-drag.spec.ts` and record the command + output after the
   `TailChain` -> `LaneColumn` retirement. This is the lesson-8 correction and it is
   stated as an observation obligation, not a class-preservation assertion.
5. **design.md Risks corrected:** the bullet now says "guarded by exactly ONE running
   spec ... it just gets its force from one spec, not twenty", and names the quarantine
   at `playwright.config.ts:47`. Consistent with tasks 3.5/3.6.

No round-1..4 change request survives. Verified independently.

### Independent re-derivation of the plan's load-bearing anchors

Every file:line citation in tasks.md/design.md that I could check, checked:

- `stepNarrowing.ts` — `unionConfigOf` / `lookupConfigOf` do carry the
  "degrade lane-kind to `""`" branches (`cfg.secondaryInput?.kind === "source" ? ... : ""`)
  around `:502-509` / `:522-528`. The data-loss claim behind tasks 5.1/5.6 is real.
- `useStepCardState.ts:365-386` — `onUnionChange` / `onLookupChange` do persist an
  unconditional `{ kind: "source", ... }`. Task 5.2's target is real.
- `UnionConfig.tsx:18` / `LookupConfig.tsx:23` — the flat `UnionConfigValue` /
  `LookupConfigValue` are declared there, not in `stepNarrowing.ts`. Task 5.1 is right
  about the declaration site.
- `PipelineRiverView.tsx:309-311` — `trunkLastHasTail` exists as described; its two
  tests are at `PipelineRiverView.test.tsx:320-338`. Task 4.1 deletes both consistently.
- **No frontend Jest snapshots exist**: `grep -rln "toMatchSnapshot" frontend/src`
  returns nothing. AC2's "tails render identically to P1.5 snapshots" is genuinely
  unsatisfiable as literally worded, and task 3.3 says so and substitutes a stated,
  mutation-failable GUARD. Correct handling, not a scope dodge.
- Decision 5's deferral premise: `grep -rn "lanePath" backend/src/main/scala` => `0`,
  while `openspec/specs/pipeline-run-execution/spec.md:9` does assert the SHALL with the
  `root > s1 > s4 > s7` format. The gap in HEL-911 is real; the human answered
  `defer-to-followup`; not reopened here.
- Engine contract re-read at source (`archive/2026-09-03-multi-lane-pipeline-engine/design.md`
  items 2, 4, 6, 6a, 6b). Task 5.4 / Decision 3 mirror it exactly: offer every node but
  self, disable only ancestors (computed over parent AND lane edges), and explicitly
  forbid terminal-only / single-consumer / ordering filters. Item 6b names that exact
  mistake; the plan does not make it.
- Spec deltas: all seven capability delta files exist and are populated. The
  `pipeline-step-tree` delta carries a real `## REMOVED Requirements` block for
  "At most one trunk child per node", which I confirmed still stands at
  `openspec/specs/pipeline-step-tree/spec.md:70` and does contradict HEL-911's
  position-orders-siblings requirement in the same file. The design's "found, not fixed"
  note is backed by an actual artifact, not a promise.
- No `TODO` / `TBD` / hand-waving anywhere in proposal.md, design.md, tasks.md or the
  seven deltas.

### AC traceability

AC1 (e2e lane/rejoin/dry-run) -> task 8.1 + 8.2 (collection confirmed, not assumed).
AC2 (Jest: deterministic layout / ancestor exclusion / tails unchanged) -> 2.3, 5.5, 3.3
(with the snapshot impossibility handled explicitly). AC3 (mobile 375/430) -> 7.3, which
correctly refuses to conflate the CSS-parsing touch-target sweep with viewport stacking
(lesson 4). AC4 (gates) -> 9.1, plus 9.1a and the 9.2 scope fence.

### Verdict: CONFIRM

The plan is sound enough to implement. Every premise I could mechanically check held on
re-derivation, the round-4 defect class (individually-true facts composing into a false
conclusion) is closed at its root, and no AC is left untraced.

### Non-blocking notes (for the final gate, not a blocker)

- Task 5.1's blast radius for the `UnionConfigValue` / `LookupConfigValue` shape change is
  under-enumerated. It names `UnionConfig.test.tsx` and `LookupConfig.test.tsx`, but
  `frontend/src/features/pipelines/state/stepNarrowing.test.ts` (`:35,47,60,68,94,112`) and
  `frontend/src/features/pipelines/hooks/useStepCardState.test.ts` (`:193,208,218,241`)
  also construct the flat narrowed shape and will fail `typecheck`. Not blocking:
  `npm run typecheck` (task 9.1) forces discovery, and 5.1's lesson-1 rule already
  requires justifying any test edit. Executor should expect four files here, not two.
- Specifically, `stepNarrowing.test.ts:60` pins the degrade-to-`""` behaviour that task 5.1
  deletes as a data-loss bug. That test must be REPLACED (by the 5.6 round-trip assertion),
  not merely retyped — retyping it would re-pin the defect. Worth calling out in
  `files-modified.md` at the final gate.
- `frontend/src/features/pipelines/types/pipelineStep.ts:22` mentions the flat field names
  only in a comment explaining they are invalid; no wire-type change is implied. Confirmed
  no in-scope file needs the wire shape touched.
