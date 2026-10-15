# HEL-1610: ClaudeRoutesChatGateSpec zero-call guards can't catch an async Claude call leaked on a denied request

## Description

Origin: HEL-1597 (PR matto00/helio#1033), found by its final skeptic.

The spec's "no Claude call" and "count unchanged" guards (around :260, and the free-tier tests near :228/:233/:238) read
the transport counter right after the response. A mutation that leaks a Claude call ASYNCHRONOUSLY on a 429/403-denied
request passes them 12/12 unless the test waits about 1.5 s.

Do: make the guards able to fail on an async leak deterministically, for example with a transport that records calls
and a latch or flush point that drains pending callbacks before asserting, rather than a sleep. Prove it with the
skeptic's async-leak mutation: red before the change, green after. Don't add sleeps.

## Acceptance Criteria

- Every zero-call / count-unchanged guard in `ClaudeRoutesChatGateSpec` (free-tier :228/:233/:238, beta :268, and
  the same-shape guards at :335/:346 — line numbers re-derived at 53e24df5e; the ticket's ":260" is now :268) reads the
  transport count only after a deterministic flush/quiescence point that waits for any Claude call leaked
  asynchronously by a denied request. No sleeps, no `eventually`, no real Anthropic calls.
- Proof with the HEL-1597 skeptic's async-leak mutation (`gated`: `Left(err) => { val _ = inner; completeTierError(err) }`):
  the unchanged spec stays GREEN under the mutation (blind guard, "before"), the changed spec goes RED at the guard
  lines under the mutation ("after" catches it), and the changed spec is GREEN with no mutation. Which guard each
  mutation turns red is listed in design.md D5. The streaming guard (:233) is proven with M3 (eager stream call);
  a leak that materializes a denied stream is a stated limitation (design.md Non-Goals, PR body). Repeated runs, with
  this worktree's paths and non-zero executed counts.
- Test-only change; no production code changes.
