## Skeptic Report — design gate (round 4 fold-in, skeptic-design-4.md)

Context: this is a fold-in re-validation of the design gate, not the original design pass (which
already CONFIRMed after 3 REFUTE rounds — `skeptic-design-1/2/3.md` — and whose main implementation
is out for review as PR #400, still `OPEN`/unmerged as of this check). The fold-in scope is a single
test-precision tightening approved by the human during Delivery-phase triage.

### What I verified (with evidence)

1. **Revision is exactly what was described.** `git status` shows only `ticket.md` and `tasks.md`
   modified (working-tree diff against `HEAD`, which already has the archive→active rename staged);
   `design.md` is untouched. `git diff HEAD -- ticket.md tasks.md` confirms the new sections: ticket.md
   gains "## Additional scope (fold-in, Delivery-phase triage)"; tasks.md gains "## 6. Tests (fold-in,
   Delivery-phase triage)" with task 6.1 (`[ ]`, correctly unchecked since no code has landed yet).

2. **`openspec validate` passes clean**, re-run directly (not trusted from the prompt):
   `openspec validate assistant-web-research-tool --strict` → `Change 'assistant-web-research-tool' is
   valid`.

3. **The described test gap is real, not invented.** Read the existing test at
   `backend/src/test/scala/com/helio/ai/ClaudeClientSpec.scala:511-543` ("drop the web_search tool
   from a later hop's outbound request once the cross-hop budget is exhausted"). It asserts
   `transport.toolRequests(0)` has `WebSearch` present and `transport.toolRequests(2)` has it absent,
   but never asserts anything about `transport.toolRequests(1)` (the middle hop). Grepped the whole
   file for `toolRequests(1)` (lines 400/429/454/665 — all in unrelated tests) to confirm no other
   assertion already covers index 1 for this scenario. The gap tasks.md 6.1 names is genuine.

4. **The tightened assertion will actually hold given the shipped implementation — traced, not
   assumed.** Read `ClaudeClient.scala`'s `toApiToolRequest` (lines 201-221): `remainingWebSearchBudget
   = math.max(0, config.webSearchMaxUses - webSearchUsed)`; `WebSearch` is appended only when
   `remainingWebSearchBudget > 0`. In the existing test, `config(webSearchMaxUses = 2)` and hop 1's
   scripted response fires 2 searches, so by the time hop 2's request is built, `webSearchUsed = 2` →
   `remainingWebSearchBudget = 0` → `WebSearch` is already omitted from `toolRequests(1)`. So this is a
   pure test-precision improvement, not a behavior change — no production code needs to move for 6.1 to
   pass, consistent with tasks.md not listing any non-test task under section 6.

5. **No missing contract update.** `specs/claude-api-client/spec.md`'s "Requirement: The web_search
   budget is enforced across the whole tool-use loop, not per hop" (lines 58-62) already states the
   general rule ("SHALL stop offering the web_search tool ... on any hop once that cumulative count
   reaches ... regardless of `maxHops`") — its illustrating scenario (lines 64-68) only demonstrates the
   third hop, but the normative requirement text already covers the middle hop too. Tightening the test
   to match the requirement's actual breadth needs no spec delta.

6. **Ambiguity check on "hop 1" numbering.** The existing test's own comments use 1-based hop naming
   ("Hop 1's request...", "By hop 3..." for `toolRequests(0)`/`toolRequests(2)`), while the fold-in
   scope text uses 0-based naming ("hop 1 (not just hop 0 and hop 2)"). Read literally against the
   ticket's own parallel construction — "hop 0 and hop 2" unambiguously means `toolRequests(0)` and
   `toolRequests(2)`, the two indices the current test already checks — "hop 1" by the same convention
   can only mean `toolRequests(1)`, the one the test is missing. Not genuinely two-ways-readable, though
   worth flagging as a non-blocking note since the file's in-code comments use the opposite convention.

7. **Traceability of the "Related" claims.** Fetched HEL-761 and HEL-762 from Linear directly — both
   exist, both correctly reference HEL-757/PR #400, and both match ticket.md's one-line summaries
   ("repository round-trip test coverage" / "structural split of this same spec file", both triaged
   `standalone`). Confirms the ticket.md fold-in section isn't fabricating its cross-references.
   (Minor, non-blocking: `gh pr view 400` shows the PR is still `OPEN`, not merged — the "already shipped
   as PR #400" framing in my briefing is a bit ahead of ground truth, but this doesn't affect the
   fold-in's soundness since it is explicitly landing before merge, which is exactly what's happening.)

8. **Scope discipline.** Task 6.1 is a single, narrowly-scoped test assertion inside an existing test
   body — no placeholders, no deferred decisions, no new files, no new config, no new AC introduced
   beyond "the test now also covers hop 1." No scope drift: it's strictly narrower than what the
   Delivery-phase triage already filtered out to HEL-761/762.

### Verdict: CONFIRM

### Non-blocking notes
- When implementing 6.1, use `transport.toolRequests(1)` (0-based array index) to avoid confusion with
  the surrounding test's own 1-based "Hop 1/Hop 3" prose comments — the ticket's "hop 1" phrasing is
  unambiguous in context but the file's mixed numbering convention is worth a beat of care.
