# HEL-1697: Client draft regex after HEL-1683: single unbounded quantifier is still quadratic on long cells (cell-length cap or time budget), split javaRegex.ts, spec tidy

## Description

origin_kind: followup
origin_ticket: HEL-1683 (PR matto00/helio#1086, merged as fb684d03b)

HEL-1683 declines backtracking-prone client regexes to the server draft preview (Rule W: separated unbounded
quantifiers; Rule N: an ambiguity x length cap). Remaining:

1. **Quadratic single quantifier.** A single unbounded quantifier is still quadratic on long cells: `a*b` takes about
   131 ms per 1,000 rows of 500-character cells on the main thread. Accepted patterns can cost up to about 21x `a*b`;
   that is a fixed multiple, never super-quadratic. Options: a client cell-length cap (decline to the server above N
   characters), or a time budget, which would need a Worker.
2. **Cheap patterns now on the server.** Some cheap patterns, like `(\d+)\s*items` and `(\w+)\s*$`, now go to the
   server: same results, higher latency. Consider a narrower Rule W if that's noticeable.
3. **File size.** `javaRegex.ts` is 300 lines, over the ~250 soft budget. Split out the class parser.
4. **Spec tidy.**
   * The "~165 ms per cell" comment is outdated.
   * The overrun error locator should filter on its pattern.
   * The live branch should also assert the server's empty output cells.

Server-side counterpart: HEL-1690.

## Acceptance Criteria

- Item 1 is decided and implemented with a red-first long-task probe.
- Items 3-4 are done.
- The parity corpus stays unchanged.
