## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold agent. Every count below is my own, derived from the tree at `9e995f69`; I inherited no figure
from either prior report or from the artifacts.

### What I verified (with evidence)

**Independent enumeration (my own scanner, comment-stripped, brace-balanced, `@media` flattened,
`theme/theme.css` excluded; predicate = a rule block declaring N of the 5 recipe properties with the
recipe's OWN values).** Result: **23 files / 29 blocks with >=3; 12 with all 5; 0 with 4; 17 with
exactly 3.** This reproduces the artifacts' stated enumeration exactly. The partition of the 17
partials that my scan yields:
- `var(--text-micro)` + `var(--weight-medium)` declared: **3** (`.mfa-enroll-modal__field label`,
  `.mfa-security-section__badge`, `.auth-field label`)
- `var(--text-micro)` + no `font-weight`: **13**
- `var(--text-xs)` + no `font-weight`: **1** (`AgentMemoryList.css` `.agent-memory-list-table__kind`)

So 12 + 3 + 13 + 1 = 29. **Design's arithmetic correction is CORRECT and independently confirmed.**

**Specificity claim (D1a "7 of the 29 at (0,1,1)").** Confirmed from my enumeration:
`.mfa-enroll-modal__field label`, `.auth-field label`, `.source-list-table th`,
`.dashboard-list__header h2`, `.pipeline-proposal-review__meta-row dt`,
`.combined-proposal-review__meta-row dt`, `.proposal-review__meta-row dt` — exactly 7.

**Cascade-position claim.** `frontend/src/main.tsx:12` is `import "./theme/theme.css";` and `:6` is
`import { App } ...`. Confirmed verbatim.

**`DESIGN.md:276` verbatim** — "Use the `.eyebrow` utility or copy its recipe." Confirmed. The
rescope's core premise (the spec must assert no prohibition) is sound.

**DEAD-selector check, derived independently (round-3 focus item #4).** I grepped every one of the
29 selectors' class tokens across `frontend/src/**/*.ts{,x}`:
- `.audit-event-table__th` — **0** non-CSS references. Even the bare prefix `audit-event-table` has
  0; the whole stylesheet appears to be orphaned.
- `.sources-page__section-title` — **0** non-CSS references (the `sources-page` prefix itself is
  live, so this is a genuinely dead modifier, not a dead file).
- All 22 other distinct selector tokens: >=1 reference.
**Result: exactly 2 DEAD blocks, matching the round-2 scanner. My scan and round 2's now agree; the
orchestrator's one-block disagreement is resolved in round 2's favour.**

**Deferral tickets (all fetched from Linear, all live).** HEL-1043 (Backlog, open) — accurately
described, is genuinely the DESIGN.md amendment decision. HEL-830 (Backlog, open). HEL-680
(Backlog, open). All three referenced accurately.

**Round-2 CR status, checked line by line:** CR3 (spec) and CR4 (unreachable + no-scaffold) are
genuinely fixed. CR1 is half-fixed. CR2 and CR5 are **not** fixed. Details below.

### Verdict: REFUTE

The predicate conversion is a good idea and its partition is exhaustive and arithmetically sound —
but it was **added as a new §0 on top of the old integer framing rather than replacing it**, so the
artifacts now carry two mutually contradictory descriptions of the same populations. And one
predicate is worded so that it swallows the population it is supposed to be disjoint from.

### Change Requests

1. **P4 as worded ADMITS the entire P5 population, and is evaluated FIRST — so P5 is empty and the
   ticket's central risk control is bypassed.**
   `tasks.md` §0.2: *"**P4 VALUE-IDENTICAL** — declares the recipe's properties with the values the
   utility applies."* A P5 block (e.g. `.outputs-rail__kind`) declares `font-family`,
   `text-transform`, `font-size`, `letter-spacing` — four of the recipe's properties — **every one
   with the value the utility applies**. It satisfies P4's text literally. Because P4 is evaluated
   before P5, all 13 weight-inheriting blocks land in P4, and P5 matches nothing. P4 routes to
   task 2 (measure, then convert); P5 routes to task 3 (convert only if the *inherited* weight
   equals the imposed one). Collapsing P5 into P4 deletes exactly the check this ticket exists for.
   The order-based disjointness argument does not save this — it is what causes it.
   **Required:** restate P4 so it requires a **declared** `font-weight` equal to the utility's — e.g.
   *"P4 VALUE-IDENTICAL — declares a `font-weight`, and every recipe property it declares carries the
   value the utility applies"* — and restate P5 as the complement (*"declares no `font-weight`"*).
   Then state the closure explicitly: P1+P2+P3+P4+P5 partitions all 29 with no fall-through.
   (For reference, on `9e995f69` my derivation gives P1=2, P2=1, P4=13, P5=13, P3 carved out of
   P4/P5 at execution time. State it as a predicate; do not pin these as authoritative.)

2. **§0.2's five predicates and §1.3/§2/§3's three-integer populations are both live and they
   contradict each other. §0.1 forbids treating integers as authoritative; §3.0 then issues one as a
   correction.**
   - `tasks.md:47` §1.3: *"Classify every block into the three populations (design D1)"* — directly
     contradicts §0.2's five predicates.
   - `tasks.md:51` heading *"The 15 value-identical blocks"*, `tasks.md:68` *"The 13 that would GAIN
     a font-weight"*, `tasks.md:70` §3.0 *"this population is **13**, not 14"* — authoritative
     integers, which §0.1 explicitly bans.
   **Required:** rewrite §1.3, §2's and §3's headings, and §3.0 in predicate terms (§2 = "the P4
   set", §3 = "the P5 set"). §3.0's arithmetic correction should be deleted, not restated — the
   predicate framing makes it unnecessary, and leaving it is the last authoritative integer in the
   execution artifact.

3. **§2.1 instructs the executor to convert the 12 full copies — 2 of which are P1 DEAD and must
   never be converted. §3b.1 states the opposite in the same file.**
   `tasks.md:60` §2.1: *"Convert the 12 full 5-property copies and the 3 partials..."*. Two of those
   12 are `.audit-event-table__th` and `.sources-page__section-title`, which §0.2 P1 and §3b.1 both
   place in the never-converted set. §3b.1 compounds it by asserting they *"sit in task 2's 'pure
   refactor' set"* — under P1-first ordering they do not sit there at all. This is round 2's CR1
   left half-applied: the rule was added in §3b, but the instruction it contradicts was not amended.
   **Required:** §2.1 must convert "the P4 set" (which excludes P1 by construction), with no
   integer. §3b.1 must stop describing the dead blocks as members of task 2's set.

4. **`design.md`'s D1 table — the artifact a reader lifts — was not corrected, and still carries the
   falsified inference. Round 2's CR2 and CR3 named these lines and they are unchanged.**
   - `design.md:61` — table row still reads `14` for the no-`font-weight` population. CR2 required
     the **table** say 13; only the prose note below it was changed.
   - `design.md:71` — *"For 15, provably no from the declared values. For 14, only measurement can
     answer."* This is the D1a-falsified claim restated verbatim three lines after D1a falsifies it,
     plus the stale 14. CR3's third bullet named this line.
   - `design.md:97` — *"those 14 sites"*.
   - The D1 table has **no row for the 2 DEAD blocks**, so it does not describe the partition, and
     its "12 | pure refactor — every value already matches" still implies the dead pair are the easy
     ones. Round 2's CR1 required exactly this restatement.
   **Required:** replace the D1 table with the five predicates and their derivation-time counts, add
   the DEAD row, and delete `design.md:71`'s "provably no from the declared values" sentence
   outright — it survives only as the inference D1a exists to kill.

5. **`proposal.md` was never corrected in either round and is now the most wrong artifact in the
   change.**
   `proposal.md:12-13`: *"15 blocks are safe from the declared values alone; 14 currently declare no
   `font-weight`..."*. Both halves are superseded — the first by D1a (falsified), the second by the
   13/1 split. The proposal is what an archived change is read from later.
   **Required:** restate in predicate terms, with no "safe from the declared values alone".

6. **`workflow-state.md` still leads with the superseded framing.**
   Line 25 heading *"## THE DELIVERABLE IS 14 MEASUREMENTS"* and lines 30-33's integer block are
   above the line 37 "SUPERSEDED" marker, so a cold re-spawn reads the wrong partition first and the
   correction second. Round 2's CR5 named line 25 specifically.
   **Required:** retitle to the deliverable in predicate terms and delete (not annotate) the
   superseded block.

7. **The binding measurement METHOD (§3.5) is scoped by placement to §3 only, but §2 converts blocks
   too.** §2.3 requires computed `font-size`/`font-weight` before/after for every converted block,
   but says nothing about **both themes**, **the same element in the same state**, or **the node
   resolved by the block's own selector**. Those three qualifiers live only in §3.5, under the
   heading for the other population. The P4 set is the larger of the two; the qualifier that makes a
   reading trustworthy must govern it as well.
   **Required:** hoist §3.5's method into §0 (or §2.0) as the method for **every** measurement this
   ticket takes, and have §3 reference it rather than own it.

8. **P3 UNREACHABLE is a judgement call, and nothing requires the judgement to be recorded.**
   I accept P3 as a predicate: it is effort-dependent and two executors could classify a block
   differently, but §3b.2/§3b.3 make the failure mode conservative and honest (unmeasured ⇒
   unconverted ⇒ listed), so a disagreement changes the size of the converted set and can never
   produce a silent regression. That is a sound design. What is missing is auditability: "state not
   reachable" as a bare assertion is indistinguishable from "I did not try", and this lane's own
   standard is that a claim is not evidence.
   **Required:** §3b.2 must require, for each block classified P3, a one-line record of **what was
   attempted** (route, action, why the state could not be produced), carried into the §5.1 listing.

9. **Task §4 is written for exactly one block, but P2 is a predicate that may match more.**
   §4.1/§4.2 say *"the `var(--text-xs)` block"* / *"it"* throughout. If the executor's P2 evaluation
   yields two blocks (it yields one on `9e995f69`, but §0.1 forbids relying on that), §4 has no
   instruction for the second.
   **Required:** phrase §4 over "every P2 block".

### Non-blocking notes

- The exhaustiveness of the five predicates checks out on the current tree: every one of the 29
  blocks matches at least one, none falls through, and P1-before-P2 for a hypothetically
  dead-and-size-divergent block is the right precedence (both mean never-convert; "no consumer" is
  the more fundamental reason). No objection to the ordering itself once CR1 is fixed.
- `design.md` and `tasks.md` both write the file as `theme.css`; its actual path is
  `frontend/src/theme/theme.css` (there is no `frontend/src/styles/`). Unambiguous in context, but
  a full path costs nothing.
- Both `design.md` and `tasks.md` quote the ticket's AC as *"no component CSS file hand-declares the
  eyebrow recipe"* and call it UNACHIEVABLE. The ticket's actual AC continues *"...except blocks
  explicitly listed in the PR as deliberately untouched with a stated reason"* — with that clause,
  the AC is literally satisfiable by the listing §5.1 already mandates. The rescope stands on its own
  merits (DESIGN.md:276 permits copying, so the spec must assert no prohibition), so this does not
  change the ruling — but §8.2a should say "the AC's *spirit* — full elimination — is unachievable
  under the current standard", not truncate the AC to make it look unachievable.
- The spec is verifiable as written: each scenario's THEN is checkable against the PR's recorded
  measurements and its unconverted-block listing. No objection to the spec.
