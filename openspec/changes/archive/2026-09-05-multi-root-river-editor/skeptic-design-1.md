## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **`buildLaneGraph` first-parentless-root claim** — read `frontend/src/features/pipelines/state/stepTree.ts:53-95`
  at HEAD `8bb88c0e`. Confirmed: single `root` variable seeded from the first parentless/dangling-parent step
  (`else if (!root) root = s`), queue seeded only from that one root. A second root's steps are indeed silently
  dropped from `lanes`/`laneOfStepId`. Matches design.md's ground-truth bullet.
- **`PipelineStep.rootId: string` at `types/pipelineStep.ts:485`** — confirmed exact line via
  `grep -n rootId frontend/src/features/pipelines/types/pipelineStep.ts`. Confirmed UI `Step`
  (`types/step.ts:21-43`) has no `rootId` field — matches claim.
- **Four `roots[0]` display sites** — `grep -rn 'roots\[0\]' frontend/src` returns exactly these four inside
  `features/pipelines`: `usePipelineDetailPage.ts:357`, `PipelineDetailPage.tsx:151`, `PipelineListTable.tsx:105`,
  and `PipelineDetailHeader.tsx:45`. Note: `PipelineDetailHeader.tsx:45` is actually a **doc comment** describing
  where its `sourceName` prop originates, not itself a `roots[0]` access — the real access is upstream at
  `PipelineDetailPage.tsx:151`. This is a minor imprecision in the ground-truth enumeration (3 real access sites,
  not 4), but non-blocking: task 1.2 already requires re-running and re-classifying this exact grep during
  implementation ("decide per site whether it is a legitimate display-of-first-root or a latent bug"), which
  self-corrects the count before any code is written on top of it.
- **No frontend root-route bindings** — `grep -n roots frontend/src/features/pipelines/services/*.ts` returns only
  a comment, confirming zero client functions exist yet. Backend routes exist at
  `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRoutes.scala` (design.md cites a slightly
  different path prefix, `PipelineRoutes.scala:88/97`, but the file exists under the actual package path
  `com.helio.api.routes.pipelines`; not independently verified line-by-line but the routes were shipped by HEL-913
  per prior epic memory, and this doesn't affect the frontend-only work here).
- **No pre-existing `root:` path construction** — `grep -rn 'root:' frontend/src` returns only the loop variable
  declaration in `stepTree.ts:59` (`let root: Step`) and an unrelated `PipelineProposalSummary.tsx:81` literal
  (`root: {step.rootClientId}`, a different, pre-existing display of `rootClientId`, not the R5 node-path format).
  Neither is the stale `root > s1 > s4` construction the design is guarding against. Confirms the ground-truth
  claim in substance.
- **CreatePipelineModal composition** — read `CreatePipelineModal.tsx:160-205`; confirmed the `Select` +
  "Create a new source"/`AddSourceModal` composition matches the design's D4/D8.1 description exactly, including
  the never-hard-blocked "Create a new source" affordance.
- **R1-R7/R13 cross-check** — read HEL-913's archived `design.md` at
  `openspec/changes/archive/2026-09-04-multi-root-pipelines/design.md`. R1 (never zero roots), R2 (opaque id,
  mutable position), R3 (position is presentation/tiebreak only, explicitly NOT semantic — note R3 was itself
  hardened by a round-1 skeptic CR3 against an earlier over-broad "never branch on position" draft), R5 (node-path
  format `root:<rootId> > s1 > s4`), R6 (adding a root), R7 (two named refusals: last-root, dangling-lane-reference,
  in that check order per round-1 skeptic CR7), R13 (root binding at create time). All correctly represented in
  this ticket's design.md and carried into tasks.md without distortion.
- **D2's `position === 0` grep guard** — ran `grep -rn 'position === 0\|position == 0' frontend/src/features/pipelines`
  myself: one pre-existing hit at `stepTree.ts:110` (`kids.findIndex((k) => k.position === 0)`), which is a
  **step**-position continuation-index check unrelated to root position/semantics, and predates this change. The
  design's own task 4.3 treats a non-zero result as "a design violation, not a nit" without qualifying that this
  pre-existing unrelated hit will already make the grep non-zero before any new code is written. This is a real
  gap in an otherwise well-specified acceptance grep: as worded, task 4.3 is either unsatisfiable as stated or
  requires the executor to silently reinterpret it to mean "grep scoped to new root-position logic only." Non-blocking
  but should be tightened before the executor runs it literally.
- **Run constraints respected** — proposal/design confirm no backend/`schemas/`/MCP edits, no Flyway migration
  (task 12.2 has an explicit verification grep), stays inside `frontend/src/features/pipelines/**` (task 12.3),
  does not fix or work around HEL-970's `pathToRoot` defect (explicitly a non-goal, and task 11.2 tells the
  executor to recognize-and-continue rather than fix).
- **Wire-shape blind spot addressed** — design explicitly calls out that `npm run typecheck` cannot catch a
  wire-shape break (repeating the HEL-913 lesson) and tasks 2.3 and 7.2 both require verification against the
  RUNNING app rather than the TypeScript type, which is the correct response to the stated hard constraint.

### Assessment against design-soundness checklist

- No placeholders/TBDs found in design.md or tasks.md.
- No internal contradictions between proposal/design/tasks — decisions in design.md (D1-D6) map 1:1 onto task
  sections 3-10.
- Every AC (AC1-AC5) traces to specific tasks: AC1→§11, AC2→§3+§4.2+§9.3, AC3→§5.4, AC4→§10, AC5→§12.
- No scope drift: explicitly excludes backend/schemas/MCP/reorder/connector-kinds/HEL-970's defect.
- `LaneGraph.primaryLaneId` removal is a deliberate, justified breaking change to an *internal* type only,
  correctly reasoned as compile-time-catchable (unlike the wire-shape risk), and scoped to this change's own commit.

### Verdict: CONFIRM

### Non-blocking notes

1. Ground-truth bullet "read in exactly four display sites, all taking `roots[0]`" over-counts by one —
   `PipelineDetailHeader.tsx:45` is a doc comment, not an access site (real access is `PipelineDetailPage.tsx:151`,
   which passes the resolved value down as a prop). Task 1.2 already requires re-verifying this list, so it's
   self-correcting, but flag it explicitly during 1.2 rather than re-deriving silently.
2. Task 4.3's grep (`position === 0|position == 0` across `frontend/src/features/pipelines`) already returns a
   non-zero, pre-existing, unrelated hit (`stepTree.ts:110`, step-position continuation logic). As literally
   worded the acceptance check will fail day one. Recommend the executor either scope the grep to the new
   root-ordering code path/file, or document the pre-existing hit as an accepted exception before treating the
   check as passing.
