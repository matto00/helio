# HEL-1727: Proposal dry-run fetch: cap the remote error body and pin the SSRF guard with a spec

## Description

HEL-1638 (PR #1126) makes every proposal path dry-run apply's checks. For an inline rest/sql root, that dry run now
makes a live schema fetch at propose time. Its final review gate noted four loose ends:

1. **The remote error body has no length cap.** When the fetch fails, the remote body goes into the validation error
   and into the assistant's `is_error` tool result at full length. A large or hostile response can blow up the tool
   result and the model's context.
2. **No spec pins the SSRF guard on the dry-run fetch.** The dry run goes through the existing guard (`issueAndParse`),
   but no test fails if a later change routes it around the guard.
3. **The dry run fetches before it checks steps.** Each retry after a step error spends another unit of
   `SOURCE_FETCH_RATE_LIMIT_PER_WINDOW`.
4. **Stale MCP description.** `propose_pipeline`'s MCP description still says the proposal is "never re-validated here".

## Acceptance criteria

- [ ] The fetch-failure text in the validation error and the tool result is capped. A test shows that an oversized body
  is truncated.
- [ ] A spec fails if the dry-run fetch bypasses the SSRF guard. Prove it by mutation.
- [ ] Step checks run before the fetch, or the order is documented with a reason.
- [ ] The `propose_pipeline` description matches the behaviour.

## Driver constraints (binding)

- The SSRF spec exercises a real blocked target (loopback) through the propose path, not a mock of the guard, and makes
  no outbound network call.
- helio-mcp: source change only, no MCP deploy; the PR notes the MCP needs a redeploy at release.
- No migration. No live model call (fake transport only; any lane backend starts with ANTHROPIC_API_KEY empty).
