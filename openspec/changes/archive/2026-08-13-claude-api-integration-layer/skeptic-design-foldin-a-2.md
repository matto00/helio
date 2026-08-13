## Skeptic Report — design gate (fold-in sub-run A, round 2, skeptic-design-foldin-a-2.md)

### Context

Re-verification of round 1's single Change Request against the orchestrator's revised `design.md`
D9, `tasks.md` section 7, and `ticket.md`'s Dependencies section. Nothing here is taken from the
orchestrator's narrative — every claim below is grounded in a fresh read of the current file
contents and, where applicable, a command I ran myself in this worktree.

### What I verified (with evidence)

1. **Required revision — D9 relocated to `ClaudeSseAssembler.assemble`, not
   `HttpClaudeTransport.stream`'s call site.** Read `design.md:109-121` (current D9). It now reads:
   "Mid-stream failures recover inside `ClaudeSseAssembler.assemble` itself, at the `Source`
   level — not at `HttpClaudeTransport`'s call site, and not the `Future` level," and explicitly
   states the fix is "Placed in `assemble`, not the call site, so `ClaudeStreamAssemblySpec`'s
   existing byte-`Source`-fixture pattern reaches it directly (a call-site-only fix would ship a
   green test exercising neither the fix nor the real transport — caught during fold-in design
   review)." This is exactly round 1's required relocation, stated as the design going forward
   (not yet applied to code — confirmed below). Resolved.

2. **Required revision — `tasks.md` 7.1 updated to match.** Read `tasks.md:69-73`. Task 7.1 now
   reads: "Inside `ClaudeSseAssembler.assemble` itself (not at `HttpClaudeTransport`'s call
   site — a call-site-only wrap wouldn't be reachable by 7.2's test pattern), wrap the returned
   `Source` with Pekko Stream's `Source.recover`... Call site unchanged." Matches D9 verbatim in
   substance. Resolved.

3. **Required revision — `tasks.md` 7.2 narrowed to `ClaudeStreamAssemblySpec` only, ambiguous
   "or `ClaudeClientSpec`" alternative dropped.** Read `tasks.md:74-77`: "Add a
   `ClaudeStreamAssemblySpec` test (existing chunk-boundary-split pattern: a hand-constructed
   `ByteString` `Source` fed directly into `assemble`): a fake byte `Source` that emits a valid SSE
   frame then fails produces a trailing `ClaudeStreamEvent.Error` and completes — never hangs, never
   fails the materialized `Source` unhandled." No mention of `ClaudeClientSpec` anywhere in section
   7 (`grep -n "ClaudeClientSpec" tasks.md` only matches the pre-existing, unrelated task 6.2).
   Resolved — with the fix now living inside `assemble` (point 1) and the test targeting `assemble`
   directly (this point), the round-1 gap ("a test that passes without exercising the fixed path")
   is closed at the design level.

4. **Non-blocking note 1 — `check-scala-quality` → `check:scala-quality` typo fixed.** Read
   `tasks.md:79`: "`check:scala-quality`/`check:openspec`" (colon). Cross-checked against the real
   script name: `grep -n '"check' package.json` → `"check:scala-quality":
   "node scripts/check-scala-quality.mjs"` exists verbatim; no `check-scala-quality` (hyphen) entry
   anywhere. Resolved.

5. **Non-blocking note 2 — `ticket.md` Dependencies section now names HEL-395.** Read
   `ticket.md:43-46`. The Dependencies section gained a new line: "HEL-395 (chat UI): cited as the
   motivating justification for fold-in follow-up A (mid-stream SSE resilience) — HEL-395 will be a
   direct consumer of `ClaudeClient.stream`'s streaming path." The pre-existing line ("None hard
   (foundation)...") is untouched. Resolved.

6. **`design.md` still within its 150-line budget.** `wc -l design.md` → **150** exactly (not over).
   Diffed the current file against the version round 1 reviewed (this worktree has no intermediate
   commit for the fold-in edits, so I compared full text): D9's body grew from a single paragraph to
   one that also states the call-site rejection rationale, but the file holds at 150 lines — the
   editor evidently trimmed elsewhere to make room (spot check: the Context/Decisions D1–D8 prose I
   read in round 1 is unchanged in substance on this pass too, e.g. D1–D8 content matches what round
   1 confirmed line-for-line). No decision, alternative, or risk appears to have been dropped to make
   the budget — the Risks section still carries all four bracketed risk entries including the D9
   entry, and Migration Plan / Planner Notes / Open Questions sections are all present and
   substantively unchanged from round 1's description of them.

7. **Code is still untouched (as expected — design gate, not post-implementation).** `git status
   --short` shows only the openspec-artifact renames from de-archiving plus this report; no diff
   under `backend/src/main/scala/com/helio/ai/`. Read `ClaudeSseAssembler.scala` in full: `assemble`
   still has no `.recover` wrap (5-line body, unchanged from round 1's description) — consistent
   with `tasks.md` 7.1/7.2/7.3 all still showing `[ ]` (not yet implemented). Read
   `HttpClaudeTransport.scala:71-90`: `stream`'s `.recover` is still only on the outer
   `Future[Source[...]]` (line 84-87), confirming the gap D9 diagnoses is still live in the code and
   the design's fix has not been prematurely half-applied at the wrong site.

8. **`openspec validate --strict` passes fresh.** Ran `openspec validate
   claude-api-integration-layer --strict` myself in this worktree → `Change
   'claude-api-integration-layer' is valid`.

### Verdict: CONFIRM

All of round 1's required change requests are resolved in the current `design.md`/`tasks.md`
contents, both non-blocking notes are also addressed, and `design.md` remains within its 150-line
budget with no substantive content lost. The design is sound to proceed to implementation of
section 7.

### Non-blocking notes

- Environmental: this worktree's `scripts/concertino/` is still missing
  `next-report-number.sh`/`persist-evidence.sh`/`emit-event.sh` (same pre-existing, separately
  tracked gap round 1 flagged — issue B in `workflow-state.md`). I invoked the main checkout's
  copies (`/home/matt/Development/helio/scripts/concertino/...`, self-contained and path/ticket
  driven) to complete the durable-evidence and verdict-emission steps, and wrote this report
  directly to the orchestrator-specified filename `skeptic-design-foldin-a-2.md` after confirming
  on disk it does not collide with round 1's `skeptic-design-foldin-a-1.md` (the general-purpose
  `next-report-number.sh` script does not recognize the `skeptic-design-foldin-a` report kind, only
  `skeptic-design`/`skeptic-final`/`evaluation`, so it could not be used to derive this filename).
