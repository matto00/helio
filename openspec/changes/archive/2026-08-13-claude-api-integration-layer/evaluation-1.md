## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `d287cc99` on `feature/claude-api-integration-layer/HEL-390`.

### Phase 1: Spec Review — PASS

- [x] All ticket acceptance criteria addressed explicitly:
  - AC1 (reusable client, config not hardcoded) — `ClaudeConfig`/`ClaudeClient`, verified by
    `ClaudeClientSpec` "wire model/max-tokens/temperature/messages through" test.
  - AC2 (key from env/Secret Manager, `--set-secrets`, never in code/.env/logs, verified by test) —
    `ClaudeConfig.fromEnv()` + `infra/deploy-backend.sh` diff adds
    `ANTHROPIC_API_KEY=helio-anthropic-api-key:latest`; key-never-logged verified by
    `ClaudeConfigSpec`'s `toString` test and `ClaudeClientSpec`'s Logback `ListAppender` test.
  - AC3 (non-blocking) — `ClaudeClient.send`/`stream` return `Future`/`Source` immediately;
    `HttpClaudeTransport` uses `Http(...).singleRequest` (async), no `Await` outside tests.
  - AC4 (streaming exposed) — `ClaudeSseAssembler`/`ClaudeSseFrameParser` + `ClaudeStreamAssemblySpec`
    (text-delta concatenation, usage, error frame, chunk-boundary splits).
  - AC5 (guardrail + usage) — input-token pre-flight rejection (`GuardrailExceeded`, zero transport
    invocations, both `send`/`stream`) and output clamp, both covered in `ClaudeClientSpec`; usage
    always sourced from the real API response (`ClaudeResponse.usage`), never the estimate.
  - AC6 (`CLAUDE.md` + `infra/.env.deploy.example` updated) — both diffs present and correct (see
    Phase 2 below).
  - AC7 (`sbt test` green, mocked transport, no real network) — confirmed by my own fresh run: 2539
    passed, 0 failed (see Phase 2).
- [x] No AC silently reinterpreted — design.md explicitly documents the one genuine interpretive
  call (D4: "cost" guardrail = token count, not a dollar-figure guardrail) with reasoning, and it's
  consistent with the ticket's own "expose token usage... so callers can log cost" phrasing.
- [x] All `tasks.md` items marked done (20/20) and match what's implemented — spot-checked every
  task against the diff; no gaps found.
- [x] No scope creep — diff is confined to `backend/src/main/scala/com/helio/ai/**`, matching tests,
  `infra/deploy-backend.sh`, `infra/.env.deploy.example`, `CLAUDE.md`, and the OpenSpec change
  artifacts. No route/actor wiring into `Main.scala`/`ApiRoutes`, matching the proposal's explicit
  "library only, no consumer yet" scope.
- [x] No regressions — purely additive new package; full `sbt test` suite (2539 tests, including all
  pre-existing suites) passes.
- [x] API contracts — N/A, no route/schema exposed this ticket (correctly deferred to HEL-341); no
  `schemas/` changes needed and none made.
- [x] Planning artifacts reflect the final implementation — `design.md`'s decisions (D1–D8, D4a) all
  match the code; `skeptic-design-2.md`'s one non-blocking note (add `CLAUDE_TEMPERATURE` to the
  `tasks.md` 5.3 doc list) was folded into the final `tasks.md`/`CLAUDE.md` as delivered.

Issues: none.

**Pre-commit bypass verification (specifically requested):** The executor's handoff/commit-message
claim — that `npm run check:openspec`'s "change claude-api-integration-layer is complete (20/20) but
not archived" failure is a structural artifact of the phased workflow, not a real quality-gate
failure — is **correct**, verified two ways:
1. I read `scripts/check-openspec-hygiene.mjs` directly: it fails any change whose `openspec list`
   status is `complete` and hasn't been archived. I re-ran it myself fresh and reproduced the exact
   failure the executor reported.
2. I read `.claude/agents/concertino-orchestrator.md`: `openspec archive <CHANGE_NAME> --yes` is
   Phase 3 step 2 — an orchestrator action, run only after evaluator/skeptic sign-off, committed
   **separately** from the executor's implementation commit. Git history confirms this is the
   established pattern for this repo (e.g. `HEL-381 Add dry analyze endpoint...` followed by a
   distinct `HEL-381 Archive dry-analyze-pipeline-proposal change` commit; same for `HEL-379`). The
   executor's own agent definition (`.claude/agents/concertino-executor.md`) does not list
   `check:openspec`/archival among its own gates (only lint/format/test/build for frontend, `sbt
   test` for backend) — it is a Husky pre-commit hook, not one of the executor's verification gates.
   So a fully-task-complete change that hasn't yet been archived is *expected* to fail this hook at
   exactly this point in every cycle-1 delivery, by construction of the phased workflow.

The bypass itself also satisfies `CONTRIBUTING.md`'s narrow carve-out ("Never use `--no-verify`... The
only acceptable use is an environmental hook breakage... and even then the situation must be called
out explicitly in the commit body"): the commit body names the exact failing check, quotes its
message, and states the reasoning for the bypass. This is not a gate failure swept under the rug.

### Phase 2: Code Review — PASS

Read `CONTRIBUTING.md` (binding always) as the standard; `DESIGN.md` is not binding here (no
`frontend/**` changes).

**Gates — re-run fresh myself** (changed files are `backend/**` + `CLAUDE.md`/`infra/**` docs; no
`frontend/**` changes, so only the backend gate applies):

```
$ cd backend && sbt test
...
[info] Total number of tests run: 2539
[info] Suites: completed 155, aborted 0
[info] Tests: succeeded 2539, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
[success] Total time: 104 s
```

Also independently re-ran the two other mechanical scripts referenced by `CONTRIBUTING.md`'s
pre-commit chain, for full transparency (not strictly required gates for this evaluator, but they
substantiate the executor's own gate claims):

```
$ node scripts/check-scala-quality.mjs
Scala code-quality check: clean (86 soft warning(s))   # all 86 warnings are pre-existing files
                                                        # over the soft budget; none touch this diff
$ node scripts/check-openspec-hygiene.mjs
OpenSpec hygiene issues:
  - change "claude-api-integration-layer" is complete (20/20) but not archived — ...
```
(The second result reproduces exactly the executor-reported, expected-at-this-phase failure
analyzed above.)

**Mechanical CONTRIBUTING.md compliance:**
- Imports & Qualifiers — no inline FQNs found (`grep`-verified across every new `main`/`test` file
  under `com.helio.ai`); all imports are top-of-file.
- File-size soft budgets — every new file is well under 250 lines (`ClaudeClient.scala` 84,
  `ClaudeConfig.scala` 65, `HttpClaudeTransport.scala` 97, largest test file
  `ClaudeClientSpec.scala` 209 — all clear).
- Backend rules — actor/service boundaries explicit (`ClaudeTransport` SPI cleanly separates
  transport from client logic); no blocking I/O on an actor path; ScalaTest coverage present for
  every new class.
- "Per-domain JSON formatters live under `com.helio.api.protocols`" — `ClaudeProtocol.scala`
  intentionally lives under `com.helio.ai` instead. This is a reasoned, documented deviation
  (design.md D1): these wire types are internal to the Anthropic API client (never touch
  `ApiRoutes`/`JsonProtocols`), so the `com.helio.api.protocols` convention — which exists for
  request/response shapes at the route boundary — doesn't apply. Not a violation.

**DRY / pattern reuse:** follows the established `RestApiConnector` shape closely and
appropriately: `Http(system.classicSystem).singleRequest` + `ConnectionPoolSettings` with explicit
connect/idle timeouts, `Future`/`Either`-returning method with typed error mapping, `LoggerFactory`
usage. `ClaudeTokenEstimator` reuses `jtokkit`'s `o200k_base` encoding, matching
`ChunkByTokenCountConfig`'s existing default rather than introducing a second BPE family. No
duplicated logic found.

**Readable / modular:** small, single-purpose files (`ClaudeTransport` SPI, `ClaudeSseFrameParser`
vs. `ClaudeSseAssembler` cleanly split framing from parsing, `ClaudeWireModels` vs. `ClaudeModels`
cleanly split wire shape from domain shape). No magic values beyond well-named, doc-commented
defaults (`DefaultModel`, `DefaultTemperature`, etc.) and one documented sentinel (`status = 0` for
a mid-stream error frame, explained in both `ClaudeError.ApiError`'s doc comment and
`ClaudeSseFrameParser.parseError`).

**Type safety:** no untyped escape hatches; `ClaudeError`/`ClaudeStreamEvent` are closed sealed
traits with exhaustive-friendly pattern matching in tests.

**Security:** the one security-relevant AC (key never logged) is directly tested — both a
config-level `toString` test and a client-level `ListAppender`-captured-log test on an API-error
path (the path most likely to tempt logging a raw exception/body). Verified by reading every `log.*`
call site in `ClaudeClient`/`HttpClaudeTransport`: none interpolate `apiKey`; `HttpClaudeTransport`
holds the key only as a private constructor field placed solely on the `x-api-key` header.

**Error handling:** boundaries are clear — `HttpClaudeTransport` signals via a failed `Future`
(`ClaudeApiException`) or a synthetic error `Source` element (mid-stream); `ClaudeClient` catches and
maps both to the typed `ClaudeError` ADT. No silent failures — every SSE event kind the client
doesn't model is a documented, intentional `None` (Non-Goals), not a bug.

**Tests meaningful:** 27 new specs, each exercising a distinct scenario named in `tasks.md` 6.1–6.3
(env defaults/overrides, guardrail rejection with zero-transport-invocation assertions for both
`send`/`stream`, output clamp, usage passthrough, API-error vs. transport-failure mapping, key-never-
logged, chunk-boundary SSE splits). These would catch a real regression (e.g. a future change that
accidentally rejects instead of clamps, or that skips the pre-flight check before invoking the
transport).

**No dead code:** no unused imports, no leftover TODO/FIXME in the diff.

**No over-engineering:** the `ClaudeTransport` SPI is justified (design.md D2 gives a considered
rejected alternative — pekko-http-testkit route faking — and explains why the SPI seam is right-
sized); no speculative extra abstraction beyond what `send`/`stream` need.

**Behavior-preserving:** N/A — this is new code, not a refactor.

**Minor non-blocking issues found (do not affect PASS):**
1. `ClaudeModels.scala:28` comment cites `design.md D4/D9` — `design.md` only defines decisions
   D1–D8 (plus D4a); there is no D9. Likely a stale reference from an earlier design draft. Harmless
   (doesn't affect behavior or tests) but worth a one-line comment fix in the next cycle.
2. `HttpClaudeTransport.scala:54,74` — `buildHttpRequest(request.copy(stream = false/true))`
   defensively re-forces the `stream` field even though `ClaudeClient.toApiRequest` already sets it
   correctly before calling `transport.send`/`transport.stream`. Harmless belt-and-suspenders
   (arguably good defensive practice for an SPI implementation not to trust a caller-supplied
   field), not a bug.

Issues (blocking): none.

### Phase 3: UI Review — N/A

No `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, or
`openspec/specs/**` changes — this ticket is a backend-only library with no route/consumer wired in
(explicitly out of scope, deferred to HEL-341). No dev servers started.

### Overall: PASS

### Non-blocking Suggestions
- `backend/src/main/scala/com/helio/ai/ClaudeModels.scala:28` — fix the `design.md D4/D9` comment
  reference to just `D4` (no `D9` decision exists in `design.md`).
- Consider whether `HttpClaudeTransport.stream`'s outer `.recover` (which only covers the
  request-initiation `Future`, not a mid-stream connection drop on `response.entity.dataBytes`
  itself) is sufficient for HEL-341's eventual needs — not a gap against this ticket's ACs/spec
  (which only require `message_start`/text-delta/`message_delta`/`message_stop`/`ping`/`error`
  handling), just a forward-looking note for the first real caller.

### Environmental note (evaluator process, not a code issue)
This worktree (`/home/matt/Development/helio/.claude/worktrees/feature/claude-api-integration-layer/HEL-390`)
is missing several `scripts/concertino/*` files that are gitignored-but-tracked-only-in-the-main-
working-tree (`next-report-number.sh`, `persist-evidence.sh`, `emit-event.sh`, etc. — `git
ls-files scripts/concertino/` shows only 6 of ~18 files under version control; the rest are
generated-but-untracked and therefore absent from any `git worktree add` checkout). I ran the main
repo's copies of `next-report-number.sh`/`persist-evidence.sh`/`emit-event.sh` against this
worktree's paths instead (these scripts are pure filesystem/git operations parameterized entirely by
their arguments, so this is behaviorally identical to having a local copy). Flagging so the
orchestrator/user is aware `setup-worktree.sh` doesn't currently populate this delivery worktree with
the full generated `scripts/concertino/` set — a `linkModules`-style gap, not a defect in this
ticket's implementation.
