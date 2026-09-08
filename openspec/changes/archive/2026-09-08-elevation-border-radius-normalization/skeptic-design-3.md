## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Base `3a0c0fe8`. Cold spawn. Every number below re-derived by me with a comment-stripping,
multi-line-aware parser over `frontend/src/**/*.css`; nothing inherited from the artifacts.
No visual observation was made, so no dev-server provenance is claimed or required.

### What I verified (with evidence)

**Round 2 item 1 — counts and the corrected claim: CONFIRMED against the tree.** My parse:

```
box-shadow total 47   token-or-none 25   non-token 22
non-token: 9 zero-blur spread rings + 13 inset scroll-fades + 0 other  (exhaustive)
rings:  6x "0 0 0 3px var(--app-accent-dim)"  (inputs.css x2, auth.css x1, DashboardList.css x3)
        2x "0 0 0 2px var(--app-surface-strong), 0 0 0 4px var(--app-accent)"  (AccentPicker.css)
        1x "0 0 0 3px var(--app-error-surface)"  (DashboardList.css)
insets: 4x "inset 12px 0 12px -12px color-mix(...)"
        4x "inset -12px 0 12px -12px color-mix(...)"
        4x combined two-shot form
        1x "inset 8px 0 8px -8px color-mix(...)"   -> FOUR distinct values, confirmed
        by file: ConnectorsPage 4, PipelineListTable 3, SourceListTable 3, DataGrid 3
```

9/13, four distinct values, and the exhaustive two-family partition are all correct. The positive
evidence holds under my own check: every ring is `0 0 0 Npx` (zero y-offset, zero blur) and every
inset is `inset` with y-offset `0` — **not one of the 22 has a y-offset with a blur**, so no
elevation token applies to any. D0 is right in both directions.

**Radius re-measure agrees in substance:** 22 literal declarations = 12x `50%` + 4x `0` + 1x
`inherit` + the five sub-scale (`1px` x2, `3px` x1, `4px` x2) — i.e. the artifacts' "17 literal,
12 are `50%`, 5 sub-scale" split. (My total declaration count is 281 vs the artifacts' 283/285;
a parser difference, load-bearing on nothing. Non-blocking.)

**Round 2 item 2 — guard exception rule: substantially closed.** D4 now names shadows explicitly
("Every exception — shadow families included, not only the radius ones"), task 2.1b carries
exact-file + exact-declaration-text + exact-count with the explicit "never a per-file or pattern
allowance, which can never expire", and task 2.4 carries the fourth arm (literal inserted INTO
`DataGrid.css` -> RED). Two residual soft spots noted below, non-blocking.

**Round 2 item 3 — task 4.2 absence-hunt: closed.** It is now a fixed inventory (7 named overlays,
5 card surfaces, 4 recessed wells, canvas + empty state) with required per-item
confirmed/mismatched/unreachable results. Vacuous discharge is no longer possible.

**Round 2 item 4 — the three named stale copies: closed.** `design.md:115-116`, `tasks.md:51` and
`workflow-state.md:45-48` all now carry the corrected framing; `tasks.md:51` explicitly forbids
publishing the retracted figure. `ticket.md:30-31` carries 9/13/four-distinct-values.
**But a fourth, more important copy survives — CR1.**

**Guardrails respected in the artifacts:** `Modal.css` frozen (3.3, HEL-1035), accent borders frozen
(3.4), HEL-1037/HEL-1022 excluded by name, BottomNav verification-only (3.2), scroll-fade duplication
routed to a spinoff and not absorbed.

### Verdict: REFUTE

One defect, and it is the exact failure mode this ticket has now repeated three times: a retracted
measurement surviving in the document the other artifacts point at as authoritative. The scope
question is **settled below in the skeptic's favour** — no restatement needed — so this is a
one-file correction, not another design cycle.

### Change Requests

**1. The retracted "0/47 / ZERO literal" claim is still live in the primary evidence document, which
all three corrected artifacts cite as "Full evidence".**
`ticket.md:26`, `design.md:3-4` and `workflow-state.md:43` all point at
`.concertino/runs/HEL-442/evidence/premise-validation.md` (it exists in the **repo root**
`.concertino/`, not in the worktree — that is the durable evidence root and is correct). That file
still says, twice:

- line 3 — `(1) "literal box-shadows exist in older modules" — **FALSE; this half of the ticket is
  already complete.** 47 box-shadow declarations across 110 CSS files, **ZERO carrying a literal**;
  every one resolves through --app-shadow-card/--app-shadow-soft or is none.`
- line 5 — `**Already-done scope:** ... The shadow half is complete (0/47 literal).`

Round-2 CR1 required this corrected *everywhere*, and this is the copy that matters most: it is the
one artifact that survives worktree teardown, it is cited as the authority the summaries compress,
and any executor or final-gate reader who follows the link gets the retracted number stated more
emphatically than anywhere the correction reached. It also independently asserts "this half of the
ticket is already complete", which is the premise the whole scope question turns on.

Required: correct both statements in
`/home/matt/Development/helio/.concertino/runs/HEL-442/evidence/premise-validation.md` to the
measured picture — 47 = 25 token/`none` + 22 using neither elevation token (9 zero-blur spread
rings + 13 scroll-fade insets in four distinct values), none carrying a y-offset with a blur, so no
elevation token applies to any — and mark the original reading as retracted, with the reason
(the `var(--` filter scored declarations clean whose colour is tokenised and geometry literal).
Do not silently overwrite it; the retraction is the useful record.

### Non-blocking notes

- **Mutation arms 1 and 4 are not yet forced to differ.** Task 2.4 arm 1 says "a new literal
  `box-shadow` -> RED" without naming a file; arm 4 names an exception-bearing file
  (`DataGrid.css`). An executor could satisfy both from `DataGrid.css` and the pair would prove one
  thing twice. One clause fixes it: arm 1 must insert into a file carrying **no** exception. D4
  already states the intent, so this is a wording tightening, not a design change.
- **Arm 3 (stale exception -> RED) is not pinned to a shadow exception.** Round-2 CR2(c) asked for
  that specifically. I do not treat it as blocking, because D4/2.1b now *mandate* exact-declaration
  pinning for shadows and arm 4 independently catches a pattern/per-file allowance at insertion
  time — so a stale-arm demonstrated on any exception exercises the same code path. Still, "drop a
  pinned shadow count by one" and "delete one pinned shadow declaration from the CSS" are the two
  cheapest transcripts to add, and they close the expiry question for 22 of the ~27 exceptions
  rather than for the 5 radius ones.
- **`ConnectorsPage.css` holds three of the four distinct inset values (12px, -12px, combined) plus
  the lone `8px` variant.** Whatever exception structure the executor picks must key on
  (file, declaration text, count) — a per-file count alone in that file would be satisfiable by the
  wrong declaration. 2.1b's rule is correct as written; this is the file that will test it.
- Round-2's note on task 5.1 still applies: 5.1 continues to ask for "the `BottomNav`
  backdrop-filter outcome" in DESIGN.md. Re-stating the HEL-774 carve-out is duplication that
  drifts; recording nothing new for BottomNav is the better outcome.
- Declaration-count nit: `border-radius` totals are quoted as 283 (design.md, workflow-state) and
  285 (skeptic-1 grep hits); my parser counts 281 declarations. Nothing depends on it.

### The scope question — SETTLED

**Guard + documentation, with possibly zero other CSS change, is an honest satisfaction of the ACs.
Neither restatement nor close-as-already-satisfied is warranted.** Traced against the ticket:

- **AC1** ("no literal box-shadow/border-radius where a token applies; **guard test added**") — the
  first clause is measurably already true (no elevation token applies to any of the 22 shadows;
  `50%` x12 is the correct idiom; the five sub-scale values sit below the 6px floor so no token
  exists to apply). The second clause is **unbuilt and is real work** — I re-confirmed nothing in
  the repo protects this: `tokenAuditSweep.css.test.ts` covers spacing/colour/font over a hard-coded
  file list, `motionTokenGuard.css.test.ts` is duration-only. AC1 literally names the guard as a
  deliverable, so a guard-only diff discharges AC1 on its own terms. This is why the ticket must not
  be closed as already-satisfied.
- **AC2** — accent borders measured non-violating; both `backdrop-filter` sites accounted for (one a
  documented HEL-774 carve-out, one owned by HEL-1035). Discharged by verification + documentation.
- **AC3** — genuinely open work, discharged by tasks 4.2/4.3 on the running app, and the one place a
  real defect may still surface.
- **AC4** — gates.

`proposal.md:44-50` now states this projected shape up front, which is the right defence against a
final gate misreading a small diff as under-delivery. Rounds 1 and 2 left this open; it is closed
now. **A padded diff would mean editing correct code and is forbidden.** The only outcome I would
reject at the final gate is a diff that snaps `50%`, the sub-scale radii, or any of the 22 shadows
onto a token in the name of tidiness.
