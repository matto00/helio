## Skeptic Report — design gate (round 8, skeptic-design-8.md)

### What I verified (with evidence)

**1. D8's four NEW rulings, against the shipped spec lines (read directly, `cat -n openspec/specs/...`).**

| Ruling | Cited line | Text actually at that line | Correct? |
| --- | --- | --- | --- |
| `cast.casts` | `pipeline-cast-op:35` | `#### Scenario: Empty casts map is a no-op` (:36-37 `casts: {}` -> output row identical to input) | YES |
| `rename.renames` | `pipeline-rename-op:25` | `#### Scenario: Empty renames map is a no-op` (:26-27) | YES |
| `filter.conditions` | `pipeline-filter-op:11` | requirement text "An empty `conditions` array SHALL pass all rows." + named scenario :13 | YES |
| `select.fields` | `pipeline-select-op:24` | `#### Scenario: Select with empty fields list produces empty rows` (:25-26 each output row is `{}`) | YES — and D8's characterisation as *behaviour-defining rather than a no-op* is right; :20 separately has a "Select all fields is a no-op" scenario about a *non-empty* list, which is a different claim |

Also re-checked the two round-5 rulings: `pipeline-limit-op:9` ("When `count` is missing, zero, or negative, the engine SHALL return all rows (safe no-op)") and `pipeline-sort-op:10` ("An empty `sortBy` array SHALL be treated as a no-op") — both exact.

**"No delta needed" for each** — correct, and I checked the mechanism rather than accepting the claim. The
runtime-completeness delta (`specs/pipeline-step-config-runtime-completeness/spec.md:11-15`) is scoped to "a step's
**required** configuration values". Classifying a field `optional-with-legitimate-default` therefore keeps it
entirely outside that requirement's reach, so no shipped guarantee is narrowed and no MODIFIED delta is owed.
D4's only limit-related rejection is a *non-representable* `count` (design D4; task 5.2), which the limit spec
never blesses. No conflict.

**2. Fourth vocabulary, run by me over all 21 `pipeline-*-op` specs** (deliberately disjoint from the three
already used — absence/optionality words rather than emptiness/no-op words):
`omitted|not provided|not supplied|not set|absent|unspecified|MAY be|empty string|blank|if no |when no |when there are no|without a |unconfigured|zero-length|nothing to`

**Not a null result.** It found four more config-level guarantees, one of which is in D8's own trap class:

- **`dedupe.keys` — `pipeline-dedupe-op:9`, `:52`, named scenarios `:59` and "Whole-row distinct".** THE FINDING.
  See Change Request 1.
- `unpivot.varName` / `unpivot.valueName` — `pipeline-unpivot-op:11-13` (defaults `"variable"`/`"value"`) plus
  named scenario `:39` "Default varName/valueName apply when omitted from config".
- `window.offset` — `pipeline-window-op:16` "`offset` (`Option[Int]`: used by `lag`/`lead`, defaulting to `1`
  when absent)"; and `window.field` — `:14-15` "required by `running_sum`/`lag`/`lead`, **ignored by the rank
  family**", i.e. *conditionally* required.
- `datebucket.outputColumn` — `pipeline-date-bucket-op:11` "an **optional** `outputColumn` (string; when absent,
  the op overwrites `field` in place)".

The last three are materially weaker than D8's six: each is declared optional in the spec *in the field
declaration itself* (`Option[...]`, "optional", "default `\"x\"`"), and none is the sole/principal config of its
kind, so task 1.1's heuristic is unlikely to mark them required. I report them as notes, not blockers.
`dedupe.keys` is different in kind — see below.

I checked `aggregate`'s `:47` "created with empty initial config" and it is NOT a fifth guarantee: it describes the
editor's initial draft config, which D2 keeps savable and D3 correctly fails at run. No delta owed there.

**3. Is 1.2b non-vacuous?** Yes. It demands two *recorded* columns per required field — a spec file+line whose
requirement text was read, and a conclusion — with a defined answer (`no governing statement` + the file checked)
for the null case, and task 1.3 escalating genuine ambiguity. An executor cannot satisfy it by asserting "I
checked the specs"; the artifact either has a citation column or it does not. One real residual: 1.2b only fires
for fields marked `required` in 1.1, so a field wrongly marked *optional* is never spec-checked. That direction
is safe (it under-hardens rather than contradicting a spec), so it is a note, not a defect.

**4. Cross-artifact contradictions.** I re-read ticket.md, proposal.md, design.md, tasks.md and all 8 deltas.
The D0/D6 supersession, the 3-of-5 count and its two guards, the D4 layer split, and the wrong-type/absence
boundary are stated consistently everywhere. One live contradiction remains — CR1 below — and it is *internal to
this change*: the change's own `pipeline-dedupe-op` delta restates a guarantee that D3, as currently scoped,
would break.

### Verdict: REFUTE

Narrow. One field, one artifact edit, no product decision reopened.

### Change Requests

1. **Add `dedupe.keys` to D8 as a seventh pre-settled `optional-with-legitimate-default` field, and to task
   1.2b's pre-settled list.**

   Ground truth, all read directly:
   - Shipped `openspec/specs/pipeline-dedupe-op/spec.md:9` — "When `keys` is empty, rows are compared as whole
     rows (every field/value pair)".
   - `:52` — "Leaving the key multi-select empty SHALL be a valid configuration (whole-row distinct)."
   - Named scenario `:59` "User leaves keys empty for whole-row distinct", and the execution scenario
     "Whole-row distinct" which runs `{"keys": [], "keep": "first"}` and asserts a specific non-identity output.
   - **This change's own delta**, `specs/pipeline-dedupe-op/spec.md:9`, restates that sentence verbatim in its
     MODIFIED requirement.

   `dedupe.keys` is squarely in the trap class D8 exists to disarm, by D8's own stated criterion: it is the
   *principal* config of its step kind ("dedupe does nothing without keys" reads true), so task 1.1's heuristic
   marks it `required`; and like `select.fields` its empty value is *behaviour-defining rather than a no-op*
   (empty = whole-row distinct, a different and fully specified algorithm — not a pass-through). If 1.1 marks it
   required, D3 fails the run for a `{"keys": []}` dedupe step that the shipped spec, a named UI requirement, a
   named UI scenario and an execution scenario all bless — and that this change's own delta re-asserts on the
   same page. That is the exact defect class D7/D8 were built to close, and it is currently a contradiction
   between two files of this change rather than only a latent execution risk.

   Note this was missed by all three enumeration passes for a structural reason worth recording alongside the
   fix: pass 3's pattern (`empty [^ ]* ?(list|array|map|object)|produces empty|is a no-op`) does not match
   "When `keys` **is** empty", because the spec puts the adjective after the noun. It is also the first hit found
   inside a spec the change is *already modifying*, which is why re-reading the deltas — not just
   `openspec/specs/` — is part of closing it.

   Required edits:
   - design.md D8: add the `dedupe.keys` bullet with the `pipeline-dedupe-op:9` / `:52` / `:59` citations, and
     state (as for `select.fields`) that the empty case is behaviour-defining, not a no-op.
   - design.md D8 "Why these six and not others": update the count and confirm the criterion still holds for
     seven.
   - tasks.md 1.2b: add `dedupe.keys` (`pipeline-dedupe-op:9`) to the pre-settled list, so the executor does not
     re-decide it.
   - `spec-tolerance-enumeration.md`: record a fourth pass (mine, vocabulary quoted above), its `dedupe.keys`
     finding, the three weaker finds in note 2 below, and why pass 3's pattern missed the adjective-after-noun
     form. Do NOT re-add any saturation claim — a fourth vocabulary finding a seventh field is further
     confirmation that the retraction was the honest call.
   - No MODIFIED delta is needed for `pipeline-dedupe-op` on this account: pinning `keys` optional preserves the
     guarantee exactly, same trade as the other six. The existing dedupe delta (about `keep`) stands unchanged.

### Non-blocking notes

- Consider recording `unpivot.varName`/`valueName`, `window.offset`, `window.field` and `datebucket.outputColumn`
  in the enumeration as *known-optional with a citation already in hand*, so 1.2b's per-field walk confirms
  rather than rediscovers them. Low risk either way — each is declared optional in its own field declaration.
- `window.field` is *conditionally* required (`pipeline-window-op:14-15` "ignored by the rank family"; `:49-50`
  "Running_sum without a field fails with a descriptive error"). Task 4.1 evaluates the requiredness predicate
  against the whole raw config string, so a per-kind predicate CAN express this — but the tasks describe "a
  single per-step declaration of required *fields*", which reads flat. Worth one sentence in 4.1 confirming the
  declaration may be config-dependent, so the executor does not flatten `window.field` to unconditionally
  required and break `row_number`. Same shape applies to `fillnull` (`pipeline-fillnull-op:26` "Constant strategy
  without a value fails" — required only under the constant strategy).
- 1.2b's asymmetry (only `required`-marked fields get a spec citation) is acceptable, but a one-line note that a
  field marked optional is deliberately unchecked because that direction under-hardens rather than contradicting
  a spec would make the choice legible to a reader.
