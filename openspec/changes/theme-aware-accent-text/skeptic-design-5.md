## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md` (312 lines), `tasks.md` (162), and
  `specs/accessible-accent-text/spec.md` end-to-end as one document, at `641dce42`.
- Ground truth spot-checks in the worktree (not from any prior report):
  - `frontend/src/theme/theme.css:295-297` — `::selection { background: var(--app-accent-mid); }`,
    no `color`. Matches D11's premise. (Note the file is `frontend/src/theme/theme.css`, not
    `frontend/src/styles/`.)
  - `.concertino/runs/HEL-1048/evidence/` in the MAIN checkout holds 39 artifacts incl.
    `skeptic3-accent-text-closure.py` (the method task 1.2 adopts) and the contact sheets. Present
    and readable.
- **D-decision → task coverage sweep.** Every D-number has an implementing task: D1→2.1/2.4,
  D2→2.2, D3→2.3, D4→2.0, D5→5.2, D6→3.1/3.2, D7→5.4/5.5, D8→4.3, D9→1.1a(a)/4.4, D10→1.1a(b)/4.5,
  D11→4.6/5.6, D12→1.1a(d)/2.2, D13→1.1a(c)/4.7. No orphaned decision, no task without a decision.
- **Round-4 changes checked and correct as far as they go:** task 5.6 exists and specifies the fixed
  pair with both operands named (`--app-text` vs the opaque selection hex, 7.01–14.11); task 2.0
  requires re-derivation, labels the +22/+18/+22/+17 figures stale, and includes Orange (the shipped
  default); task 5.1 builds the guard corpus from the 1.2 closure; task 2.2 sources the D12 tints
  from their component stylesheets.
- **Removing selection from the scored set leaves no gap** in the derivation: because task 4.6 sets
  `::selection { color }`, the accent-text token never paints on the selection background, so the
  only remaining obligation is the fixed pair, which 5.6 owns. That reasoning holds.

### Verdict: REFUTE

One blocking finding — and it is precisely the failure mode this round was told to sweep for: a
round-4 decision that was carried into one artifact and not into another, leaving two tasks issuing
**opposite instructions about the same list**.

### Change Requests

1. **(c — introduced by round 4's fix) `tasks.md` task 4.6 directly contradicts task 2.2 and the
   round-4 D11 ruling.** Task 2.2 says: *"**Do NOT** add the opaque `::selection` background to this
   set"*. Task 4.6 says: *"Add that hex to the scored set (task 2.2)."* — and prefaces itself
   *"per the **round-3** D11"*, i.e. it is still executing the ruling round 4 overturned. An
   implementer working task 4.6 in order (it comes before task 5) will add the hex, and task 2.2's
   prohibition reads as the stale one because 4.6 cites a round explicitly. The consequence is not
   cosmetic and is stated in D11 and 2.2 themselves: **dark Cyan 3→23, dark Green 0→22, dark Orange
   14→29** — the shipped default preset moving another +15 points in dark, past the values task 2.0's
   D4 perceptibility gate is written against, on a brand ruling the owner made against contact sheets
   showing dark as imperceptible. Wrong shipped colours, and a D4 gate evaluated against a set the
   design says must not be scored.
   **Fix:** in task 4.6, delete *"Add that hex to the scored set (task 2.2)."* and replace with
   *"Do **not** add this hex to the derivation's scored set (task 2.2); the required check is the
   fixed pair in task 5.6."* Change *"per the **round-3** D11"* to *"per D11 as amended in round 4"*.
   No other artifact changes are required for this finding.

### Non-blocking notes

- **(b — carried, harmless) `proposal.md` still says "The 41 `color: var(--app-accent)` sites"**
  where `design.md`/task 1.1 say 42 and task 1.2 makes the closure (9 properties / 53 declarations)
  the source of truth. The mechanism is right; only the proposal's prose is a superseded number.
  Worth stamping to 42 (or to "the task-1.2 closure") so no future round re-litigates it.
- **(a) D4's body still names +22/+18/+22/+17** with no mark that D12's scoring superseded them.
  Task 2.0 does flag them as stale and forbids copying any figure in the document, so the mechanism
  catches this — but a one-line "superseded by D12; see task 2.0" inside D4 would close the last
  place a stale number sits unlabelled. Same for D3's cost table, which predates D12's tints.
- **(a) Selection *visibility* against the underlying surface is no longer asserted anywhere.**
  Round 3 refuted the `--app-bg`/`--app-text` option on exactly this ground (contrast 1.000 vs the
  underlying surface). Task 5.6 now checks only colour-vs-background legibility. The opaque hex is a
  26%/30% accent mix so it will differ visibly from a neutral surface in practice, and I am not
  asserting a defect — but adding "and the selection background is distinguishable from each neutral
  surface it can sit on" to 5.6 would make the round-3 criterion survive its own fix.
- **(a) Cosmetic:** task 5.6 is ordered between 5.1 and 5.2, and D12 is written after D13 in
  `design.md`. Neither affects execution.

### Scope of what I did NOT re-derive
Per the brief: D3's table, D5's producibility figure, HEL-1057's ownership, the 9/53 closure, and
rounds 3–4's negative results were taken as settled and not re-hunted. I found **no new
accent-to-text reachability route**; consistent with round 4, the search reads as closed.
