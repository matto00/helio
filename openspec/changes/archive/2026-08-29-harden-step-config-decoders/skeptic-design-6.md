## Skeptic Report — design gate (round 6, skeptic-design-6.md)

Scoped round: check the ENUMERATION (`spec-tolerance-enumeration.md`), not a sixth general hunt.

### What I verified (with evidence)

**1. The grep — CONFIRMED exactly.**
`grep -cE 'SHALL NOT throw|MUST NOT throw|tolerant|defaults? to|any value other than|falls back|ignored' openspec/specs/pipeline-*-op/spec.md` over all 21 files: 14 with hits, 7 with none
(`aggregate`, `date-bucket`, `fillnull`, `limit`, `pivot`, `sort`, `string-ops`). Every per-file hit
count matches the table: assert 1, cast 1, compute 3, rename 2, chunk 6, extract-headings 2, select 1,
unpivot 1, split-text 2, dedupe 2, union 1, lookup 1, window 1, filter 1. No discrepancy.

**2. The 10 "unaffected" verdicts — I agree with all 10.** I read every matching line.
- Row data (5): `rename:11,21`, `cast:31`, `select:16`, `unpivot:18` — all about a field absent *from a
  row*, a surface this change does not touch.
- Omission-only config defaults (2): `extract-headings:10-11`, `split-text:11-12`. D1 preserves absent-key
  defaults, so no contradiction. I independently checked the `split-text` claim: `spec.md:10` states
  `mode` is `"paragraph"` or `"heading"` and stops — it blesses no fallback for an unknown mode, so D4's
  rejection removes unspecced behavior rather than reversing a guarantee. Claim holds.
- Operator/per-function semantics (2): `filter:131` (unary ops ignore `value`), `window:14` (`field`
  ignored by the rank family). Neither is decode.
- Already aligned with D3 (2): `lookup:63`, `union:37` already fail a run on the tolerant-decode empty
  string. (That is 11 line-items across 10 specs; the split matches.)

**3. The 4 deltas — scenario names all retained, contradictions neutralized.** I diffed scenario names
between each source requirement and its delta:
- `assert`: source 2 names retained + 3 added; guarantee narrowed to absence + open `params` contents.
- `dedupe`: source 6 names retained + 2 added; replaces the "any value other than `last`" rule explicitly.
- `chunk-by-token-count`: all 5 source names retained, none added; requirement text replaces the fallback.
- `compute`: source 7 names retained + 1 added; narrows the unconditional "SHALL append a new field
  named `column`" clause and names it as such.
No dropped scenario in any of the four. The `compute` delta's odd "see the ADDED requirement ... below"
phrasing is verbatim from the source spec, not newly introduced.

**4. `pipeline-compute-op` — claim holds.** Its 3 hits (`:14` ignored wire `type`, `:111`/`:125` legacy
expression grammar) are indeed benign for this change, and the real conflict is the unconditional
append clause at `:7-9`, which the delta addresses.

### Verdict: REFUTE

The enumeration is accurate on everything it examined — all 14 classifications hold. It fails on its
**boundary**: it treats "zero grep hits" as "no tolerance guarantee", and the fixed 7-phrase pattern has
a demonstrable false negative. Two specs in the un-examined 7 state a **config-value** tolerance
guarantee in words the pattern does not contain, and both are plausibly reached by D3/D4. One of them is
a field D4 names **by name** as one of its three highest-severity targets — so this is not a new
inspection hunt, it is the enumeration failing the check it invited.

`openspec/specs/pipeline-limit-op/spec.md:9`
> When `count` is missing, zero, or negative, the engine SHALL return all rows (safe no-op).

plus the named scenario `:19` "Count is zero or negative" → "all rows are returned (no-op)".

`openspec/specs/pipeline-sort-op/spec.md:10`
> An empty `sortBy` array SHALL be treated as a no-op (all rows returned in original order).

plus the named scenario `:24` "Empty sortBy is a no-op".

Both are config-decode/config-value tolerance, not row data. Neither carries a delta. D3 ("a step whose
required configuration is missing or **empty** fails the run") lands directly on an empty `sortBy` and a
missing `count` **if** task 1.1 marks those fields `required` — and task 1.1 defers that determination to
execution (1.3 even flags ambiguous cases as escalations). The shipped specs already pin the answer, and
the design does not acknowledge it.

### Change Requests

1. **`spec-tolerance-enumeration.md` — retire "zero hits ⇒ unaffected".** The 7 zero-hit specs were never
   read. Add a second pass over those 7 for tolerance stated as behavior rather than as the word
   "tolerant"/"defaults to" — minimally `no-op`, `silently`, `treated as`, `SHALL return all`. I ran that
   pass: it yields `limit:9,21`, `sort:10,24` (config — actionable) and `fillnull:21`,
   `date-bucket:11` (row-data / documented optional — genuinely unaffected). Record the result so the
   artifact's completeness claim covers 21 specs, not 14.

2. **`pipeline-limit-op` — resolve and carry a delta.** Decide, in `design.md`, the requiredness of
   `limit.count` for D3, and state which of these the change does to `pipeline-limit-op:9`: (a) a
   **missing** `count` still returns all rows (spec preserved — then say so explicitly so task 1.1 cannot
   silently mark it `required`); (b) `count: 0` / `-1` still returns all rows (the named scenario `:19`
   survives). If either changes, a MODIFIED delta is required retaining scenario names "Limit to N rows",
   "Count exceeds row count", "Count is zero or negative". Note the internal tension to settle while
   there: D4's prose (`design.md:99-101`) calls "`limit.count` narrowing to `0` means unlimited" the
   defect being closed, but the shipped delta scenario
   (`specs/pipeline-step-config-validation/spec.md:139-143`) is scoped only to "not representable as its
   numeric type", which does not reach `0`/`-1`/absent. Prose and delta disagree on scope; pick one.

3. **`pipeline-sort-op` — same treatment for `sortBy`.** State whether `sort.sortBy` is `required` (empty
   ⇒ D3 run failure, contradicting `:10` and the named scenario "Empty sortBy is a no-op", requiring a
   MODIFIED delta) or `optional-with-legitimate-default` (spec preserved, no delta, and task 1.1 must
   record that). Note task 2.3 already touches `SortStep`, so this field is in the change's blast radius.

4. **Bind task 1.1 to the shipped specs.** The requiredness column is the single input D3 keys off, and it
   is produced during execution with no stated obligation to check the per-op spec first. Add to 1.1: for
   every field marked `required`, confirm no `pipeline-*-op` spec blesses its absent/empty value; if one
   does, a MODIFIED delta is part of this change. That is the structural fix — without it, a fifth
   instance of this defect class can still be introduced after the design gate closes.

### Non-blocking notes

- `chunk-by-token-count`'s retained scenario name "Unrecognized encoding value falls back to o200k_base"
  now heads a body asserting the opposite (no fallback; analyze and run reject). Retaining the name is
  correct per openspec, but consider a one-line note in the delta so a future reader does not trust the
  heading over the body.

### Answer to the round-6 question

The enumeration does **not** demonstrate saturation. It is a sound, checkable classifier of the 14 specs
that matched its pattern — but saturation is a claim about the 21, and the pattern's recall over the
other 7 is untested and, as shown above, imperfect. Fixing CR#1–#4 would make it a saturation argument;
as written it is a strong non-refutation of 14 of 21.
