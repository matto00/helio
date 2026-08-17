## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Ticket-critical constraint 1 (not a model-swap ticket).** Read `proposal.md` "Non-goals" ("Switching
   `CLAUDE_MODEL` to Sonnet ... documented fallback decision only, no code change") and `design.md` D6, which
   frames the Sonnet fallback purely as PR-body prose. Grepped `tasks.md` — no task touches `CLAUDE_MODEL`,
   `ClaudeConfig`, or any model-selection code. Confirmed sound.

2. **Constraint 2 (find/get_resource untouched).** Read
   `backend/src/main/scala/com/helio/services/AssistantToolExecutor.scala` in full — `executeFind`/
   `executeGetResource` are structurally separate private methods from the four `executeProposeXxx` methods, and
   `design.md` D4 / `tasks.md` 1 explicitly scope the new `AtomicInteger` counters to only the propose_* dispatch
   paths, with test 3.3 asserting find/get_resource never touch the counters. Consistent with the ticket's own
   "do NOT touch ... find/get_resource behavior" delivery note.

3. **Constraint 3 (measurement AC genuinely satisfiable).** Traced the full plumbing path in ground truth:
   `AssistantToolExecutor.decode` (`input.convertTo[T]`, `DeserializationException` → `Left`) is the exact decode
   seam the design cites → `AssistantService.toTurnResult` (both `FinalResponse` and `HopBudgetExhausted` branches,
   `AssistantService.scala:132-158`) is the exact fold point named in D5 → `AssistantConversationRoutes.converseFlow`
   (`AssistantConversationRoutes.scala:144-156`) is the exact, single call site of
   `AssistantTelemetry.emitToolLoopOutcome`, which already logs `modelId` (`AssistantTelemetry.scala:34-57`). Every
   file/line the design cites for the counters' path matches what's actually there — the plan is not hand-waving
   about a mechanism that doesn't exist.

4. **Constraint 4 (privacy — no payload/error text in the log line).** `AssistantTelemetry.emitToolLoopOutcome`'s
   existing doc comment ("Never logs the user's typed message text") and its `Vector[(String,String)]` field list
   are all scalar/boolean/numeric today; `design.md` D7 explicitly scopes the three new fields to integers only, and
   `tasks.md` 2.3/3.5 test for absence of payload/error text. Sound — the design only proposes *counting* at the
   `decode`/`validate` failure site, never surfacing `err` itself.

5. **Constraint 5 (examples additive/non-normative; `AssistantTurnResult` backend-internal).** Confirmed
   `t.inputSchema` (a bare `JsValue`) is serialized verbatim as `"input_schema"` in `ClaudeProtocol.scala:147` /
   `ClaudeWireModels.scala:71` — so a top-level `"examples"` array actually reaches Claude's tool definition, and is
   inert to Anthropic's schema validation (standard JSON-Schema annotation keyword). Ran
   `grep -n "AssistantProposalToolSchemas\|inputSchema\|examples" scripts/check-schema-drift.mjs` — zero hits,
   confirming the drift check never inspects these hand-rolled schemas, as D1 claims. Confirmed
   `AssistantConversationRoutes.converseFlow` builds `AssistantConversationResponse` via `detailOfConverse`
   (`AssistantConversationRoutes.scala:88-96`, `146-163`) and never serializes `AssistantTurnResult` itself — so
   adding 3 flat `Int` fields to it (`AssistantProtocol.scala:35-43`) has no wire/schema-drift impact, exactly as D5
   claims. Also verified only 2 construction sites (`AssistantService.scala:134,146`) and 1 test file
   (`AssistantServiceSpec.scala`) reference `AssistantTurnResult` — the blast radius the design assumes is real, not
   underestimated.

6. **Concurrency rationale for `AtomicInteger` (D4).** Read `ClaudeClient.sendWithTools` — confirmed
   `Future.traverse(toolUses)(executeTool(executor, _))` (`ClaudeClient.scala:107-108`) really does execute every
   `tool_use` in a hop concurrently, the same justification the code already gives for `capturedProposal`'s
   `AtomicReference`. The new counters' concurrency-safety rationale is grounded, not asserted.

7. **Decode-target claims (D2).** Verified `DashboardProposal`/`PipelineProposal`/`CombinedProposal`/`PatchSet`
   case classes and their hand-written `RootJsonFormat`s (`DashboardProposalProtocol.scala`,
   `PipelineProposalProtocol.scala`, `CombinedProposalProtocol.scala:19`, `PatchSetProtocol.scala`) — all are
   structurally simple enough that a "fully-formed, decoder-verified" JSON literal example is achievable for each,
   including the `"$pipelineOutput"` sentinel (`ProposalPanel.dataTypeId: Option[String]`, no decode-time
   validation of the literal — validation is a downstream, out-of-scope concern) and `PatchSet`'s `target.id`
   required-for-update enforcement (`PatchSetProtocol.scala:101-102`).

8. **Prompt-caching mitigation claim (Risks section).** Confirmed HEL-699 ("Enable Anthropic prompt caching for the
   assistant's tool-use loop") is already merged to main (`git log --all --oneline | grep HEL-699` →
   `d4ca175e ... (#374)`, which is main's current HEAD) — the design's mitigation for prompt-token growth is not a
   forward reference to unshipped work.

9. **HEL-700 prose vs. HEL-703 delivery-note claim (adversarial check, not one of the 5 listed constraints).**
   `ticket.md`'s own delivery notes assert "Concurrent orchestrator on HEL-703 (AuthService/OAuthRoutes/
   UserRepository/AssistantConversationRoutes) — no file overlap expected." I checked ground truth:
   `git log --all --oneline | grep HEL-703` shows a real commit (`4a543611 HEL-703 Add user-tier chat gating`) on
   branch `feature/user-tier-chat-gating/HEL-703`, not yet merged to `main`, and `git show --stat` confirms it
   modifies `backend/.../api/routes/AssistantConversationRoutes.scala` — the *exact* file `tasks.md` 2.4 plans to
   edit (`converseFlow`'s `emitToolLoopOutcome` call). So the ticket's own "no file overlap expected" claim is
   factually false at the file level. I read the actual HEL-703 diff (`git show 4a543611 -- .../
   AssistantConversationRoutes.scala`): it rewrites the constructor (new `chatAccessService` param) and wraps the
   entire `val routes` tree in a tier-gate directive, but does **not** touch the `converseFlow` private method body
   or its `AssistantTelemetry.emitToolLoopOutcome(...)` call site at all — the two changes' edit regions are
   disjoint, so a standard 3-way merge is unlikely to literal-conflict even though both branches touch the same
   file. This is a real but low-severity risk the design doesn't acknowledge — see non-blocking note below.

### Verdict: CONFIRM

The design is grounded in the actual code at every seam it claims to touch (decode failure site, telemetry
call site, wire-serialization boundary, drift-check scope, concurrency model), honors all 5 stated ticket-critical
constraints, has no placeholders/TBDs, no internal contradictions between `proposal.md`/`design.md`/`tasks.md`, and
every AC traces to a specific task with a testable scenario in the spec deltas. Scope is tight — no drift beyond the
ticket, and both non-goals (model swap, find/get_resource changes) are actively guarded by tasks/tests rather than
just asserted.

### Non-blocking notes

1. `ticket.md`'s delivery note "Concurrent orchestrator on HEL-703 ... no file overlap expected" is inaccurate:
   HEL-703 has already committed changes to `AssistantConversationRoutes.scala` on its own unmerged branch. The
   actual edit regions (HEL-703's constructor/route-tree wrapper vs. this change's `converseFlow` telemetry call)
   are disjoint, so real merge-conflict risk is low — but the orchestrator should still verify a clean merge/rebase
   at delivery time rather than relying on the ticket's "no overlap" assumption.
2. Neither `design.md` nor `tasks.md` states precisely where within each `executeProposeXxx` method
   `proposeAttempts` should be incremented (before vs. after `decode`). This doesn't create ambiguity in observable
   behavior (all three telemetry scenarios in the spec delta are satisfiable either way) but the executor could
   usefully name the intended increment point (e.g. "increment attempts before decode, so a
   decode failure still counts as an attempt") to remove the last bit of implementer discretion here.
