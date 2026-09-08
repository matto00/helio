## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Fresh cold agent. I inherited no scan. Every number below is from my own enumeration of the tree at
`9e995f69`, run before I read any prior report's figures for comparison.

### What I verified (with evidence)

**1. I derived the candidate set myself and reconciled it (task 0.4 / prompt item 5).**

My first scan used a VALUE-EQUIVALENCE predicate (`var(--text-micro)` counts as a `font-size` hit
because `--eyebrow-size` IS `var(--text-micro)`; `0.14em` and `var(--weight-medium)` likewise). It
yielded **40 blocks / 27 files** — 15 with 5, 17 with 4, 8 with 3.

That is NOT a disagreement with the artifacts; it is a different predicate. Re-running with the
predicate **tasks.md 1.1 actually states verbatim** — the five literal declarations
`font-family: var(--font-mono)`, `text-transform: uppercase`, `font-size: var(--eyebrow-size)`,
`letter-spacing: var(--eyebrow-tracking)`, `font-weight: var(--eyebrow-weight)` — reproduces the
design's figures **exactly**:

```
29 blocks  23 files   n: {3: 17, 5: 12}
fs: {var(--text-micro): 16, var(--eyebrow-size): 12, var(--text-xs): 1}
fw: {None: 14, var(--eyebrow-weight): 12, var(--weight-medium): 3}
```

Every sub-figure the artifacts assert — 23/29/12/17, the 16+1 size split, the 14+3 weight split — is
reproduced independently. Note also that **exactly 0 blocks have n==4** under the strict predicate,
which is what makes 12+17=29 arithmetically consistent; that is a real property of the tree, not a
coincidence I had to assume.

The 11 blocks in my 40 that are not in the 29 are correctly outside scope: 8 have a non-recipe
tracking (`0.08em` ×4, `0.04em` ×3, none ×1 — e.g. `.panel-grid-card__type-badge`,
`.dashboard-list__pinned-badge`, `.pipeline-detail-page__lane-header`), and 2
(`PipelineProposalReview.css` `__disabled`, `__lane-label`) **declare no `font-family` at all** —
I read the source directly to confirm, not the scanner. A mono recipe without `font-mono` is not
this recipe.

**2. The 7 `(0,1,1)` selectors — independently confirmed, exactly 7.** From my own 29:
`.mfa-enroll-modal__field label`, `.auth-field label`, `.pipeline-proposal-review__meta-row dt`,
`.combined-proposal-review__meta-row dt`, `.proposal-review__meta-row dt`, `.source-list-table th`,
`.dashboard-list__header h2`. D1a / task 2.0's "sampling is invalid" premise holds.

**3. Both DEAD selectors confirmed.** `grep -rn` over `--include=*.ts --include=*.tsx` in
`frontend/src`: `audit-event-table__th` → **0 hits**, `sources-page__section-title` → **0 hits**.
Control: `source-list-table` (a sibling `th` block in the same population) returns 5 hits, so the
grep is not vacuously empty. Both are full 5-property copies at `AuditEventTable.css:15` and
`SourcesPage.css:16`.

**4. `AgentMemoryList.css:82` cited correctly.** Read directly: `.agent-memory-list-table__kind` at
line 82, `font-size: var(--text-xs)`, mono, uppercase, `var(--eyebrow-tracking)`, and **no
`font-weight`** — so it genuinely matches both P2 and P5's shape, which is exactly why evaluation
order matters. (My scanner's line numbers were comment-stripped and shifted; the artifacts' are
right and mine were the ones to distrust.)

**5. The rescope premise — `DESIGN.md:276` read verbatim.** Confirmed:
*"**Eyebrows** (section labels): mono, `--text-micro`, uppercase, tracked `--eyebrow-tracking`. Use
the `.eyebrow` utility or copy its recipe."* The allowance is real, so all 29 blocks are compliant,
the AC does forbid what the standard permits, and the rescope is grounded rather than an excuse.
The spec delta asserts **no prohibition** (verified in the requirement body), and task 8.2a commits
the PR to saying the AC is unachievable rather than quietly under-delivering.

**6. Tokens are NOT theme-scoped.** `--text-micro: 0.625rem`, `--weight-medium: 500` are defined once
at `:root` (`theme.css:23,33`) and are absent from both `:root[data-theme="dark"]` (`:146`) and
`:root[data-theme="light"]` (`:190`). This matters for judging the both-themes requirement — see
note (c).

**7. All three deferrals are LIVE tickets, checked in Linear, not asserted.** HEL-1043 (Backlog,
created 2026-09-08, and its body correctly states the DESIGN.md decision is the owner's), HEL-830
(Backlog), HEL-680 (Backlog). Every deferral in these artifacts has a real owner.

---

### The central question: did round 3's P4/P5 fix introduce a defect?

**No.** I evaluated all five predicates against all 29 blocks myself, in the stated order.

| predicate | population I derived | count |
| --- | --- | --- |
| **P1 DEAD** | `.audit-event-table__th`, `.sources-page__section-title` (both 5-property) | **2** |
| **P2 SIZE-DIVERGENT** | `.agent-memory-list-table__kind` (`--text-xs`) | **1** |
| **P3 UNREACHABLE** | execution-time only | — |
| **P4 VALUE-IDENTICAL** (all five, incl. explicit `font-weight`) | 12 full copies − 2 DEAD, **plus the 3 partials that declare `var(--text-micro)` + `var(--weight-medium)`** (`.mfa-enroll-modal__field label`, `.mfa-security-section__badge`, `.auth-field label`) — these declare all five properties at the utility's values | **13** |
| **P5 WEIGHT-INHERITING** (other four, NO `font-weight`) | 14 no-weight partials − 1 caught by P2 | **13** |

**2 + 1 + 13 + 13 = 29.** Exhaustive on this tree, disjoint, no fall-through, nothing unmatched.

The two dual-match cases are the whole test of the ordering, and both resolve correctly:
- the 2 dead blocks satisfy P4 (all five) but P1 fires first → excluded, as task 2.1 independently
  spells out by name;
- the `--text-xs` block satisfies P5's "no `font-weight`" but P2 fires first → task 4, as task 3.0
  independently spells out.

Round 3's discriminator ("presence or absence of an explicit `font-weight` declaration, nothing
else") does the work it claims: the 3 `var(--weight-medium)` partials land in P4 and the 13
inheriting blocks land in P5, so **P5 is no longer empty** — the swallow is genuinely fixed, not
merely described as fixed. I could not construct a block in the current 29 that lands in the wrong
bucket. **This is not a second fix-introduced defect.**

### Could an executor build this without improvising?

Yes. I walked the task list as an implementer. §0 classifies, §1.1 gives the literal predicate plus a
STOP-on-mismatch tripwire, §2 converts P4 (naming the 2 dead exclusions explicitly), §3 measures P5
with the binding method at 3.5, §3b handles unreachable/dead and prohibits scaffolds, §4 flags
without deciding, §5–§8 cover recording, screenshots, gates and PR content. No decision is left for
the executor to invent.

### UI-cohesion gate

Satisfied. Task 3.5 binds the executor to **computed style in the running app, BOTH themes, the same
element in the same state, resolved by the block's own selector**, with the wrong-selector failure
(HEL-469's `DataGrid.css:72`) attached as its reason. Task 3b.3 prohibits synthetic scaffolds **with
the correct justification** — a scaffold supplies its own cascade and would fabricate the inherited
weight, which is the exact quantity under measurement. Task 6.1/6.2 require before/after screenshots
in both themes across all three structural contexts. Task 6.4's content self-authentication closes
the port-collision hole. Task 7.1 pre-empts the root-`npm test` false pass by name.

### Verdict: CONFIRM

The artifacts are sound enough to implement. Every load-bearing claim I could check against ground
truth reproduced, including the two that prior rounds got wrong. The remaining items are prose
hygiene, each already overridden by an explicit downstream instruction, and none of them requires
the executor to make a decision the artifacts fail to make.

### Non-blocking notes

(a) **`tasks.md` 1.3 still points at design D1, which `design.md` marks SUPERSEDED.** It says
"classify every block into the three populations (design D1)" — a framing that omits P1 DEAD and P3
entirely, so followed literally it would carry the 2 dead 5-property blocks into §2 as "value
identical (safe)". It is harmless only because 2.1 and 3b.1 both rescue them by name. This is the
round-3 finding's shape (a superseded framing left live beside its replacement) surviving in §1.
Cheapest fix: delete 1.3, since §0.2 already fully subsumes it.

(b) **`tasks.md` §3 was never re-keyed to P5 the way §2 was re-keyed to P4.** The heading and 3.0/3.1/
3.4 say "the 13". The integer happens to be right (P5 = 13, which I derived independently), and 1.1's
STOP tripwire plus 8.1's re-derivation catch drift — so it is not live-wrong. But 3.0's
`12 + 3 + 13 + 1 = 29` is a partition under the *pre-P1* framing: it presents the 12 full copies as
one bloc without noting 2 of them are DEAD. Phrasing §3 as "P5 blocks — count derived in 0.3" would
finish the job round 3 started on §2.

(c) **§2 does not restate 3.5's method for P4 measurements.** 2.3 requires before/after computed
`font-size`/`font-weight` for every converted block but cites only 2.0, so the "both themes / same
element and state / block's own selector" method is textually scoped to §3. Low consequence, because
finding 6 shows `--text-micro` and `--weight-medium` are not redefined per theme, so these two
computed values are theme-invariant and §6's screenshots carry the visual half. A one-line "method
per 3.5" in 2.3 would remove the ambiguity.

(d) **The predicate is worded two ways.** `ticket.md`/`design.md` say "with the recipe's own values",
which under a value-equivalence reading yields **40 blocks / 27 files**, not 29/23 — that is how my
first scan diverged. `tasks.md` 1.1 disambiguates by listing the five literal declarations, and the
executor works from tasks.md, so this does not misdirect execution. Worth tightening in design.md to
"with the recipe's own literal token references" so a future reader cannot re-derive 40 and think the
scope was under-counted.

(e) **P1–P5 are exhaustive on this tree but not by construction.** A block declaring the recipe's
three unweighted properties plus a *non-matching* explicit `font-weight` (say `var(--weight-bold)`)
would match neither P4 (values differ) nor P5 (a weight is declared). Zero such blocks exist at
`9e995f69` — I checked; every partial's weight is either absent or `var(--weight-medium)` — so this
is latent, not actual, and 1.1's STOP-on-mismatch would surface it. A terminal "P6 OTHER → not
converted, listed under task 5" would make the partition total rather than merely lucky.
