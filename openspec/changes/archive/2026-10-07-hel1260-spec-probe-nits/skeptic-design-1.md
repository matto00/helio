## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `5f3990f8ee873b3124e936875bbfb1cef2335d25`. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn-cwd guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/hel1260-spec-probe-nits/HEL-1302`.
- **The design's citations match the code.**
  - `e2e/hel1260-orphan-owner-repair.spec.ts:88-90` is the `.endsWith(...)` check wrapped in `.toBe(true)`.
  - The archived probe's `probe-check-isolation.py:20` sets `name = tz.split('/')[-2]`, and `:28` sets `isorphan = 'survives' not in name`.
- **Accepted-set equivalence (Decision 1) is sound.**
  - `repairPosts` is already filtered by `/\/api\/dashboards\/[^/]+\/layout\/repair$/` (spec:50).
  - An end-anchored regex with no start anchor and an escaped id accepts exactly the strings `endsWith` accepts.
  - `toContain` would widen the set and `toBe(fullUrl)` would narrow it. The design rejects both, correctly.
- **The non-goal is correct.** The UI-create test's `endsWith("/layout/repair")` at spec:129 is a listener predicate. Its failure already shows the URL array through `toHaveLength(0)` (spec:165).
- **The gate scripts exist.** `package.json:41` defines `check:e2e-types` (`tsc --noEmit -p e2e/tsconfig.json`) and `package.json:23` defines `check:openspec`.
- **The hygiene check allows editing an archived change.** `scripts/check-openspec-hygiene.mjs` only flags a leftover `files-modified.md` inside `archive/` (lines 288-305). Decision 4 holds.
- **AC coverage.**
  - AC1 is covered by tasks 1.1 and 1.2.
  - AC2 is covered by tasks 1.4, 1.5 and 1.6.
  - AC3 is covered by task 1.5.
  - AC4 is covered by task 1.2 (the red) and task 1.3 (4 tests, both themes).
  - No task goes beyond the ticket's scope.
- **The in-trace title format contradicts Decision 2.** I read the installed Playwright source (`node_modules/playwright` 1.55.1, the one this repo resolves).
  - `playwright/lib/index.js:634-645` calls `tracing.start({...options, title, name})` with `title = this._testInfo._tracing.traceTitle()`.
  - `playwright/lib/worker/testTracing.js:107-108` defines:
    ```js
    traceTitle() {
      return [path.relative(this._testInfo.project.testDir, this._testInfo.file) + ":" + this._testInfo.line,
              ...this._testInfo.titlePath.slice(1)].join(" › ");
    }
    ```
  - `playwright-core/lib/server/trace/recorder/tracing.js:147-150` writes that string as the `title` of the context-created (`context-options`) event.
  - So the recorded title has the form `hel1260-orphan-owner-repair.spec.ts:37 › … › owner open of an orphaned text panel … (light)`. It begins with the file path and line, not the test name. (`testDir` is `./e2e` per `playwright.config.ts:22`.)
  - The source is deterministic, so this does not depend on a flaky measurement. I found no existing hel1260 `trace.zip` in the repo to cross-check against. Task 1.4 will produce one, but the design needs fixing first (see CR1).

### Verdict: REFUTE

The plan is small and mostly sound. But Decision 2 specifies a classification rule ("title **starts with** `owner open of an orphaned text panel`" / "`creating a text panel through the UI`") that cannot match the title Playwright actually records.

Implemented as written, the probe would report all 4 traces as `unclassified`, and task 1.5's "classifies all 4 correctly with 0 bad" fails. The executor would then have to improvise the match rule. If the improvisation is "contains `owner open`", that reintroduces substring matching on a composite string, which is the very fragility this ticket removes. This rule should be decided at design time, not mid-execution.

### Change Requests

1. **design.md Decision 2: fix the match rule to fit the real title format.**
   - State that the test-runner trace title is `<relative file>:<line> › <titlePath[1:]> joined by " › ">` (source: `playwright/lib/worker/testTracing.js:107-108`, Playwright 1.55.1).
   - Specify how the test's own title is pulled out of it. Recommended: the last ` › `-separated segment, then the existing prefix match on that segment.
   - Optionally also assert that the first segment's file is `hel1260-orphan-owner-repair.spec.ts`, and report a mismatch as a problem.
   - Keep the "unclassified → problem" rule.
   - Update task 1.5 to match.
2. **design.md Decision 2 / task 1.5: say how to handle more than one title-bearing event per trace.**
   - A test-runner `trace.zip` can hold more than one `.trace` file, and each tracing start or chunk emits its own context-created event carrying `title`. The browser context is one, the `request` fixture's API context can be another, and `startChunk` emits more.
   - Specify the rule: collect every `context-options` title in the zip, and require exactly one distinct value. No titles, or conflicting titles, is a problem and never a default.
   - Task 1.6's synthetic stripped-title case should then cover both "no title" and "conflicting titles". At minimum it must cover "no title", as already planned.

### Non-blocking notes

- **Decision 1's "regex-escape".** The lane runs on Node v22.23.2, and `e2e/tsconfig.json` targets ES2022, so `RegExp.escape` is unavailable at runtime and undeclared for tsc. The executor needs a small local helper, e.g. `s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`. Naming this in the design would remove a guess. `check:e2e-types` in task 1.1 would catch the misuse anyway.
- **Task 1.2's red.** The red must come from the new `toMatch` line itself, e.g. a mutated expected path, not from some other assertion. It must show Playwright's `Received string: "<actual url>"` output. The task wording already implies this; the evaluator should check that the transcript shows the actual URL.
- **Unused probe code.** The probe's dead `if not isorphan or True:` (line 33) and the unused `rinfo` when there are no repairs may be tidied while touching the file. That is optional and out of AC scope; do not let it grow.
