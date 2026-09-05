# Mutation evidence (HEL-985)

Both mutations below were applied to the WORKING TREE, run against the new
`describe("nodePath wiring (HEL-985)", ...)` block in
`frontend/src/features/pipelines/ui/PipelineRiverView.test.tsx`, captured, then
reverted. `git diff` after this document was written shows changes to the test
file only — no product file (`PipelineRiverView.tsx`, `LaneColumn.tsx`,
`RootColumn.tsx`, `state/nodePath.ts`) carries any residual edit.

## Discrimination check (unmutated tree, before either mutation)

Command: `npx jest --testPathPatterns=PipelineRiverView.test.tsx -t "nodePath wiring"`

```
Test Suites: 1 passed, 1 total
Tests:       23 skipped, 7 passed, 30 total
```

All 7 assertions in the new `describe` block pass, including the 6 exact-string
`toBe(...)` checks against `root:`-headed R5 strings (e.g.
`"root:root-1 > r1a"`, `"root:root-2 > r2a"`) — not bare step ids. This
establishes the baseline: a red on either mutation below means the wiring (or
the function) broke, not that the fixture itself is malformed and yields the
same bare-id string mutation A produces.

## Mutation A — call-site deletion (AC3)

Diff applied to `frontend/src/features/pipelines/ui/PipelineRiverView.tsx`
(kept compiling — a plain `step.id` assignment, not a deleted `useMemo`, so the
guard's redness demonstrates the guard, not the compiler):

```diff
--- a/frontend/src/features/pipelines/ui/PipelineRiverView.tsx
+++ b/frontend/src/features/pipelines/ui/PipelineRiverView.tsx
@@ -291,7 +291,7 @@
   const nodePathByStepId = useMemo(() => {
     const entries: Record<string, string> = {};
-    for (const step of steps) entries[step.id] = nodePath(step.id, steps, roots);
+    for (const step of steps) entries[step.id] = step.id; // HEL-985 mutation A (temporary)
     return entries;
   }, [steps, roots]);
```

Command: `npx jest --testPathPatterns=PipelineRiverView.test.tsx -t "nodePath wiring"`

Result: 6 of 7 new tests fail (the 7th, the shape probe, asserts DOM structure
only and correctly stays green — it doesn't touch `title`). Every title-bearing
assertion is red, and the failure is attributable to the wiring specifically
(the discrimination check above already proved the unmutated titles are
`root:`-headed, not bare ids):

```
● nodePath wiring (HEL-985) › renders the base-case title on a step directly on root 1 (E1, PipelineRiverView.tsx:381)
    Expected: "root:root-1 > r1a"
    Received: "r1a"

● nodePath wiring (HEL-985) › renders the multi-hop chain title, pinning hop order and the separator (E1)
    Expected: "root:root-1 > r1a > r1b > r1c"
    Received: "r1c"

● nodePath wiring (HEL-985) › renders the title on a single-step child lane off a trunk step (E2, compact site LaneColumn.tsx:171)
    Expected: "root:root-1 > r1a > r1b > lane1a"
    Received: "lane1a"

● nodePath wiring (HEL-985) › renders the title on a >=2-step child lane off a trunk step (E2, non-compact site LaneColumn.tsx:216)
    Expected: "root:root-1 > r1a > r1b > r1c > laneA"
    Received: "laneA"

● nodePath wiring (HEL-985) › renders the title on a step inside a lane nested under another lane (E4, LaneColumn.tsx:146)
    Expected: "root:root-1 > r1a > r1b > r1c > laneA > laneB > laneC"
    Received: "laneC"

● nodePath wiring (HEL-985) › renders a distinct root:root-2-headed title inside root 2's own lane (E3, RootColumn.tsx:114)
    Expected: "root:root-2 > r2a"
    Received: "r2a"

Test Suites: 1 failed, 1 total
Tests:       6 failed, 23 skipped, 1 passed, 30 total
```

Mutation A reverted (`entries[step.id] = nodePath(step.id, steps, roots);`
restored). Re-run confirms green:

```
Test Suites: 1 passed, 1 total
Tests:       23 skipped, 7 passed, 30 total
```

## Mutation B — function-logic break (AC4)

Diff applied to `frontend/src/features/pipelines/state/nodePath.ts` (emits the
stale bare-`root` head instead of `root:<rootId>`):

```diff
--- a/frontend/src/features/pipelines/state/nodePath.ts
+++ b/frontend/src/features/pipelines/state/nodePath.ts
@@ -87,5 +87,5 @@
-  return [`root:${bestRootId}`, ...trail].join(" > ");
+  return ["root", ...trail].join(" > "); // HEL-985 mutation B (temporary)
 }
```

Command: `npx jest --testPathPatterns=PipelineRiverView.test.tsx -t "nodePath wiring"`

Result: the same 6 new (HEL-985) assertions fail — not merely the pre-existing
`state/nodePath.test.ts` (which was NOT run by this command; the transcript
below is scoped to the new component-level guard only, so this is a genuinely
new assertion failing, satisfying the risk noted in design.md that a
pre-existing unit test going red could be mistaken for evidence about this
guard):

```
● nodePath wiring (HEL-985) › renders the base-case title on a step directly on root 1 (E1, PipelineRiverView.tsx:381)
    Expected: "root:root-1 > r1a"
    Received: "root > r1a"

● nodePath wiring (HEL-985) › renders the multi-hop chain title, pinning hop order and the separator (E1)
    Expected: "root:root-1 > r1a > r1b > r1c"
    Received: "root > r1a > r1b > r1c"

● nodePath wiring (HEL-985) › renders the title on a single-step child lane off a trunk step (E2, compact site LaneColumn.tsx:171)
    Expected: "root:root-1 > r1a > r1b > lane1a"
    Received: "root > r1a > r1b > lane1a"

● nodePath wiring (HEL-985) › renders the title on a >=2-step child lane off a trunk step (E2, non-compact site LaneColumn.tsx:216)
    Expected: "root:root-1 > r1a > r1b > r1c > laneA"
    Received: "root > r1a > r1b > r1c > laneA"

● nodePath wiring (HEL-985) › renders the title on a step inside a lane nested under another lane (E4, LaneColumn.tsx:146)
    Expected: "root:root-1 > r1a > r1b > r1c > laneA > laneB > laneC"
    Received: "root > r1a > r1b > r1c > laneA > laneB > laneC"

● nodePath wiring (HEL-985) › renders a distinct root:root-2-headed title inside root 2's own lane (E3, RootColumn.tsx:114)
    Expected: "root:root-2 > r2a"
    Received: "root > r2a"

Test Suites: 1 failed, 1 total
Tests:       6 failed, 23 skipped, 1 passed, 30 total
```

Mutation B reverted (`return [\`root:${bestRootId}\`, ...trail].join(" > ");`
restored). Re-run confirms green:

```
Test Suites: 1 passed, 1 total
Tests:       23 skipped, 7 passed, 30 total
```

## Final state

`git diff -- frontend/src/features/pipelines/state/nodePath.ts frontend/src/features/pipelines/ui/PipelineRiverView.tsx frontend/src/features/pipelines/ui/LaneColumn.tsx frontend/src/features/pipelines/ui/RootColumn.tsx`
produces no output — both mutations are fully reverted. The only diff in the
change is to `PipelineRiverView.test.tsx`.
