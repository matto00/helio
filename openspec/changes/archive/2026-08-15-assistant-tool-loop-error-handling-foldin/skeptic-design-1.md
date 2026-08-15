## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### Scope of this review

This is a post-delivery **fold-in addendum** to an already-merged ticket (PR #347, commit
`69e48c44`), not a fresh feature. Per the coordinator's brief, I verified: (1) the addendum's
stated scope in `ticket.md`/`proposal.md`/`tasks.md` is internally consistent and well-bounded,
and (2) the "no production code change expected" claim by reading the real implementation myself,
not trusting the plan.

### What I verified (with evidence)

1. **Traceability of the addendum's premise against the actual prior skeptic finding.** Read
   `openspec/changes/archive/2026-08-15-assistant-tool-loop-error-handling/skeptic-final-2.md`
   directly. Its "Non-blocking notes" section says verbatim: "Neither new regression test constructs
   a hop-cap turn with *two or more* simultaneous dangling `tool_use` blocks... The implementation
   handles this correctly by construction (`.collect` over the full content `Seq`, not
   `.headOption`)... worth adding in a future pass." `ticket.md`'s new "Post-delivery fold-in"
   section (lines 36–51), `proposal.md`'s "Fold-in addendum" bullet (lines 58–61), and `tasks.md`'s
   new "## 8. Fold-in addendum" section (lines 74–82) all describe exactly this gap and nothing
   more — no scope drift beyond the flagged note. All three artifacts are mutually consistent (same
   framing, same file targets, same "test-only" claim).

2. **Read `AssistantService.scala`'s real `seedHistory`/`danglingToolUseIds` cold**
   (`backend/src/main/scala/com/helio/services/AssistantService.scala:99-118`):
   ```scala
   private def seedHistory(history: Seq[ClaudeToolMessage], message: String): Seq[ClaudeToolMessage] = {
     val turnText  = if (history.isEmpty) AssistantSystemPrompt.text + "\n\n" + message else message
     val danglingIds = danglingToolUseIds(history)
     val newTurnContent: Seq[ClaudeContentBlock] =
       danglingIds.map(id => ClaudeContentBlock.ToolResult(id, DanglingToolUseResultMessage, isError = true)) :+
         ClaudeContentBlock.Text(turnText)
     history :+ ClaudeToolMessage(ClaudeRole.User, newTurnContent)
   }

   private def danglingToolUseIds(history: Seq[ClaudeToolMessage]): Seq[String] =
     history.lastOption.toSeq.flatMap(_.content).collect { case tu: ClaudeContentBlock.ToolUse => tu.id }
   ```
   `danglingToolUseIds` `.collect`s over `.flatMap(_.content)` — the **entire** content sequence of
   the last turn — not `.headOption`/`.find`, so it already gathers every `ToolUse` id present, not
   just the first. `seedHistory` then `.map`s each id to its **own** `ToolResult(id, ..., isError =
   true)` block via `danglingIds.map(...)`, so N dangling ids produce N distinct paired
   `ToolResult`s, not one shared/merged result. This independently confirms the claim in
   `ticket.md`/`tasks.md` ("no production code change expected... the fix already handles this
   correctly") is accurate, not merely asserted.

3. **Checked for other call sites / hidden coupling** that could make "test-only" wrong:
   `grep -rn "seedHistory\|danglingToolUseIds" backend/src/main backend/src/test` shows both are
   `private` methods with a single call site (`AssistantService.converse`, line 68) and appear
   nowhere else in production code. No other caller could produce a divergent multi-dangling shape
   this fix doesn't already cover.

4. **Checked the addendum's acceptance signal is concrete and testable, not hand-wavy.** Task 8.1:
   "assert the next `converse` call succeeds and every dangling block gets its own paired synthetic
   `isError` `tool_result` in the outbound request." Read the existing single-dangling precedent
   test (`AssistantServiceSpec.scala:337-362`, "repair a dangling tool_use left by a prior
   hop-cap-exhausted turn before continuing the conversation") — it already asserts exactly this
   shape (searches every `tool_use` id in each outbound message, requires a matching
   `toolUseId` in the immediately-following message, plus a no-consecutive-same-role invariant
   check). The addendum is a direct, mechanical extension of this existing pattern (put 2+
   `ClaudeContentBlock.ToolUse` entries in the dangling assistant turn's `content: Seq(...)` instead
   of 1) — there's a concrete template to build from, not an underspecified task. Confirmed
   `ClaudeContentBlock.ToolResult(toolUseId: String, content: String, isError: Boolean = false)`
   (`ClaudeModels.scala:96`) so "isError" is directly assertable per-block.

5. **Checked for placeholders/ambiguity/contradictions.** No `TODO`/`TBD` in any of the three
   addendum sections. The one deliberately-left-open choice — test layer, `AssistantServiceSpec.scala`
   vs. `AssistantConversationRoutesSpec.scala` — is explicitly flagged as "executor's call on the
   right layer," which is a reasonable non-blocking implementation choice (both layers exercise the
   same `seedHistory` code path via `AssistantService.converse`; either would satisfy the AC), not a
   gap a competent implementer could misread into a *different outcome*.

6. **Checked design.md/specs weren't left stale or contradicted.** `diff` of
   `openspec/changes/assistant-tool-loop-error-handling/design.md` and `specs/` against the archived
   pre-addendum versions shows **zero changes** — correct, since the addendum makes no capability or
   behavior change (test-only), so no design/spec delta is expected or missing. `tasks.md` section 8
   correctly does not cite any `design.md` D-section (unlike sections 1–7, which all cite one),
   consistent with this being pure test coverage.

7. **Checked contingency handling.** Task 8.2 ("confirm no production code change is needed... if
   one IS needed, that's new information the test surfaced, fix it") correctly leaves room for the
   claim to be wrong without blocking the plan — appropriate given code-review can't fully substitute
   for the test actually running. Given point 2 above, I assess the claim as correct, but the task
   doesn't overcommit to that in a way that would trap the executor if it's somehow off.

8. **Cross-checked against Linear** (`mcp__linear__get_issue HEL-667`): status "Done", PR #347
   attached, matching the worktree's own `workflow-state.md` note describing the reset-and-reopen
   fold-in flow. No inconsistency between the ticket-provider state and the OpenSpec artifacts here.

### Verdict: CONFIRM

The addendum's scope is small, precisely bounded to the one non-blocking gap the prior skeptic
report actually flagged, internally consistent across `ticket.md`/`proposal.md`/`tasks.md`, and its
central technical claim — no production code change needed because `danglingToolUseIds` already
`.collect`s over the full last-turn content — is independently confirmed correct by reading
`AssistantService.scala` directly, not merely trusted from the plan's assertion. The one open
implementation choice (test file/layer) is legitimately non-blocking. Sound to implement as
written.

### Non-blocking notes

- None beyond what's already tracked in task 8.2's own contingency clause.
