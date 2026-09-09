## Skeptic Report — design gate (round 8, skeptic-design-8.md)

Read-only consistency round at `d7904290`. No file edited, no app started, no arithmetic re-derived.
`design.md` (326 lines) and `tasks.md` (127 lines) read together as one document.

### What I verified (with evidence)

- **Rule 1 (a measured figure is stated once), exhaustive not sampled.** Mechanically enumerated every
  numeric literal in the `design.md` body (lines 1–276, excluding the appendix) —
  `grep -o '[0-9][0-9.]*%\|[0-9]\+\.[0-9]\+\|#[0-9a-f]\{6\}' | sort | uniq -c` — and classified each value
  occurring more than once by the quantity it denotes. Repeats: `4.5` (the threshold, an excluded constant),
  `26%` (:30 exclusion clause, :113 Blue light, :172 selection tint — the exact collision the exclusion
  names), `20%`/`10%`/`22%`/`0%` (:106-107/:113 table cells vs :153-160 D6 tint labels, all inside D6 or in
  the exclusion note at :30-32). **No measured figure is stated twice as the same measurement. Rule 1 holds.**
- **Rule 2 (D2 is the complete set).** Every other mention of the scored set — `design.md` D3:98, D6:158-160,
  D7:177, Site inventory :235-247, and `tasks.md` 2.2 — defers to D2 rather than restating membership.
  `tasks.md` 2.2 now says "exactly the set D2 defines — its three included items, and neither of the two it
  explicitly excludes", which matches D2:79-86 exactly. **Holds.**
- **Rule 3 (frozen D-numbers).** Every `D`-reference in `tasks.md` (1.1, 1.2, 1.4, 2.0, 2.1, 2.2, 2.3, 3
  heading, 4.2, 4.3, 4.4, 4.5, 5 heading, 5.1, 5.2, 5.3, 5.5, 5.6) resolved by hand against the `### D`
  headings in `design.md`. All resolve to the decision they clearly mean. No `D13`, no dangling reference.
- **Translation table (appendix :311-321), spot-checked against the prior reports.** Old D12 = inline tints
  (`skeptic-design-3.md:70,108`, `-6.md:73`) → new D6 ✓; old D11 = `::selection` (`-2.md:77`, `-4.md:31-53`)
  → D7 ✓; old D9 = `--app-accent-strong`, "8 declarations across the 6 named files" (`-2.md:20`) → D8 ✓;
  old D10 = `--app-info` alias (`-2.md:58`) → D9 ✓; old D13 = two-level alias chains (`-4.md:73`,
  `-6.md:88`) → retired ✓; D1–D5 unchanged (`-4.md:7` D5 producibility, `-5.md:42` D4 perceptibility) ✓.
  **All nine rows are correct.** Its scope statement is not — finding 2.
- **Coverage both ways.** D1–D12 each have an implementing task (D1→2.1/2.4, D2→2.2/5.1, D3→2.3, D4→2.0,
  D5→5.3, D6→2.2, D7→4.4/5.5, D8→4.2, D9→1.1/4.3/5.2, D10→3.1, D11→5.6, D12→4.5). Every task traces back to
  a decision except `tasks.md` 3.2 — finding 6.

### Verdict: REFUTE

Six findings. Four are cross-document; two are `design.md` failing its own front matter. None touches the
arithmetic, the rulings, or the reachability closure — all of which held under this round's checks.

### Change Requests

1. **`design.md` D9 points at the wrong `tasks.md` task; the reference resolves to a real but wrong task.**
   - `design.md:209-210`: "The inventory and the guard corpus are both built from the transitive closure
     named in `tasks.md` task 1.2, which returns **9 properties / 53 declarations**…"
   - `tasks.md:16-18`, task **1.2**: "Classify every declaration the closure returns into the five background
     classes…" — classification, not the closure.
   - `tasks.md:10-13`, task **1.1**, is what names and runs the closure: "**Build the inventory from the
     transitive closure named in D9**… Run `…/skeptic3-accent-text-closure.py`."
   - `tasks.md` is current (it is the newer regeneration and its own internal ordering is coherent);
     `design.md:209`'s "task 1.2" is stale. Note the reference is also mutually circular as written —
     `tasks.md` 1.1 says the closure is "named in D9" and D9 says it is named in a task.

2. **The appendix mis-states which prior reports the translation table applies to; applying it to
   `skeptic-design-7.md` mistranslates every reference.**
   - `design.md:308-309`: "Reports `skeptic-design-1.md` through `-7.md` use the old numbering; translate
     with this table:"
   - `skeptic-design-7.md:70-72` (written against `f84e7e88`, i.e. already the current numbering): "`design.md:48-204`
     (current): D5 producibility, **D6 hand-rolled inline tints**, **D7 `::selection`**, **D8
     `--app-accent-strong`**, **D9 alias chains**… **D11 whole-corpus guard predicate**, **D12 dead
     per-theme defaults**. There is no D13." and `:73-77` lists the *old* numbers as the stale `tasks.md`
     side ("`:9` '(D9)' for `--app-accent-strong` (now D8)").
   - `skeptic-design-7.md` is current-numbered; `design.md:309`'s range is stale — it should not include
     `-7.md`. Translating `-7.md`'s "D8 `--app-accent-strong`" through the table yields D12 (dead defaults),
     which is precisely the authoritative-looking wrong lookup this table exists to prevent.

3. **D3 assigns the re-derivation of "the final figures" to a task that re-derives only the dark ones.**
   - `design.md:115-117`: "**The final figures are re-derived from the complete set at implementation time**
     (`tasks.md` task 2.0) rather than stated here…"
   - `tasks.md:26-28`, task 2.0: "**D4 gate — before any site is repointed.** Re-derive the final **dark
     adjustments** from the complete scored set (D2), then render them…"
   - `design.md` is current on intent (D3's light tables at :104-113 are explicitly non-final, and D6:160
     says item 3 raises them again, so the light figures also require re-derivation); `tasks.md` 2.0's
     dark-only scope is the narrower statement. As written, no task owns re-deriving the final **light**
     figures, and D4:128 ("Figures come from D3's re-derivation") inherits the gap.

4. **`design.md`'s front matter and appendix both say "two rules" where four are stated.**
   - `design.md:5`: "**Two rules**, stated because violating them produced every consistency defect this
     plan has had:" — followed by four numbered rules at `:7`, `:11`, `:14`, `:20`.
   - `design.md:325-326`: "…and why **the two rules at the top** exist."
   - The four numbered rules are current (rules 3 and 4 were added deliberately this round); both "two"
     statements are stale.

5. **"Rule 1" names two different rules in the same section; `design.md:21`'s reference resolves to the
   wrong one.**
   - `design.md:20-22`, rule 4: "A check is only 'mechanical' if its input set was enumerated mechanically…
     **Rule 1 below** was once reported as mechanically verified when the figures compared had been chosen
     by hand; two duplicates survived it."
   - `design.md:7-10`, the *numbered* rule 1: "**Corrections replace decision text; they never accumulate
     beneath it.**" — which is about correction placement, not figures, and sits **above** rule 4, not below.
   - The intended target is the **unnumbered** paragraph at `design.md:24-26` ("A measured figure is stated
     once, in the section that owns it"), which `:28` then continues as "Three things **this rule** does not
     cover". That paragraph is current; `:21`'s "Rule 1 below" is the wrong identifier for it, and the
     collision is live — this round's own brief calls the figures rule "rule 1" while `tasks.md:3-4` cites
     "`design.md` rule 3" by its list position.

6. **`tasks.md` 3.2 states an implementation requirement no decision in `design.md` carries.**
   - `tasks.md:49-50`: "Confirm no wrong-colour flash on first paint; **the token needs a static `:root`
     fallback**, since `applyAccentTokens` runs in an effect and therefore after first paint."
   - `design.md` D10 (`:213-216`) covers only re-application on theme change; no decision in `design.md`
     mentions first paint, a flash, or a `:root` fallback. `grep -n 'first paint\|fallback\|flash' design.md`
     returns nothing outside the cleared-negatives list at `:289` (`var()` fallbacks, a different thing).
   - Which is current cannot be settled from the documents: either the requirement is real and `design.md`
     is missing the decision behind it, or it is scope `tasks.md` added on its own. Also note the requirement
     interacts with D12 (`:225-227`), which rules the per-theme `:root` `--app-accent` declarations dead and
     directs that they be corrected or removed.

### Non-blocking notes

- `tasks.md:29` restates "14px on `--app-surface`" from `design.md:126`. It is a stated rendering condition
  rather than a measured figure, so it is arguably outside the figures rule's scope (like the 4.5 threshold),
  but it is the only number `tasks.md` carries that `design.md` also states.
- The `10%` collision at `design.md:155`/`:159` (the `InlineConnectorSetup` tint and `--app-accent-dim`) is
  correctly handled by the exclusion at `:30-31` and by `:159`'s explicit "is exactly `--app-accent-dim`
  (10%)" framing. Recording it here only so a future exhaustive scan does not re-open it.
