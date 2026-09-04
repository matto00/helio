## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Ground-truth citations in design.md/proposal.md — all checked, all accurate.**
- `PipelineRiverView.tsx` is 516 lines; `!stepTree.tailsByStepId[step.id]` gates the Branch button at :412; `trunkLastHasTail` gate at :309-311. (`wc -l`, `sed -n '300,315p'`, `sed -n '405,420p'`)
- `stepNarrowing.ts:502-509` / `:522-527` do degrade a lane-kind `secondaryInput` to `""` (data-loss branch, correctly identified). `OP_TYPES` at :112-119 lists `union`/`lookup` and not `join`; `JOIN_OP_TYPE` at :124 exists exactly as described. There is no `ui/stepConfigs/JoinConfig.tsx` (`ls ui/stepConfigs/`).
- `useStepCardState.ts:365-385` writes `{kind:"source"}` unconditionally in both `onUnionChange` and `onLookupChange`.
- The `REMOVED` requirement heading in the `pipeline-tails-ui` delta ("Editor refuses a second branch") matches `openspec/specs/pipeline-tails-ui/spec.md:26` verbatim — a real removal, not an invented one.

**Contract conformance (P2.1 archive design.md § Engine contract).** Design Decision 3 and the
`pipeline-lane-rejoin-picker` delta state eligibility as a property (offer every node; disable only
self/ancestors; explicitly no terminal-only, no single-consumer, no ordering filter) and cite items 6/6b by
name. Item 2 (trunk is a UI notion), item 11 (name substitution permitted), item 4 (position tiebreak),
item 6 diamonds/non-terminal (tasks 2.2/2.3/5.5) are all honoured. No fabricated engine restriction found.

**AC trace.** AC1→8.1, AC2→2.3/5.5/3.3, AC3→7.3, AC4→9.1. Coverage exists on paper; two of them rest on
premises I could not confirm (CR1, CR2).

**Where I broke it.** Two premises the plan depends on are false against the shipped code.

### Verdict: REFUTE

### Change Requests

1. **Task 6.3 and the `pipeline-lane-run-reporting` "failing node highlights its lane path" requirement are
   planned against a wire field that does not exist.** Contract item 11 says the engine reports a
   root-to-step lane path — but HEL-911 did not ship it, despite `tasks.md:57` ("8.2 A failing step names
   its lane path") being checked and `openspec/specs/pipeline-run-execution/spec.md` having been synced to
   assert it. Evidence, reproduced with two independent greps: `grep -rn "lanePath\|lane path"
   backend/src/main/scala` → no matches; `grep -rn -F 'root > ' backend/src frontend/src` → no matches. The
   only failure surface is `InProcessPipelineEngine.scala:26`,
   `StepExecutionException(s"Pipeline execution failed at step $stepId ($stepKind): $reason")`, which
   reaches the client as `pipelinesSlice.ts:82` `runError: string | null` — a free-text message, with no
   structured failing-step id and no path. Task 6.3's "consume the engine's reported root-to-step id path"
   therefore has no input. Since a backend/wire addition is outside this run's `frontend/**`-only boundary
   (the plan's own task 9.2 makes that a STOP), the design must either (a) state explicitly that the editor
   *derives* the path itself from the lane graph, and name where it gets the failing step id from —
   string-parsing `runError` is not acceptable as an unstated mechanism — or (b) raise this as an
   escalation. It must not be planned as consuming a field that isn't there.

2. **Task 3.3's tail-regression guard is empty, and is contradicted by task 4.1.** Task 3.3 says "the
   existing `PipelineRiverView.test.tsx` tail cases must pass unchanged", and AC2 says tails must render
   "identically to P1.5 snapshots". There are **no Jest snapshots anywhere in the frontend**
   (`find . -name '*.snap' -o -name __snapshots__` → nothing), and the only tail-referencing tests in
   `PipelineRiverView.test.tsx` are the two `trunkLastHasTail` shape-picker gate tests at :320-334 — which
   task 4.1 explicitly **deletes**. Outside `state/stepTree.test.ts`, no test in the pipelines feature
   references tail rendering at all (`grep -rniE '(^|[^ed])tail' ui/*.test.tsx | grep -vi detail` → empty).
   So "tails render identically" is currently unguarded, and the one artifact task 3.3 points at is
   removed by another task in the same plan. Add an explicit tail-rendering assertion (indented dashed
   chain + terminating Output chip, per `pipeline-tails-ui`), state that it is a *guard* not a proof, and
   require it be shown failable by mutating `LaneColumn`'s compact branch.

3. **`proposal.md` § Impact lists `ui/stepConfigs/{UnionConfig,LookupConfig,JoinConfig}.tsx` as touched.**
   `JoinConfig.tsx` does not exist, and design Decision 6 + the `pipeline-lane-rejoin-picker` delta put
   `join` out of scope. Remove it from Impact — as written it invites the executor to create a step config
   the ticket does not ask for.

4. **Task 8.1 creates `e2e/hel912-lanes-rejoin.spec.ts`, which task 9.2 forbids.** The Playwright suite
   lives at the **repo root** (`./playwright.config.ts`, `./e2e/hel908-*.spec.ts`), not under
   `frontend/`. Task 9.2 requires the diff to touch `frontend/**` ONLY and calls anything outside it a
   STOP-and-escalate — so the plan as written trips its own gate on a file it also mandates. Restate the
   boundary as "`frontend/**` plus the root `e2e/` Playwright suite", and keep `schemas/`, `backend/`,
   `helio-mcp/` and the proposal/patch-set paths as the actual forbidden set.

### Non-blocking notes

- The "Found, not fixed" note on `openspec/specs/pipeline-step-tree/spec.md:70` ("At most one trunk child
  per node") is correct — I confirmed the stale requirement and that it describes Phase-1 *backend*
  enforcement HEL-911 deleted. But "flagged for a follow-up" names no task. File a real ticket id, or add a
  `REMOVED` block for it to this change's `pipeline-step-tree` delta (an openspec edit, not a backend one,
  so it is inside scope) rather than shipping a capability spec that contradicts the requirement this same
  change adds to it.
- Task 7.3 already carries the right instruction (verify what the touch-target sweep actually scans before
  citing it). Worth noting the sweep is a set of `*.css.test.ts` files, not a viewport render — it will not
  by itself demonstrate lane *stacking* at 375/430px.
- Decision 6 (join out of scope) is a narrowing of the ticket's literal "join/union/lookup config" wording.
  It is justified, stated in both design.md and the spec delta, and AC1 only requires `union` — I accept it,
  but it is a deviation from the ticket text and should stay visible in the final report.
