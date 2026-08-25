## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Read all four artifacts fresh in full (`cat -n ticket.md proposal.md design.md tasks.md`), plus a
cross-file contradiction grep:
`grep -niE "near-equal|near equal|tolerance|vast majority|one already-known|one known case|closest|approximat|TODO|TBD|figure out"`.

Round-2 change requests — all three landed:

1. **Tolerance language replaced.** design.md:143-146 (Risks) now reads "mitigated by the
   exact-value-only rule (no tolerance; near-misses are flagged, never substituted)";
   proposal.md:49-51 (Impact/Risk) reads "substituting only exact-value matches (no tolerance)".
   Zero occurrences of "near-equal"/"near equal value" tolerance framing remain anywhere
   (grep above returns only the corrected no-tolerance phrasing, plus design.md:76 and
   ticket.md:42 which explicitly say a near-miss is *never* substituted).
2. **~120-literal residual framing replaced.** proposal.md:37-41 (What Changes) and
   design.md:21-25 (Non-Goals) both now state the residual is ~120 off-scale literals
   (6px/10px/14px/7px/5px), materially larger than HEL-680's stated remit, flagged in the PR
   description for a human decision. The surviving mentions of "one known case" /
   "one already-known compact-chip case" are quoted-then-corrected, not stale assertions.
3. **ticket.md AC #1 itself edited.** ticket.md:9 now reads "zero hardcoded ... literals **for
   which a matching token already exists** remain unfixed, outside the documented §3 exceptions —
   see 'AC #1 restated' below". The AC line and the restatement section (ticket.md:36-38) now
   agree; the earlier "zero literals, full stop" contradiction is gone.

Full contradiction sweep (beyond the three named lines):
- **Numbers consistent across all four files:** ~84-108 fixable, ~120 off-scale/no-token,
  ~75 at ≤4px optical allowance, 0 font-size violations, 0 font-weight violations, 0 real
  font-family violations (all 10 non-token hits are `inherit`). ticket.md:42's "84-108 of
  ~200+ >4px literals" reconciles with 108+120=228. tasks.md:11-15 restates the same baseline.
- **Exclusion list identical** in design.md:31-37 and tasks.md:3-8 (theme.css, appearance.ts,
  AccentPicker, chart palettes, `*.test.ts(x)`, comments, MfaEnrollModal QR colors,
  PreferencesEditor defaults).
- **Guard-test mechanism consistent** — pinned baseline/allowlist + fixed-literal-stays-fixed,
  demonstrated-red required (design.md:108-123, tasks.md:30-38); ticket.md:23's simpler
  "no disallowed literals remain" is narrowed, not contradicted, by the baseline mechanism the
  restated AC #1 requires.
- **Scope boundaries hold:** no new tokens anywhere; HEL-729 explicitly disjoint (design.md:125-133);
  HEL-652/677 duplicates, HEL-680 open. No TODO/TBD/deferred decisions. Open Questions: None.
- **Every AC traced to a task:** AC#1 → tasks 1.1/1.2/2.1/4.1; AC#2 → 2.2/4.3; AC#3 → 3.1/3.2;
  AC#4 → 4.2. tasks.md:4.4 covers the PR-description obligation the ticket/design impose.

Note: `scripts/concertino/next-report-number.sh` does not exist in this worktree's checkout
(only assert-phase/cleanup/setup-worktree/start-servers do); I ran the main-repo copy against
this change dir, which returned `READY number=3`. Not a blocker — the returned filename is
correct and free — but the worktree's `scripts/concertino/` is stale relative to main.

### Verdict: CONFIRM

Design is sound enough to implement: no placeholders, no internal contradictions, no ambiguity
that would let two implementers diverge, no uncovered AC, no scope drift.

### Non-blocking notes
- tasks.md:2.2 defers naming the concrete touched-surface list until 1.2's table is final. That is
  the right sequencing, but the executor must actually write that list into 2.2 rather than leave
  it implicit — 4.3's screenshot coverage depends on it.
- The `84-108` fixable range is an estimate, not a fixed count. Task 1.2 permits "matching or
  updating" the baseline; the executor should state the final exact count rather than restate the range.
