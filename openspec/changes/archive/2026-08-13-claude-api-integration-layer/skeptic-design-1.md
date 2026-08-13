## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/claude-api-client/spec.md`, `workflow-state.md` in full.
- Confirmed every existing-pattern claim in `design.md`'s Context/Decisions against the actual
  source, not just the design's narrative:
  - `backend/src/main/scala/com/helio/domain/RestApiConnector.scala` — confirmed the
    `ActorSystem`-constructor / `Http(system.classicSystem).singleRequest` /
    `ConnectionPoolSettings` (`.withConnectingTimeout(10.seconds).withIdleTimeout(30.seconds)`) /
    `Future[Either[String, T]]` + `.recover` pattern the design cites is real (lines 37–56, 80–106).
  - `backend/src/main/scala/com/helio/api/CookieConfig.scala` — confirmed the "read once from
    `sys.env`" `fromEnv()` shape the design cites for D6 is real (lines 19–22).
  - `backend/src/main/scala/com/helio/app/Main.scala` — confirmed `requireEnv` exists and is used
    for `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` (lines 38–47), i.e. D6's
    claim that this is a different, stricter startup-fail-fast pattern than what's being proposed
    here is accurate.
  - `backend/src/main/scala/com/helio/services/PdfTextSupport.scala` — confirmed its only "claude"
    hit is a reference to `CLAUDE.md` (line 64), matching the ticket's "only incidentally mentions
    claude" framing.
  - `backend/src/main/scala/com/helio/domain/steps/ChunkByTokenCountStep.scala` +
    `backend/build.sbt:119` — confirmed `jtokkit:1.1.0` is already a dependency and already used for
    BPE token counting, supporting D4/D5's "no new dependency" claim.
  - `backend/build.sbt:86-89` — confirmed `pekko-http`/`pekko-stream` are already deps, supporting
    the "no new SSE library needed" claim (D5).
  - `infra/deploy-backend.sh:20` and `infra/.env.deploy.example` — confirmed the exact
    `--set-secrets=DB_PASSWORD=...,GOOGLE_CLIENT_SECRET=...,GOOGLE_CLIENT_ID=...` shape and the
    existing `COOKIE_SECURE` documentation-only-note pattern the design proposes to mirror for
    `ANTHROPIC_API_KEY` / `helio-anthropic-api-key`.
  - `grep`ed the whole worktree for any pre-existing `ANTHROPIC_API_KEY`/`CLAUDE_MODEL`/
    `CLAUDE_MAX_TOKENS` reference outside this change dir — none found, confirming this is
    genuinely new surface with no existing convention to contradict.
- Traced every ticket acceptance criterion to a design decision + task + spec requirement; all six
  functional ACs (reusable configurable client, key-from-env/never-logged, non-blocking,
  streaming, guardrail+usage, infra/doc updates, green mocked-transport tests) have a home. No
  scope drift: the design explicitly and correctly defers route/consumer wiring to HEL-341,
  matching the ticket's "Out of scope."

### Adversarial findings (gaps that block implementation determinism)

1. **`ClaudeClient.stream`'s guardrail-rejection contract is undefined, and untested.**
   `spec.md`'s "client never blocks" requirement (lines 23–26) fixes `stream`'s return type as a
   bare `Source[ClaudeStreamEvent, NotUsed]` — no `Either`/`Future` wrapper. The guardrail
   requirement's only scenario ("Over-budget input is rejected before any network call", lines
   80–83) is written exclusively in terms of `ClaudeClient.send` resolving to `Left(...)`.
   `tasks.md` 4.3 says `stream` should "mirror the same guardrail pre-checks" but never states what
   a pre-flight rejection looks like on a `Source`-returning method: `Source.failed(...)`, a
   synthetic `Source.single(ClaudeStreamEvent.Error(...))`, or something else. `tasks.md` 6.2/6.3
   have no test task for this case either. Three different competent implementations are possible
   here and none is specified or would be caught by the planned test suite, even though the
   ticket's own guardrail AC ("reject or truncate over-budget requests deterministically") is not
   scoped to `send` only. Needs an explicit spec requirement/scenario (e.g. "stream emits a single
   `ClaudeStreamEvent.Error` and completes, with zero transport invocations") plus a corresponding
   task-6 test.

2. **`ClaudeConfig.temperature` has no env var, default, or config-reading rule — a real
   contradiction inside `tasks.md` itself.** `tasks.md` 1.2 lists `ClaudeConfig`'s fields as
   `(apiKey, model, maxOutputTokens, maxInputTokens, temperature)`, then enumerates the env vars
   `fromEnv()` reads as `ANTHROPIC_API_KEY, CLAUDE_MODEL, CLAUDE_MAX_TOKENS,
   CLAUDE_MAX_INPUT_TOKENS` — `temperature` is declared as a field but has no corresponding env var
   in the very same task. `spec.md`'s config requirement (lines 3–8) likewise never mentions
   temperature at all. Nowhere in `proposal.md`/`design.md`/`tasks.md`/`spec.md` is a default
   temperature value, an env var name, or a "temperature is per-call, not config-level" decision
   stated. Yet the ticket's own Scope line is explicit: "configurable model, max-tokens,
   **temperature**... all configurable, not hardcoded at call sites" — this is one of the three
   named things the ticket requires to be configurable, and the design silently drops the
   "configurable" half of it. As written, an implementer must either invent an undocumented env var
   (diverging from the design/tasks) or hardcode a temperature constant in code (violating the
   ticket's explicit "not hardcoded" requirement for this exact field). This needs a decision
   recorded in `design.md` (env var name + default, or an explicit call-site-override-only
   rationale) before implementation.

3. **`CLAUDE_MAX_TOKENS` / `CLAUDE_MAX_INPUT_TOKENS` defaults are asserted but never given a
   value.** `spec.md` line 7 states token ceilings from these two env vars are "both defaulted,"
   and `tasks.md` 1.2 lists them as read but not further specified. Contrast this with the model id,
   which gets a concrete, testable default (`claude-opus-4-8`, with an explicit scenario at
   `spec.md` lines 18–21 and a task-6.1 test). No document anywhere states what
   `ClaudeConfig.maxOutputTokens`/`maxInputTokens` default to when the env vars are unset, nor
   whether `fromEnv()` should instead `Left`-fail when they're absent (mirroring the key) rather
   than default. This is exactly the guardrail the ticket cares most about (AC: "A max-tokens/cost
   guardrail rejects or bounds over-budget requests") — an implementer-invented default could make
   the guardrail silently permissive (huge ceiling) or immediately broken (near-zero ceiling,
   rejecting nearly everything), and no test task currently exercises the default-value case at
   all (task 6.1 only tests "model default + override," not ceiling defaults). Needs concrete
   default values (or an explicit `Left`-on-absent decision) recorded in `design.md`/`spec.md` and
   a corresponding `ClaudeConfigSpec` scenario.

### Verdict: REFUTE

The overall shape (package placement, transport SPI, error ADT, clamp-vs-reject guardrail split,
hand-rolled SSE parsing, Secret-Manager infra wiring) is sound and well-grounded in existing
codebase patterns — I would not send this back over the architecture. But three concrete,
implementation-blocking gaps remain (above), one of which is an outright internal contradiction
within `tasks.md` (temperature declared as a config field with no way to populate it) and two of
which leave acceptance-criteria-relevant behavior (streaming guardrail rejection, token-ceiling
defaults) fully unspecified and consequently untestable per the plan's own task list. These are
exactly the kind of "decisions deferred that block implementation" this gate exists to catch before
code gets written against an ambiguous contract.

### Change Requests

1. Add an explicit spec requirement + scenario for `ClaudeClient.stream`'s behavior when the
   pre-flight input-token guardrail is exceeded (what it emits on the `Source`, and that zero
   transport invocations occur), and add a corresponding task under section 6 to test it.
2. Resolve the `temperature` gap: either (a) add a `CLAUDE_TEMPERATURE` env var (with a stated
   default) to `ClaudeConfig.fromEnv()`'s reading list in `tasks.md` 1.2 and `spec.md`'s config
   requirement, or (b) explicitly decide temperature is a per-call-only parameter with a stated
   code-level default and record that rationale in `design.md` (since the ticket's Scope names
   temperature alongside model/max-tokens as something that must be "configurable, not hardcoded at
   call sites").
3. State concrete default values for `CLAUDE_MAX_TOKENS` and `CLAUDE_MAX_INPUT_TOKENS` (or an
   explicit "absent → `Left`" fail-fast decision matching the API-key behavior) in `design.md`
   and/or `spec.md`, with a corresponding default-value scenario in the config requirement and a
   matching `ClaudeConfigSpec` test task.

### Non-blocking notes

- D4's choice to implement only a token-count guardrail (no dollar-figure/pricing-table guardrail)
  is a defensible reading of the ticket's "token/cost budget" language (real cost is logged
  downstream from returned `usage`, not enforced in-client against a price table that would need
  separate upkeep) — but it's worth one sentence in `design.md` explicitly stating "cost" is
  interpreted as "token count, with dollar cost computed by the caller from returned usage" so a
  future reader doesn't mistake this for an oversight.
- D4/Context's choice of `cl100k_base` for the input-token estimator is slightly inconsistent with
  `ChunkByTokenCountConfig`'s own default (`o200k_base`) elsewhere in the codebase — not blocking
  (both are explicitly documented as estimates, and `o200k_base` is arguably the closer BPE-family
  approximation to modern Claude models), but worth a one-line justification in `design.md` if the
  choice is deliberate.
- `HttpClaudeTransport.send`'s exact error-signaling shape (how a non-2xx response becomes an
  `ApiError(status, body)` given the transport signature returns a bare `Future[ClaudeApiResponse]`
  with no `Either`) isn't spelled out in `design.md`/`tasks.md`. It's reasonably inferable (fail the
  `Future` with a typed exception carrying status+body, map in `ClaudeClient`), so not blocking, but
  worth a sentence in `design.md` D3 to remove any doubt at implementation time.
