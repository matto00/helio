## Skeptic Report — design gate (fold-in sub-run A, round 1, skeptic-design-foldin-a-1.md)

### Context

Design-gate re-run for a coordinator-approved fold-in ("post-delivery follow-up A") onto the
already-delivered (PR #326 open, not merged) `claude-api-integration-layer` change: a mid-stream
SSE connection-drop resilience fix for `HttpClaudeTransport.stream`. Verified fresh — nothing here
is taken from another agent's narrative.

### What I verified (with evidence)

1. **`design.md` is exactly at its stated 150-line budget.**
   `wc -l openspec/changes/claude-api-integration-layer/design.md` → `150`. Diffed against the
   pre-fold-in archived version (`git show f715f8d5:.../archive/2026-08-13-claude-api-integration-layer/design.md`,
   149 lines): the trims are prose-tightening only (e.g. "are enough to parse SSE by hand" →
   "suffice to parse SSE by hand"; dropped restated clauses like "since the SPI boundary is exactly
   where the ticket asks for the seam"). No decision, alternative-considered, risk, or rationale was
   dropped — D1–D8 read identically in substance to the CONFIRMed original. D9 + its Risk entry were
   added net-new. The trim did not go too far.

2. **D1–D8 unchanged in substance; no contradiction with the fold-in.** Confirmed via
   `git diff HEAD -- design.md` (shows the file as wholly new-at-this-path since it moved out of
   `archive/`, so I diffed the archived blob directly instead) — every pre-existing Decision's
   claims about the codebase (`RestApiConnector` pattern, `ClaudeTransport` SPI, guardrail
   clamp/reject split, SSE-by-hand via `Framing`, fail-fast-at-construction, model-as-`String`,
   Secret Manager entry) still hold against the actual code in
   `backend/src/main/scala/com/helio/ai/{ClaudeClient,ClaudeConfig,ClaudeModels,HttpClaudeTransport}.scala`,
   which I read in full.

3. **D9's root-cause claim is correct against the real code.**
   Read `HttpClaudeTransport.scala:71-90`. `stream` builds `eventsFuture: Future[Source[...]]`; its
   `.recover` (line 84) is on that outer `Future` and only fires if `Http(...).singleRequest(...)`
   or the pre-`Source`-construction `flatMap` fails. Once the success branch reaches
   `Future.successful(ClaudeSseAssembler.assemble(response.entity.dataBytes))` (line 77), the
   `Future` is already resolved; a subsequent failure of `response.entity.dataBytes` (a mid-stream
   connection drop) surfaces only on the materialized `Source` returned by
   `Source.futureSource(eventsFuture)` (line 89) — past where `.recover` can see it, exactly as D9
   states. This is a real, correctly-diagnosed gap, not a hypothetical.

4. **D9's proposed fix is syntactically and semantically sound.** `Source[Out, Mat].recover(pf:
   PartialFunction[Throwable, Out])` is a real Pekko Streams operator; wrapping
   `ClaudeSseAssembler.assemble(response.entity.dataBytes)` with it emits one recovered
   `ClaudeStreamEvent.Error(ClaudeError.TransportFailure(...))` element then completes normally —
   matching the new spec.md scenario ("emits a ClaudeStreamEvent.Error element and then completes")
   and mirroring D4a's existing typed-error-event contract. `ClaudeError.TransportFailure(message:
   String)` and `ClaudeStreamEvent.Error(error: ClaudeError)` (read in `ClaudeModels.scala`) both
   already exist with matching shapes — no new type needed.

5. **`openspec validate` passes fresh.** Ran `openspec validate claude-api-integration-layer
   --strict` myself (the `--change` flag name in the task brief doesn't exist on this CLI version;
   `--changes` conflicts, the positional form is correct) → `Change 'claude-api-integration-layer'
   is valid`.

6. **New AC / proposal bullet / spec requirement are all mutually consistent and traceable to D9** —
   read `ticket.md` AC 8, `proposal.md`'s fold-in bullet, and the new "Mid-stream connection failures
   surface as a typed error event" requirement + scenario in
   `specs/claude-api-client/spec.md:137-148`. No contradiction, no scope drift beyond the ticket's
   own fold-in AC.

### Change Requests

1. **Tasks 7.1/7.2 as scoped cannot produce a test that actually exercises the code D9 fixes** —
   this is the "test that passes without exercising the fixed path proves nothing" trap
   (systematic-debugging law), and it's real, not hypothetical, against this codebase:

   - D9 places the `.recover` wrap *inline inside `HttpClaudeTransport.stream`*
     (`HttpClaudeTransport.scala:77`, the success branch). There is no
     `HttpClaudeTransportSpec.scala` today (confirmed:
     `find backend/src/test/scala/com/helio/ai -type f` → only `ClaudeClientSpec.scala`,
     `ClaudeConfigSpec.scala`, `ClaudeStreamAssemblySpec.scala`), and tasks.md section 7 adds none.
   - Task 7.2 offers "`ClaudeStreamAssemblySpec` (or `ClaudeClientSpec`)" as the test home. I read
     both files. Neither reaches the fixed code:
     - `ClaudeStreamAssemblySpec`'s existing `assemble()` test helper
       (`ClaudeStreamAssemblySpec.scala:25-28`) calls `ClaudeSseAssembler.assemble(bytes)` **with no
       `.recover`** — the *pre-fix* pipeline. A test built on this helper with a byte-`Source` that
       fails mid-stream would demonstrate the unfixed failure-propagation behavior, not the fix —
       unless the test itself also bolts on `.recover`, in which case it's testing the Pekko
       `.recover` operator in the abstract, not `HttpClaudeTransport.stream`'s production code.
     - `ClaudeClientSpec` constructs `ClaudeClient` with a hand-written `FakeClaudeTransport` stub
       (`ClaudeClientSpec.scala:47`), never the real `HttpClaudeTransport`.
       `ClaudeClient.stream` (`ClaudeClient.scala:48-54`) delegates untouched to whatever
       `ClaudeTransport.stream` the injected transport returns — it never touches
       `HttpClaudeTransport.scala` either.
   - Net effect: an implementer can satisfy task 7.2 literally and ship a green test suite in which
     `HttpClaudeTransport.stream`'s new `.recover` (the actual fix) is never invoked by any test —
     a regression in it (e.g. accidentally dropped in a future refactor) would go undetected.

   **Required revision:** move D9's fix from "inline in `HttpClaudeTransport.stream`" to *inside*
   `ClaudeSseAssembler.assemble` itself — i.e. `assemble` gains the `.recover` wrap as part of its
   own contract, and `HttpClaudeTransport.stream`'s success branch is unchanged (still just calls
   `ClaudeSseAssembler.assemble(response.entity.dataBytes)`, which now already handles mid-stream
   failure). This is a one-file relocation of the same code, not a new design:
   - Update D9 in `design.md` to describe the wrap as living in `ClaudeSseAssembler.assemble`
     (update its doc comment in `ClaudeSseAssembler.scala` accordingly — it currently says nothing
     about failure recovery), not inline in `HttpClaudeTransport.stream`.
   - Update `tasks.md` 7.1 to say "wrap the `Framing`/`mapConcat` pipeline inside
     `ClaudeSseAssembler.assemble` with `.recover`" instead of "in `HttpClaudeTransport.stream`'s
     success branch."
   - Update `tasks.md` 7.2 to name only `ClaudeStreamAssemblySpec` (drop the "or `ClaudeClientSpec`"
     alternative, which is the ambiguity that creates the gap) — a test extending the existing
     `assemble()` helper's pattern with a `Source[ByteString, _]` that emits ≥1 valid frame then
     `Source.failed(...)`s now directly exercises the real fix, matching the file's own established
     "isolated, directly-unit-tested function" philosophy already invoked in design.md's Risks
     section for this exact function.

   This is the one implementation-blocking gap in an otherwise sound fold-in plan; everything else
   (D9's diagnosis, its fix shape, the new AC/spec/proposal text) is correct and consistent.

### Non-blocking notes

- `tasks.md` 7.3 names the quality-gate command as `check-scala-quality`; the actual `package.json`
  script is `check:scala-quality` (colon, not hyphen) — confirmed via `grep -n
  "check-scala-quality\|check:openspec" package.json`. Trivial typo, will surface immediately as a
  "missing script" error if run literally; worth a one-character fix but not blocking the design.
- `ticket.md`'s new AC 8 cites HEL-395 by name as the fold-in's justification, but the ticket's
  pre-existing `Dependencies` section (unmodified by this fold-in) still only names HEL-341/343.
  Not a contradiction (the AC is a justification note, not a formal dependency declaration) but
  worth a one-line addition to `Dependencies` if this change is revised anyway.
- Environmental note (not a verdict input): this worktree's `scripts/concertino/` is missing
  `next-report-number.sh`/`persist-evidence.sh`/`emit-event.sh` (present in the main checkout's
  copy) — this is the already-tracked, separately-triaged issue B in `workflow-state.md`
  ("setup-worktree.sh doesn't populate the full generated scripts/concertino/ set"), not part of
  this fold-in's scope. I used this report's orchestrator-specified filename
  (`skeptic-design-foldin-a-1.md`, verified non-colliding on disk before writing) and invoked the
  main checkout's copies of `persist-evidence.sh`/`emit-event.sh` (both self-contained, path/ticket
  driven, work correctly when run with cwd inside this worktree) to complete the durable-evidence
  and verdict-emission steps.

### Verdict: REFUTE
