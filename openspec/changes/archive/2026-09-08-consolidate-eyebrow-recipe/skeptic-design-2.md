## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Counts re-derived from the tree, not inherited.** I wrote my own scanner (comments stripped,
`theme.css` excluded, `frontend/src/**/*.css`) at `9e995f69` (`git log --oneline -1` confirms the
worktree HEAD; working tree clean apart from the untracked change dir).

- Under the design's literal predicate (recipe's OWN values: `var(--font-mono)`, `uppercase`,
  `var(--eyebrow-size)`, `var(--eyebrow-tracking)`, `var(--eyebrow-weight)`), I get **exactly
  23 files / 29 blocks / 12 with all 5 / 17 with exactly 3**. Reproduces design.md:9-12. CONFIRMED.
- Partial breakdown reproduces too: `font-size` = `var(--text-micro)` x16, `var(--text-xs)` x1;
  `font-weight` = absent x14, `var(--weight-medium)` x3. The `--text-xs` block is
  `AgentMemoryList.css:82` `.agent-memory-list-table__kind` and it does declare **no**
  `font-weight` (verified by reading lines 82-88). So round 1's double-count was real and
  **12 + 3 + 13 + 1 = 29 is arithmetically correct**, and task 3's population is 13. CONFIRMED.
- I enumerated the 13 explicitly (fw-absent minus the `--text-xs` block) and got exactly 13.
- **D1a's "7 of 29 at (0,1,1)" is CONFIRMED** by enumeration: `.mfa-enroll-modal__field label`,
  `.auth-field label`, `.pipeline-proposal-review__meta-row dt`,
  `.combined-proposal-review__meta-row dt`, `.proposal-review__meta-row dt`,
  `.source-list-table th`, `.dashboard-list__header h2`.
- `DESIGN.md:275-276` verbatim: *"Use the `.eyebrow` utility or copy its recipe."* — quoted
  accurately. `git status --porcelain DESIGN.md` is empty: **DESIGN.md is untouched.** CONFIRMED.
- Spec asserts no prohibition (spec.md:9-13, "MAY adopt", "does NOT prohibit a local copy").
  CONFIRMED. PR-must-state-AC-unachievable is present at tasks.md:107-111. CONFIRMED.
- **HEL-1043 is OPEN** (Backlog, Helio v0.7), carries both sides of the argument including the
  measured case AGAINST dropping the allowance (non-homogeneous population, specificity/cascade),
  and cross-references HEL-732/HEL-346/HEL-1037 correctly. **HEL-830 is OPEN** (Backlog).
- Task-to-population coverage: task 2 → 12+3, task 3 → 13, task 4 → 1. Sums 29, **no overlap and
  no gap.** Round 1's CR1 is genuinely fixed at the population level.

**Reachability probe (the executability attack).** For each of the 29 selectors I grepped
`frontend/src` for non-CSS references. Two selectors have **zero references anywhere outside their
own stylesheet** — reproduced with a second unrestricted `grep -rn` over all file types:

- `.audit-event-table__th` (`AuditEventTable.css:15`) — `AuditEventTable.tsx` renders via
  `SortableTable` and contains **no `className` at all** (`grep -n className` on that file returns
  nothing). The class is emitted nowhere.
- `.sources-page__section-title` (`SourcesPage.css:16`) — `grep -rn` across all of
  `frontend/src` returns the CSS declaration and nothing else.

Both are in the 12-full-copy population governed by task 2.

### Verdict: REFUTE

The rescope holds, the populations are now correct and exhaustively partitioned, and HEL-1043 is
real. But the CR1 fix was applied in one place and left stale in five others (including inside
tasks.md itself), the CR2 specificity finding was not propagated to the spec, and task 3.5's method
has two concrete states in which it cannot be executed as written.

### Change Requests

1. **Two of the blocks cannot be measured, because they render nowhere.**
   `.audit-event-table__th` and `.sources-page__section-title` have zero non-CSS references (probe
   above). tasks.md:34 ("before/after computed `font-size` and `font-weight` for EVERY block
   converted — not a sample") and tasks.md:30-31 ("convert ONLY after 2.0's per-block measurement
   shows computed style unchanged") are jointly **unsatisfiable** for them: there is no element to
   measure, and adding a `className` to a component that never emits the class is a no-op edit.
   This is the same shape as HEL-1037's task 4.3 — a mandated step with no executable path.
   The artifacts must decide and state which of these applies, rather than leaving the executor to
   improvise at the gate: (a) leave them unconverted and record under §5.1 with reason "selector is
   unreferenced — no element exists to measure"; or (b) treat dead CSS as out of scope for this
   ticket and record it (a separate concern from consolidation — deleting dead rules is not what
   this ticket authorises). Whichever is chosen, D1's "12 full copies, pure refactor" must be
   re-stated as **12 blocks of which 2 are unreferenced**, since "pure refactor" currently implies
   they are the easy ones.

2. **`14` is still the operative number in five places, one of which is the execution artifact and
   directly contradicts task 3.0 four screens above it.** Round 1's CR1 was fixed at design.md:50-54
   and tasks.md:40-43 only. Still stale:
   - `tasks.md:114` — "before/after computed weights for **all 14**". This is doubly wrong: the
     population is 13, and per task 2.3 the PR must carry before/after for **every converted block**
     (the 15 as well), not only the inheriting population. Restate as "every converted block, plus
     every block measured and then left unconverted".
   - `design.md:47` — the D1 table row still reads `14`. The correction note below it is prose; the
     table is what a reader lifts.
   - `design.md:74` (D2 "For each of the 14"), `design.md:113` (risk table "for all 14"),
     `design.md:122` (two-axes "the 14 sites").
   Make the table and every downstream reference say 13, or delete the number and say "the
   inheriting population (task 3)".

3. **The specificity finding (round 1 CR2) was not applied consistently — the spec still relies on
   the falsified inference.**
   - `spec.md:30-32`: *"**WHEN** a block declares the recipe's properties with the same values the
     utility would apply / **THEN** it is converted, and its computed typography is unchanged."*
     That asserts declared-value match ⇒ unchanged computed style, which is exactly what D1a
     falsifies. As written, an executor satisfying the spec can convert the 15 on inspection.
   - `spec.md:26-28` gives measurement a reason that covers only the inheriting case ("because an
     inherited value is produced by the cascade and appears in no stylesheet source"), so the
     spec's own logic exempts the 15.
   - `design.md:57` still reads "For 15, provably no from the declared values" — contradicted by
     D1a three lines later.
   The spec must carry the second reason (specificity/cascade-position change on class adoption)
   and its scenario must be conditioned on measurement, not on value equality.

4. **Task 3.5 is not executable as written for most of the population it governs, and it does not
   forbid the one shortcut that would silently produce a wrong answer.**
   Of the 13 blocks task 3 measures, **8 sit on AI-authored review surfaces** —
   `.pipeline-proposal-review__type`, `.pipeline-proposal-review__meta-row dt`,
   `.combined-proposal-review__type`, `.combined-proposal-review__meta-row dt`,
   `.proposal-review__type`, `.proposal-review__meta-row dt`, `.patch-set-review__*` (3 of these),
   `.message-turn__outcome-note` — which render only after a proposal / patch set / assistant turn
   exists. `.message-turn__outcome-note` additionally renders only in specific turn outcomes
   (`MessageTurn.tsx:49,52`). 3.5 mandates "the running app, the same element in the same state,
   both themes" and gives no path for a state the executor cannot produce.
   Two additions are required, both in tasks.md (not workflow-state.md):
   - **An unreachable-state rule:** if the real element cannot be brought on screen, the block is
     **NOT converted** and is recorded under §5.1 with "could not be rendered — state not
     reproducible" as the reason. Without this, the predictable failure is a conversion justified by
     inspection and reported as measurement.
   - **An explicit prohibition on synthetic scaffolds:** no injected markup, no devtools-authored
     element, no isolated harness. The quantity being measured for these 13 is the **inherited**
     weight, which is a product of the real ancestor chain; an element grafted onto `body` inherits
     something else and yields a confidently wrong "equal". Attach that reason to the rule, per the
     lane's own "attach the REASON to the constraint" technique.

5. **`workflow-state.md` is stale against its own correction.** Lines 25 ("THE DELIVERABLE IS 14
   MEASUREMENTS"), 37 ("15 blocks provably safe from declared values" — falsified by D1a) and 38
   ("14 declare NO `font-weight`" as the measured population). This is the resume artifact a cold
   re-spawn reconstructs from; leaving the superseded split there re-injects the exact contradiction
   round 1 removed. Update, or replace the numbers with a pointer to design D1.

### Non-blocking notes

- The predicate is doing more work than the prose admits. Relaxing it to accept the *values* the
  tokens resolve to (`var(--text-micro)`, `var(--weight-medium)`, `0.14em`) yields **40 blocks /
  27 files**, i.e. 11 additional mono+uppercase+micro blocks (e.g. `.panel-grid-card__type-badge`,
  `.dashboard-list__pinned-badge`, `.pipeline-detail-page__lane-header`,
  `.panel-content__metric-label`). They fall out of scope because their `letter-spacing` is not the
  eyebrow tracking, which is a defensible line — but the PR should state that the predicate admits
  only recipe-own-values, so a reader does not read "29" as "every mono-uppercase label".
- `AgentMemoryList.css:82` and the 7-selector specificity list are both accurate as cited. Good
  citations; this lane has had wrong-selector citations before and these are not that.
- HEL-1043's body says "14 blocks declare no `font-weight`" — that is correct as phrased there
  (14 blocks genuinely declare none) and does not need the task-3 correction applied to it.
