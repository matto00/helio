## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at HEAD 8fff8eed1ca2b7ee8df6f70aade2a0fa9e76d3a7. The change dir is untracked. Paths are under
`backend/src/main/scala/com/helio/` unless noted. No `.env` or `.concertino.env` file was read.

### What I verified (with evidence)

**Round-3 CR1 (runner has no key or DB): resolved in substance.**
- D8 now drives the lane's dev backend over HTTP. The runner holds no secrets, and HEL-1450 is untouched.
- The HTTP surface is usable from an external client:
  - `POST /api/auth/login` (`api/routes/auth/AuthRoutes.scala` l.50-67) sets the session cookie.
  - Mutating routes sit inside `requireCsrfHeader` (`ApiRoutes.scala` l.837). That requires
    `X-Helio-Requested-With: 1` (`api/http/AuthDirectives.scala` l.179-196), which any HTTP client can send.
  - Tier is exposed on `/me` (`ApiRoutes.scala` l.885; `AuthProtocol.scala` l.37/59). D8's tier check is therefore
    doable.
  - The "canonical evaluator account" claim for `matt@helio.dev` is backed by the owner's reference memory, not by
    anything in the repo. That is acceptable.
- **Per-call error state is available.** The converse response is `AssistantConversationResponse`, which carries the
  persisted `transcript`. The repository serializes every `tool_result` with `isError`
  (`infrastructure/persistence/assistant/AssistantConversationRepository.scala` l.172-177/210-214), and
  `ClaudeClient` l.151-155 sets it. So D8's telemetry-log fallback for the error flag is never needed.
- **The proposal and apply are reachable.**
  - The captured proposal can be recovered from the transcript: the `propose_patch_set` `tool_use.input` plus the
    server-minted `proposalId` in its `tool_result`. This is the frontend's own method,
    `frontend/src/features/assistant/proposalExtraction.ts`.
  - `POST /api/patch-sets/preview` and `/apply` exist (`api/routes/patchsets/PatchSetRoutes.scala` l.39-55).
  - Fingerprints are optional (`PatchSetApplyService` l.100).
- **Successful proposes can be counted from the transcript.** A successful propose is a `propose_*` `tool_use`
  whose paired `tool_result` has `isError=false`. Task 1.15's counter is therefore redundant for the eval; it is
  harmless.

**Round-3 CR2 (proposal wording): resolved.** `proposal.md` l.22-23 now says "put every Output and panel in ONE
proposal".

**Round-3 CR3 (eval spec "eval tag"): resolved.** The eval spec's testFull scenario no longer mentions a tag. It
says only "no eval case runs and no request is sent to Anthropic". The runMain/`HELIO_ASSISTANT_EVAL=1` detail lives
in D8.

**Earlier CRs: no regression.**
- D2's saved-step node schema, owner view, upstream-edit rejection and post-walk backfill are intact.
- D5's one-proposal model, D7's "ONE proposal" and the round-1 fixes are unchanged.

**Model pinning: possible without touching `.env`, but D8 does not say how, and it cannot verify the pin as written.**
- `ClaudeConfig.fromEnv` reads `sys.env("CLAUDE_MODEL")` (`infrastructure/ai/ClaudeConfig.scala` l.60). The default
  is `claude-opus-4-8`.
- `Compile / run / envVars` is `DevEnv.runEnv(dotEnv, sys.env)`, which drops any `.env` key the process env already
  has (`backend/project/DevEnv.scala`, `runEnv`). So a shell-exported value wins. `MISTAKES.md` l.305-308 documents
  the same rule.
- `start-servers.sh` launches `env $cmd` with the caller's environment (l.198), and nothing clears it
  (`lib/git-child-env.sh` unsets only `GIT_*`).
  - The configured start command is `sbt run` (`concertino.config.json` l.34). Per `MISTAKES.md` l.336-339, a
    command-mode run starts no long-lived server.
  - So `CLAUDE_MODEL=claude-haiku-4-5-20251001 scripts/concertino/start-servers.sh ...` reaches the forked backend
    JVM.
- **Caveat 1:** `start-servers.sh` is idempotent and reuses an already-healthy backend (l.189, "already healthy ...
  reusing"). If the lane's backend is already up without the export, the pin silently does nothing. The run then
  measures `claude-opus-4-8` (or whatever `.env` holds) instead of the prod model, at many times the cost.
- **Caveat 2:** the runner cannot observe which model ran. `modelId` and token usage are emitted only as MDC fields
  of the `assistant_tool_loop_outcome` log line (`services/assistant/AssistantTelemetry.scala` l.53-79). The message
  text itself is just the event name.
  - The default `plain` appender's pattern is `%d %-5level [%thread] %logger - %msg%n`, with no `%X`
    (`backend/src/main/resources/logback.xml` l.54). It prints none of them.
  - Only `LOG_FORMAT=json` (LogstashEncoder, which includes MDC) does. `LogFormatPropertyDefiner` reads `LOG_FORMAT`
    from `sys.env`, so it can be exported the same way.
  - The converse response carries no usage field.
- **Consequence.** As written, D8's "Token usage comes from telemetry logs or the response" has no source under the
  default backend start. Its "runner tracks usage and stops before exceeding [$3]" (C1) is therefore unimplementable,
  and so is any proof that the eval ran on `claude-haiku-4-5-20251001` (AC 1: "on the current prod model").

### Verdict: REFUTE

### Change Requests

1. **D8 (and tasks 0.1/0.4/1.14): specify how the model is pinned and how usage is measured, and verify both.**
   - The eval backend is started fresh: first `scripts/concertino/stop-servers.sh <WT> <DEV_PORT> <BACKEND_PORT>`,
     then `CLAUDE_MODEL=claude-haiku-4-5-20251001 LOG_FORMAT=json scripts/concertino/start-servers.sh ...`.
     - This works because shell-exported keys beat `.env` (`DevEnv.runEnv`), and nothing reads or edits `.env`.
     - The orchestrator must not reuse a backend started without them. The same restart applies before the
       after-run, since `sbt run` does not hot-reload the changed code.
   - Per case, the runner reads that conversation's `assistant_tool_loop_outcome` JSON line from
     `<WT>/.concertino-backend.log`, matched by `conversationId`, to get `inputTokens`/`outputTokens`/cache tokens and
     `modelId`.
     - On the first case, the runner aborts before any further call if `modelId != claude-haiku-4-5-20251001`, or if
       no JSON telemetry line is found. This makes a silent fallback to `claude-opus-4-8` impossible.
     - The C1 running cost is computed from those tokens.
   - Count failed calls and successful proposes from the converse response's `transcript` (`tool_result.isError`),
     which already carries them. Drop the "if those lack a per-call error flag" fallback, which is moot, and state
     that the runner sends `X-Helio-Requested-With: 1`.
   - If any part of this proves impossible at task 0.1, report it before spending. Do not instead add a usage field
     to the converse response, which would be an unplanned contract change.

### Non-blocking notes

- Pass the dev account's password to the runner via an env var or argument rather than committing it in
  `AssistantEval.scala`. It is a shared dev credential, but it does not belong in a tracked file.
- If the account turns out to be `beta` rather than `owner`, `HELIO_BETA_DAILY_MESSAGE_LIMIT` (default 50/day)
  bounds the converse count. 10-12 converses fit, but a re-run may not.
- Task 1.15's counter is redundant once proposes are counted from the transcript. Keep it only if it serves
  telemetry.
- `.concertino-backend.log` is shared across restarts. Match the line by `conversationId`, not by position.
