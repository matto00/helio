## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `.openspec.yaml` in full.
- **design.md's grounding facts are accurate.** Verified against the tree, not the narrative:
  - `PipelineRiverView.tsx:292-296` — the `nodePathByStepId` `useMemo`, sole `nodePath()` call site. Confirmed.
  - Three DOM `title=` sites: `PipelineRiverView.tsx:381`, `LaneColumn.tsx:171` (`__tail-chain-step`),
    `LaneColumn.tsx:216` (`__step-section`). `RootColumn.tsx:114` forwards the prop only. All confirmed by grep.
  - `LaneColumn.tsx:210` carries `aria-label="Lane"` — D4/task 1.2's shape probe is real.
  - `state/nodePath.ts` falls back to the bare `stepId` when unresolvable, and its final line is
    `[\`root:${bestRootId}\`, ...trail].join(" > ")` — mutation B (task 3.3) is well-targeted.
  - `PipelineRiverView.test.tsx` is 509 lines with `renderWithStore`, `linkChain`, `ONE_ROOT`, and a
    `fetchSources` mock. D1's "don't duplicate the harness" rationale holds.
- **`skip_specs: true` is justified** — this adds no requirement; no spec delta is missing.
- ACs trace to tasks: AC1→2.2/2.3, AC2→2.4, AC3→3.1, AC4→3.3, AC5→3.2/3.4/4.1/4.2, AC6→D6/4.1. No AC uncovered,
  no task beyond scope.
- **Adversarial fixture check — this is where it breaks.** Read `PipelineRiverView.test.tsx:25-100` and
  `state/nodePath.test.ts:15-24`, and `types/step.ts:49`.

### Verdict: REFUTE

The plan is well-reasoned and its mutation discipline is the right shape. But task 1.1 instructs the executor to
build the two-root fixture "following the file's existing `ONE_ROOT`/`Step` conventions" — and those exact
conventions make the guard collapse into the very evidence-shaped non-evidence this ticket exists to prevent.

**The `rootId` trap.** `types/step.ts:49` declares `rootId?: string` as optional, and *no* `Step` fixture in
`PipelineRiverView.test.tsx` (`stepA`–`stepD`, lines 52-80) sets it. `nodePath()` gates its root base case on
`if (rootStepIds.has(currentId) && step.rootId)`. With `rootId` absent, `pathsFromRoots` returns an empty map and
`nodePath()` returns **the bare `stepId`** via its malformed-data fallback. So a fixture built to the file's
existing conventions renders `title="a"`, not `root:root-1 > a`.

That is not merely "the assertion needs adjusting". It is fatal to AC3: mutation A is specified in task 3.1 as
`entries[step.id] = step.id;` — which produces **the identical string** the unwired-`rootId` fallback already
produces. A guard written against a `rootId`-less fixture is **green under mutation A**. The plan would then
produce a passing mutation transcript for a guard that proves nothing, one level up from HEL-968's original
defect. `state/nodePath.test.ts:15-24` sets `rootId` explicitly precisely because of this; the new fixture must
too, and the plan must say so rather than pointing at the conventions that omit it.

**The `linkChain` trap.** `linkChain` (test file lines 35-43) auto-links any step whose `parentStepId` is
`undefined` to the *previous step in array order*. A second root's head step is by definition parentless — so
passing it through `linkChain` silently chains it onto root 1's tail, producing one root, not two. D4's
"two roots (not one) is required" then quietly fails to hold, and task 2.4's distinct-`root:root-2` head — the
assertion D4 identifies as what makes the two-root requirement load-bearing — becomes unwritable. Task 1.1's
"following the file's existing conventions" points the executor straight at this.

### Change Requests

1. **`tasks.md` 1.1 / `design.md` D4 — require `rootId` on each root-head step, explicitly.** State that the
   `TWO_ROOTS` fixture's two parentless head steps must carry `rootId: "root-1"` / `rootId: "root-2"` matching the
   `PipelineRoot` ids, mirroring `state/nodePath.test.ts`'s `step()` helper (`rootId: parentStepId ? undefined :
   rootId`). Note why: `nodePath()` gates its base case on `step.rootId`, and without it every title degrades to
   the bare-`stepId` fallback. Do not describe the fixture as "following the file's existing `ONE_ROOT`/`Step`
   conventions" — `stepA`–`stepD` set no `rootId` and that is the trap.

2. **`tasks.md` 3.1 / `design.md` risk 2 — add a discrimination check on mutation A.** Mutation A's replacement
   (`entries[step.id] = step.id`) is byte-identical to `nodePath()`'s unresolvable-data fallback. Require the
   executor to confirm the *unmutated* run's asserted titles are `root:`-headed R5 strings (not bare ids) before
   accepting mutation A's red as meaningful — otherwise the red is the fixture being broken, not the wiring being
   gone. Equivalently: state that mutation A must be red for a reason distinguishable from a mis-built fixture.

3. **`tasks.md` 1.1 — state that `linkChain` cannot express the second root.** `linkChain` auto-links every step
   with `parentStepId === undefined` to the previous array element, so routing root 2's head step through it
   collapses the fixture to a single root. Require the two-root fixture to set `parentStepId` explicitly on every
   step (or bypass `linkChain` entirely), and require task 1.2's shape probe to assert **two** root columns are
   rendered — not only that an `aria-label="Lane"` container exists — since a silently-collapsed single-root
   fixture would still render a lane and still satisfy the probe as currently written.

### Non-blocking notes

- **AC4 is looser than tasks.md 3.3.** AC4 says mutation B must make "a test" fail; `state/nodePath.test.ts`
  already asserts the bare-`root` head is never produced, so it will go red on mutation B regardless of the new
  guard — satisfying AC4's letter while proving nothing about the new guard. tasks.md 3.3 correctly narrows this
  to "run the new tests", so the plan is sound as written; worth stating in design.md that mutation B's transcript
  must show a **new** assertion failing, so a later reader cannot credit AC4 from the pre-existing unit test.
- D3's label-then-`closest("[title]")` query is a good call, and D6's zero-non-test-edit position is the strongest
  available reading of AC6. Both should survive the revisions above unchanged.
