## Skeptic Report — design gate (round 9, skeptic-design-9.md)

Scope as briefed: closing check on the round-8 CRs plus one new vocabulary. Settled decisions
(D1-D4, 3-of-5, D8's seven rulings) not reopened.

### What I verified (with evidence)

**1. `dedupe.keys` ruling — correct and completely applied.**
- `openspec/specs/pipeline-dedupe-op/spec.md:9` reads verbatim "When `keys` is empty, rows are
  compared as whole rows (every field/value pair)"; `:52` reads "Leaving the key multi-select empty
  SHALL be a valid configuration (whole-row distinct)", with the scenario "User leaves keys empty
  for whole-row distinct" at `:59-61`. Both citations in D8 and in the enumeration's pass-4 table
  check out against the actual lines.
- Ruling (optional-with-legitimate-default, behaviour-defining not no-op) is factually right: empty
  is a *different specified algorithm*, not a pass-through, so `required` would break a named scenario.
- Applied in all three places: `design.md` D8 bullet (with the "own delta restates it" note),
  `design.md`'s "Why these seven and not others" paragraph naming the behaviour-defining pair,
  `tasks.md:26-33` pre-settled list, and `spec-tolerance-enumeration.md` pass-4 table + word-order
  explanation.
- **The change's own dedupe delta now sits consistently with `keys` optional.** I read
  `specs/pipeline-dedupe-op/spec.md` in full: it restates the whole-row sentence verbatim at its
  line 5, and every one of its modifications is confined to `keep` (case-insensitive match, unknown
  rejected). It touches `keys` nowhere. Its "Whole-row distinct" scenario uses `{"keys": []}` and
  expects a successful dedupe — which would fail outright if `keys` were marked required by D3. With
  the D8 pinning, no contradiction remains.

**2. Task 4.1's conditional requiredness is sufficient for `window.field`.**
- `openspec/specs/pipeline-window-op/spec.md:14-16` states `field` is "`Option[String]`: source column
  required by `running_sum`/`lag`/`lead`, ignored by the rank family", and the scenario at `:49-51`
  ("Running_sum without a field fails with a descriptive error") requires the failure in exactly one
  arm. Both citations in 4.1 are accurate.
- 4.1 as written gives an executor three things they'd otherwise have to invent: (a) the declaration
  shape MUST admit a condition, not a flat list; (b) the discriminator is reachable, because the
  predicate is evaluated against the whole raw config string, which holds `function`; (c) the failure
  is two-sided ("wrong in one direction or the other") so neither a spurious rank-family failure nor a
  missed `running_sum` failure is acceptable. That is enough to get `window` right without further
  judgement. Note the spec already *demands* the `running_sum` failure, so D3 here implements a shipped
  requirement rather than narrowing one — no delta owed.

**3. Fifth vocabulary — run, one weak finding, no new delta-requiring contradiction.**
Pattern (materially different from the four prior: none of them targeted permissive/no-change verbs):
`shall not fail|without error|remains valid|is accepted|shall succeed|passthrough|pass-through|
unchanged|identity|absent|omitted|not provided|unspecified` over all 21 `pipeline-*-op` specs.
- The large majority of hits are row-data pass-through ("fields not in `casts` pass through
  unchanged", cast:10/23, rename:10, compute:13/43, string-ops:84/110, filter:149-151) — the
  load-bearing distinction the enumeration already draws. Unaffected.
- `pipeline-date-bucket-op:11` (`outputColumn` optional) and `pipeline-unpivot-op:39` (default
  varName/valueName when omitted) reproduce pass-4's known-optional finds; `pipeline-lookup-op:132`
  (create/update SHALL succeed with an empty reference id) is the already-cited D3-aligned precedent;
  `pipeline-date-bucket-op:146/160` is a row-data guard.
- One genuinely new item, weaker than the seven: **`assert` rule-level `field`** —
  `pipeline-assert-op:46-50` requires analyze to flag an absent `field` on `notNull`/`unique`/`range`/
  `regex` rules, while `:71-74` requires that a `rowCountMin`/`rowCountMax` rule with an absent `field`
  produce **no** validationError. That is a second conditional-requiredness case, keyed on the sibling
  `kind` *within a rule element* rather than on a top-level value. It is not a tolerance guarantee this
  change contradicts (the assert delta explicitly keeps `field` absence tolerated at decode, and D3
  reuses the shipped analyze validator rather than replacing it), and 4.1's declaration shape already
  admits it. It is a non-blocking note, not a CR — see below.
- **Plainly stated: this pass produced no new field needing to be pinned optional and no new MODIFIED
  delta.** For the first time a new vocabulary returned an essentially null result against the
  delta/pinning question. That is one data point, not saturation, and the artifact is right not to
  re-claim exhaustion.

**4. Cross-artifact consistency.** Checked every numeric claim that has drifted before
(`grep -nE '\bsix\b|\bseven\b|3 of 5|233'` across proposal/design/tasks/enumeration): "3 of 5" agrees
in proposal Impact, D5, and 8.4; "233" agrees in five places; D8, the enumeration's running total, and
tasks 1.2b all say seven. One stale word only — `tasks.md:26` still reads "do NOT re-decide these
**six**" immediately above a list of seven (the same paragraph then twice says "all seven"). Cosmetic;
the enumeration is explicit and self-correcting, so it cannot mislead an executor into dropping a field.

### Verdict: CONFIRM

**Executable as written: yes.** The three artifacts are internally consistent, every citation I spot-
checked resolves to the claimed line and says what is claimed, and the two decisions this round was
asked to close (`dedupe.keys` optional; conditional requiredness for `window.field`) are both correct
and land in the places an executor actually reads — tasks 1.2b for the field table and 4.1 for the
declaration shape. Nothing in the plan requires a judgement call the plan has not already made or
routed to escalation (1.3).

**Honest residual risk carried into Phase 2**, in descending order:
1. **Spec-recall completeness remains unproven, by the design's own admission.** Five vocabularies have
   now been run; the fifth found nothing new, but four before it each found something the previous
   boundary hid. The real guarantee is task 1.2b's per-field citation column, which is a *process*
   guarantee executed during Phase 2 — so this risk is transferred, not eliminated. If an executor
   satisfies 1.2b vacuously (citing a file without reading its requirement text), an eighth trap field
   ships as `required` and silently changes an algorithm.
2. **Requiredness conditionality may have more than one instance.** 4.1 names `window.field` as "at
   least one"; the assert `kind`-keyed case above is a second, at a nested element level. An executor
   who builds the predicate to read only *top-level* config keys satisfies 4.1's letter and still gets
   assert wrong.
3. **D1's read-path narrowing rests on a sample.** 0 of 233 rows, measured before deploy; a wrong-type
   row written in between becomes a 500 on listing via `rowToDomain`. Already owned by 8.5.
4. **Scope**: 23 step files, 4 spec deltas, and a proof/guard labelling discipline across ~15 tests.
   Volume, not ambiguity, is the main Phase-2 failure risk.

### Non-blocking notes
- `tasks.md:26` — change "these six" to "these seven" (the list beneath it already has seven entries
  and the following sentence says "all seven").
- Consider adding `assert.rules[].field` to task 4.1 as the **second** named conditional case, cited to
  `pipeline-assert-op:46-50` (flag when absent for `notNull`/`unique`/`range`/`regex`) and `:71-74`
  (SHALL NOT flag for `rowCountMin`/`rowCountMax`). It makes explicit that the predicate must be able to
  key off a *sibling field within a rule element*, not only a top-level config value. Not blocking:
  1.2b's citation discipline and the shipped analyze validator both reach it, and the change's assert
  delta already keeps `field` absence tolerated at decode.
