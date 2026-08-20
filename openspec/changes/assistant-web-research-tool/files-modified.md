## Files modified — fold-in cycle (task 6.1 only)

This change's main implementation already shipped as PR #400 (open, unmerged); the file set
below reflects only this fold-in cycle's incremental work, not the full `git diff main...HEAD`
(which also includes PR #400's already-reviewed content plus the archive→active openspec rename).

- `backend/src/test/scala/com/helio/ai/ClaudeClientSpec.scala` — tightened the existing cross-hop
  web_search-budget-exhaustion test ("drop the web_search tool from a later hop's outbound request
  once the cross-hop budget is exhausted") to also assert that hop 1 (`transport.toolRequests(1)`)
  omits `WebSearch`, not just hop 0 and hop 2. Test-only change, no production code touched (per
  fold-in design-gate skeptic's traced confirmation that the shipped `toApiToolRequest` logic
  already satisfies the tightened assertion).
