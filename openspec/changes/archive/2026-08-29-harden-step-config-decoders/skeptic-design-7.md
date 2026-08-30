## Skeptic Report — design gate (round 7, skeptic-design-7.md)

Scope as briefed: verify the two greps, D8's two rulings, D4-vs-delta agreement on
`limit.count`, and whether task 1.2b is structural. No re-opening of D1/D2/D3/D4-layer/3-of-5.

### What I verified (with evidence)

**1. Both greps re-run over all 21 `openspec/specs/pipeline-*-op/spec.md`.**

Pass 1 (`SHALL NOT throw|MUST NOT throw|tolerant|defaults? to|any value other than|falls back|ignored`):
reproduces the enumeration exactly — 14 files with hits, every per-file count matching, and the same
7 zero-hit specs (`aggregate`, `date-bucket`, `fillnull`, `limit`, `pivot`, `sort`, `string-ops`).

Pass 2 (`no-op|silently|treated as|SHALL return all|SHALL be ignored|left unchanged`) over those 7:
`limit` 2, `sort` 2, `fillnull` 1, the other four 0. The second pass's recorded result is **correct**.
`limit`:9 and `sort`:10 are real config tolerance; `fillnull`:21 is row data. CONFIRMED.

**2. A third vocabulary exists, and it is not hypothetical — it yields four new real hits.**
This was the enumeration's own stated residual risk, and it is live. Pattern:
`empty <field> (list|array|map|object)` / scenario headings of the form `Empty X …`:

```
pipeline-cast-op:35     Scenario: Empty casts map is a no-op        (casts: {} -> rows unchanged)
pipeline-rename-op:25   Scenario: Empty renames map is a no-op      (renames: {} -> rows unchanged)
pipeline-select-op:24   Scenario: Select with empty fields list produces empty rows  (fields: [] -> {})
pipeline-filter-op:11   "An empty `conditions` array SHALL pass all rows."  + Scenario :13
```

`select`'s and `filter`'s wording is caught by neither existing pattern ("produces empty rows",
"SHALL pass all rows"); `cast`/`rename` use "no-op" but were never subjected to pass 2, because pass 2
was run only over the 7 zero-hit specs. That is the same boundary error round 6 refuted, one level in:
the 14 were classified from their pass-1 hits alone, so a *different* requirement in the same file went
unread. All four of these specs are verdicted "unaffected" in the pass-1 table on the strength of an
unrelated row-data sentence.

**Why these are load-bearing, not pedantry.** `casts`, `renames`, `fields` and `conditions` are the
*sole* configuration their step kind has, so task 1.1 will mark them `required` unless told otherwise.
The `pipeline-step-config-runtime-completeness` delta then makes a "missing **or empty**" required
value fail the run and be reported at analyze. That directly contradicts four named shipped scenarios,
one of which (`filter-op:11`) is in requirement text, not just a scenario. This is exactly the class
D8 exists to close, and D8 pins only two of the six members.

**3. D8's two rulings — checked against the shipped specs. Both correct.**
`pipeline-limit-op:9` + scenario :19 and `pipeline-sort-op:10` + scenario :24 say what D8 says they say.
Marking both `optional-with-legitimate-default` preserves the shipped guarantee, so the
runtime-completeness requirement (which fires only on `required` values) never reaches them and **no
delta is genuinely needed** for either. Consistent with D4 as now written (only an *unrepresentable*
`count` is rejected) and with task 2.3: 2.3 is item-level, so a malformed `sortBy` *element* fails while
an *empty array* is untouched. No conflict.

**4. D4 vs the `pipeline-step-config-validation` delta on `limit.count` — now agree.**
Delta lines 27-30: failure only when "the supplied value cannot be represented as that option's numeric
type, rather than being narrowed". D4: "An `limit.count` that cannot be represented as its numeric type
is rejected … a missing, zero or negative `count` keeps its blessed no-op meaning (D8)", and D4's
severity paragraph now scopes the widening claim to "an UNREPRESENTABLE number". Round 6's disagreement
is resolved. CONFIRMED.

**5. Task 1.2b — structural in shape, but not sufficient as the sole guard here.**
It is not vacuous: it names a concrete deliverable (every `required` field checked against its op spec),
forbids satisfying it by vocabulary grep, and pre-settles two fields. An executor following it faithfully
*would* reach `filter-op:11`. But 1.2b is the safety net for fields the design could not foresee; it is
not a licence to leave foreseeable ones unpinned. D8's own preamble states the failure mode precisely —
a spec-blessed empty value discovered "after the design gate has already closed". Four such fields are
visible right now, from one grep, and shipping the gate with them unpinned relies on the executor
re-deriving what this gate could have handed it. That, plus the enumeration's now-false completeness
claim, is what blocks.

### Verdict: REFUTE

Narrow and cheap — no product decision reopens; D1/D2/D3, D4's layer, the 3-of-5 count and D8's two
existing rulings all stand exactly as written.

### Change Requests

1. **`design.md` D8 — pin the four additional spec-settled fields**, in the same form as `limit.count`
   and `sort.sortBy`, each with its spec citation:
   - `cast.casts` — `pipeline-cast-op:35` blesses `{}` as a no-op → optional-with-legitimate-default.
   - `rename.renames` — `pipeline-rename-op:25` blesses `{}` as a no-op → optional-with-legitimate-default.
   - `select.fields` — `pipeline-select-op:24` defines `[]` as producing empty rows. Note this one is
     *behaviour-defining, not a no-op*: an empty list has a specified, non-identity result, so marking it
     required would break a named scenario in a way the reader might not anticipate.
   - `filter.conditions` — `pipeline-filter-op:11` (requirement text, plus scenario :13): an empty
     `conditions` array SHALL pass all rows.
   State for each whether a MODIFIED delta is needed. On my reading none is — as with `limit`/`sort`,
   classifying them optional preserves the shipped guarantee and the runtime-completeness requirement
   never reaches them. If the design instead wants any of them to fail the run, that spec needs a
   MODIFIED delta in this change.

2. **`spec-tolerance-enumeration.md` — add a third pass and correct the result line.** Run pattern 3
   (`empty [^ ]* (list|array|map|object)|produces empty|is a no-op`, or equivalent) over **all 21** specs,
   not just the zero-hit 7, and record the per-spec verdict. Correct the four affected rows in the pass-1
   table (`cast`, `rename`, `select`, `filter` are no longer plain "unaffected — row data"/"operator
   semantics"; each carries a second, config-level requirement) and correct the headline count, which
   currently reads "4 need a delta, 2 preserved by D8, 15 unaffected".

3. **`spec-tolerance-enumeration.md` — retract the exhaustion claim.** "both known ones are exhausted"
   and "coverage is now 21 of 21 under two patterns" were falsified by a third pattern found in minutes,
   after the second pass had already been added for the same reason. Replace with the honest statement:
   three patterns, and pattern-based recall is not a completeness proof — which makes 1.2b the actual
   guarantee rather than a backstop to a claimed-complete enumeration.

4. **`tasks.md` 1.2b — make the check per-field and recorded, not attested.** Require the executor to
   record, in `enumeration.md`, for every field marked `required`, the specific spec file and line whose
   requirement text was read, and the conclusion. A checkbox saying "I checked" is satisfiable vacuously;
   a column of citations is not. Extend the pre-settled list to all six fields from CR-1.

### Non-blocking notes
- The enumeration's "second pass" heading says "the other 7 specs"; once CR-2 lands, make the pass/scope
  relationship explicit (which pattern was run over which subset), since the 7-only scoping of pass 2 is
  precisely what hid these four.
