## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed at HEAD 8fff8eed1ca2b7ee8df6f70aade2a0fa9e76d3a7. The change dir is untracked. Paths are under
`backend/src/main/scala/com/helio/` unless noted. No `.env` or `.concertino.env` file was read, and no model was
called.

### What I verified (with evidence)

**Round-4 CR1 (model pin and usage unverifiable): resolved in substance.**
- **Fresh pinned restart.** D8 (design.md l.203-208) now requires `stop-servers.sh <WT> <DEV_PORT> <BACKEND_PORT>`
  before each of the baseline and after runs. The restart then uses
  `CLAUDE_MODEL=claude-haiku-4-5-20251001 LOG_FORMAT=json start-servers.sh ...` and never reuses a backend started
  without those variables.
  - `stop-servers.sh` takes exactly that signature (its usage line, l.9).
  - The exported values reach the forked JVM, by this chain:
    - `start-servers.sh` l.198 runs `env $cmd` with the caller's environment.
    - The configured command is `sbt run` (`concertino.config.json` l.34).
    - `Compile / run / fork := true` (`backend/build.sbt` l.109).
    - `DevEnv.runEnv` drops every `.env` key the process env already has (`backend/project/DevEnv.scala` l.65-66),
      so the exported value wins.
    - `LogFormatPropertyDefiner` reads `sys.env("LOG_FORMAT")`, case-insensitive (l.24).
- **The JSON encoder emits the needed fields.**
  - `logback.xml` selects the `json` appender, a `LogstashEncoder`, when `LOG_FORMAT=json`. LogstashEncoder includes
    MDC by default.
  - `AssistantTelemetry.emit` puts every field into MDC before `log.info("assistant_tool_loop_outcome")`
    (`services/assistant/AssistantTelemetry.scala` l.53-79). The fields are `conversationId`, `modelId`,
    `inputTokens`, `outputTokens`, `cacheReadInputTokens` and `cacheCreationInputTokens`, plus the propose counters.
- **conversationId matches what the runner holds.**
  - `AssistantConversationRoutes.scala` l.157-168 passes `conversationId = id.value`. That is the path id of the
    conversation the runner created.
  - `modelId` is `assistantService.modelId`, the configured model that is actually sent.
- **Token counts cover the whole turn.** `ClaudeClient.sendWithTools` sums usage across every hop (`addUsage`,
  l.92-138), and the route passes `result.usage`.
- **The log path is right.** `start-servers.sh` l.46 sets `BACKEND_LOG="${WORKTREE_PATH}/.concertino-backend.log"`,
  which is the file D8 names.
  - l.198 redirects the backend's stdout and stderr there with `>`, so the file is truncated on each fresh start.
  - D8's "match by conversationId, never by file position" is still the right rule.
- **The abort guard fails safe.** If the pin or JSON format silently fails to apply for any reason, the guard stops the
  runner after the first case, before any further model call. It trips when there is no JSON line or when
  `modelId != claude-haiku-4-5-20251001`. Wrong-model spend is therefore bounded to one case.
- **Counts come from the transcript.** D8 l.211-213 and task 1.14 say so. The "telemetry logs or the response" and
  "if those lack a per-call error flag" fallbacks are gone (grep: zero hits in design/tasks/proposal/specs).
  `X-Helio-Requested-With: 1`, `POST /api/auth/login` and `/me` are stated, and the password comes from an
  env var or argument.
- **No contract change slipped in.** D8 l.221-222 forbids adding a usage field to the converse response.

**Earlier CRs: no regression.**
- D2 is intact: the saved-step node schema with the enabled flag and owner view, the upstream-edit rejection, and
  backfill after the forward walk.
- D5's single-proposal model and D7's "ONE proposal" are unchanged.
- The D1 option-(i) detail types and the byte-identical workspace-context test (3.5b) are unchanged.
- Round 3's HTTP-driven runner holds no key or DB. HEL-1450 is untouched.
- The eval spec carries no tag.

### Verdict: CONFIRM

### Non-blocking notes

1. **The JSON line may not be a bare JSON line.** No `Compile / run / outputStrategy` is set (`build.sbt` sets
   one only for Test, l.224). sbt's default for a forked `run` relays the child's stdout through its logger, so each
   line may carry an `[info] ` prefix and possibly ANSI codes. I inferred this; I could not observe it, because no
   backend log exists in any worktree.
   - The runner should parse from the first `{` of a line containing `assistant_tool_loop_outcome`.
   - Otherwise the abort guard fires on a correctly pinned backend. That fails safe but wastes the first case.
2. **The telemetry line is written asynchronously.** It is fire-and-forget on a Future, so the runner should poll the
   log briefly (bounded retry) after the converse returns, not read once.
3. **sbt server env capture.** `MISTAKES.md` says an sbt server captures its env when it starts. If this worktree's
   `backend/` ever has a live sbt server, a `sbt run` that attaches to it would miss the export. The abort guard
   catches this. Running `sbt shutdown` in `backend/` before the pinned start would avoid even the one wasted case.
4. **Some spend is unmeasured.** A converse that ends in `Left(ClaudeError)` emits no telemetry line
   (`AssistantConversationRoutes.scala` l.154). Tokens spent on its earlier hops are therefore not counted toward C1.
   The $1.50 estimate leaves headroom under the $3 cap, but the runner should treat any such case as a stop-and-report.
5. **Stale counter wording.** design.md l.229 still says "the executor gains a per-turn counter of successful propose
   calls; the eval reads it". No task implements it, and the eval now reads the transcript. Drop or reword the line
   so an implementer does not build an unused counter.
6. **Task order.** Task 0.4 (baseline) needs the runner from tasks 1.14/1.15.
   - Build the runner first. It is test-only code, so the backend stays at branch-point code for the baseline.
   - Make sure the baseline backend is started fresh from unmodified main code.
7. **D0 replay environment.** D0's "replay through `AssistantToolExecutor` against the D8 fixture" cannot use the dev
   DB from a test JVM (HEL-1450). It should run as an EmbeddedPostgres-backed spec that reproduces the fixture's
   shape. It must not forward `DATABASE_URL` into Test scope.
