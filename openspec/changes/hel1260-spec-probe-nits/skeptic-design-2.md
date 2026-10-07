## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `5f3990f8ee873b3124e936875bbfb1cef2335d25`. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn-cwd guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/hel1260-spec-probe-nits/HEL-1302`.
- **Round-1 CR1 (title format) is resolved, and the cited source matches.** Playwright is 1.55.1 in `playwright`, `playwright-core` and `@playwright/test` (each `package.json`).
  - `playwright/lib/worker/testTracing.js:107-108`: `traceTitle()` is `relative(testDir, file) + ":" + line` followed by `titlePath.slice(1)`, joined with `" › "` (` › `).
  - `playwright-core/lib/server/trace/recorder/tracing.js:72-74` builds `_contextCreatedEvent` with `type: "context-options"`, and lines 147-150 add `title: options.title` to the event each chunk emits.
  - Decision 2 now describes this format exactly. Taking the last ` › ` segment as the test's own title, then a prefix match, fits it.
  - None of the spec's test titles contains ` › ` (`e2e/hel1260-orphan-owner-repair.spec.ts:37,120`). There are no `describe` blocks, and `testDir` is `./e2e` (`playwright.config.ts:22`). So the first segment is `hel1260-orphan-owner-repair.spec.ts:<line>`, and the file check in the design holds.
- **Round-1 CR2 (several titled events) is resolved.**
  - `playwright/lib/index.js:634-645` (`_startTraceChunkOnContextCreation`) passes the same `traceTitle()` to both `start` and `startChunk`.
  - That path is used for browser contexts (`:571`) and for API request contexts (`:595-596`).
  - The spec uses only the `page` and `request` fixtures, so every titled event in a trace carries the same title. "Exactly one distinct title, otherwise a problem" will produce no false positives on real traces and still fails loudly on missing or conflicting titles.
  - Task 1.6 now covers both the "no title" and the "conflicting titles" synthetic cases.
- **The round-1 note on regex escaping is addressed.** Decision 1 names a local helper. I ran it in Node:
  - With id `a.b+c`, the anchored regex accepts `.../api/dashboards/a.b+c/layout/repair` → `true`.
  - It rejects `.../aXb+c/layout/repair` → `false`. That string would have matched if the `.` were left unescaped.
  - It rejects a URL with a trailing query string → `false`. This matches the old `endsWith` check.
- **AC coverage is unchanged from round 1 and complete.**
  - AC1 is covered by tasks 1.1 and 1.2.
  - AC2 is covered by tasks 1.4, 1.5 and 1.6.
  - AC3 is covered by task 1.5.
  - AC4 is covered by tasks 1.2 and 1.3.
- **No contradictions, and no TODO or TBD remains.** Task 1.5 restates Decision 2's rule. Decision 2 also says that if a real trace contradicts the format derived from the source, the executor must stop and report rather than improvise.

### Verdict: CONFIRM

### Non-blocking notes

- **Where the escape helper goes.** AC1 says "nothing else in the spec changes", and task 1.1 says "`git diff` touches only that assertion". A helper declared at module top level would technically break that wording. Prefer an inline `dashboardId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")` inside the assertion, or a `const` immediately before it. The evaluator should read 1.1 as "only the assertion site".
- **Context-options events with no title.** The design says "collect titles … exactly one distinct". Read literally, events that carry no title are ignored when at least one titled event exists. That reading is acceptable, since every context in this spec is titled. The executor should say in a code comment which reading it implemented.
- **Task 1.2's red.** The red must come from the new `toMatch` line itself. The transcript must show `Received string: "<actual url>"`.
