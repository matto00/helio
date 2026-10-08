## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/main-e2e-red-hel1350-hel1351/HEL-1373`. HEAD is e4289e6c88e4d8d0c174b94f1359817fe0466514 (main tip). The only untracked path is the change dir.
- **Round-1 CR1 (the hel1351 reproduction method) is addressed.**
  - design.md Goals, the Risks entry and task 2.1 now name the server-assigned `Updated {toLocaleDateString(lastUpdated)}` label. They rule out `page.clock`.
  - They require `timezoneId` emulation and/or a PanelCard DOM probe with a controlled `lastUpdated`.
  - They require the full `tallCard.textContent()` on both sides plus the matched substring.
  - I confirmed the label at `frontend/src/features/panels/ui/PanelCard.tsx:840`.
- **Round-1 CR2 (the broken example assertion and the hover target) is addressed.**
  - The `\b`-anchored example is gone, and Decision 2 now explicitly calls it wrong.
  - (a) The assertion must be scoped to the tooltip and use digit boundaries.
  - (b) The hover must be pinned to one category, or the value/baseline pair must be asserted (east 15/11, west 7/9).
  - (c) The mutation check must cover both a wrong value and the date-leak path.
  - These are promoted to Standing Constraint C1. Node probe:
    - `(?<!\d)15(?!\d)` matches `sum(amount)15vs 7d11` (true).
    - It does not match `sum(amount)10vs 7d11Updated 10/7/2026` (false).
    - The old `/\b(15|7)\b/` is true with `10/7/2026` and false with `10/8/2026`.
  - So the new form is valid on correct output and closes the date leak.
- **Round-1 non-blocking notes are all taken up.**
  - Task 4.2 now covers AC5.
  - Decision 5 and C2 now say a layout proof must be the e2e spec, red on main and green on the fix, never Jest.
  - Decision 2 now asks for a grep of other specs for the whole-card loose-digit trap.
- **hel1350 planning evidence, re-checked cold.** `art1350/tr/1-trace.trace` contains `element is outside of the viewport` 273 times. The design's claims about it stand. The design still treats the HEL-1331/HEL-1285/HEL-1366 attribution as a candidate that must be confirmed by local bisection (task 1.2). It does not treat it as a premise.
- **AC coverage:**
  - AC1 → tasks 1.1–1.2
  - AC2 → tasks 2.1–2.2
  - AC3 → Decisions 1 and 2, C1, C2
  - AC4 → task 3.1
  - AC5 → task 4.2
  - No AC is uncovered, and I found no scope drift: the non-goals exclude SSE timing changes, fixing HEL-1215 and shard rebalancing.
- **Contract updates:** `.openspec.yaml` has `skip_specs: true`. Decision 4 says to remove it and add a delta if a user-visible product fix lands. That is acceptable for a bug ticket whose cause is not yet known.
- **Feasibility of timezoneId:** it is 02:26Z on 2026-10-08 now, so `America/Los_Angeles` renders the server instant as 10/7 and `UTC` renders it as 10/8. Reproduction is possible today, and the DOM-probe fallback exists for later.

### Verdict: CONFIRM

### Non-blocking notes

- **Decision 1 conflicts with Decision 5.** Decision 1 still says "add/extend a unit test that fails on the old layout". Decision 5 and C2 say jsdom cannot show a layout failure. C2 and task 1.3 ("per Decisions 1 and 5") settle it, but the executor should read Decision 1's unit-test clause as covering non-layout logic only. Also, the decisions are numbered 1, 2, 5, 3, 4, which is out of order.
- **The timezoneId reproduction expires.** It only works while some real zone renders the server instant as the 7th: up to about 2026-10-08T11:00Z (Pacific/Pago_Pago, UTC-11). After that, use the PanelCard DOM probe with a controlled `lastUpdated`.
- **The ECharts tooltip div has no class or test hook.** No `tooltip.className` is set anywhere under `frontend/src`. Scoping the assertion to the tooltip (C1a) needs a locator strategy. Adding `className` to the tooltip option is the cleanest. A brittle locator on the inline style (`z-index`) would be a weaker choice. Either is fine if C1's mutation checks pass.
