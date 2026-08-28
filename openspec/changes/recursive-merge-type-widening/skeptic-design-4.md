## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Cold read. Every statement below is derived from files in the worktree
(`/home/matt/Development/helio/.claude/worktrees/bug/recursive-merge-type-widening/HEL-858`,
HEAD = `7972247c`), not from prior reports' narratives.

### What I verified (with evidence)

1. **The round-3 blocking CR is resolved.** `proposal.md:27-32` now reads: "One change also
   reaches single-shape sources and must not be understated: today a single `JsNull` anywhere
   in a sampled column forces it to `StringType`, so any column with a null re-infers as a
   nullable numeric/boolean/timestamp instead. That is a NARROWING, it is deliberate (design D7)".
   The offending "existing single-shape sources infer exactly as before" sentence is gone
   (`grep -niE "as before|unaffected|single-shape|existing sources"` over all four artifacts +
   the spec delta returns only: `design.md:44,98`, `proposal.md:28,41`, `tasks.md:64`,
   `ticket.md:50` — each checked below, none asserts unaffectedness).

2. **The revision agrees with every other artifact.**
   - vs **D7** (`design.md:89-109`): same direction (`String → Integer`), same word
     ("NARROWING"), same scope claim ("applies to single-shape sources too"), same
     mitigation ("No persisted DataType is rewritten… the flip occurs only when a source is
     re-inferred"). No drift.
   - vs **Risks** (`design.md:154-157`): "Re-inference CAN narrow a column… a panel bound to
     such a column expecting a string is the real exposure" — verbatim-equivalent framing to
     the new proposal text.
   - vs **spec delta null scenarios**: `spec.md:95-97` (null + `2.5` ⇒ `FloatType`, nullable),
     `spec.md:99-102` (null + `7` ⇒ `IntegerType` nullable, "AND it is NOT inferred as
     `StringType`, which is what the presence of a single null previously forced"),
     `spec.md:104-106` (all-null ⇒ nullable `StringType`). All three consistent with the
     proposal and with D3's "`JsNull` never participates".
   - vs **task 3.10** (`tasks.md:79-83`): requires reporting any `string → numeric` flip on the
     WR fixture and forbids classifying it as widening — exactly the exposure the proposal now
     names. Consistent.
   - **No new contradiction introduced**: `proposal.md:41` ("re-inference of existing sources")
     is a non-goal about *not triggering* re-inference, not a claim of unchanged inference;
     `ticket.md:50` (AC5, "Nullability behaviour is unchanged") is about the nullable *flag*,
     which D2/D7 do preserve (a null-bearing column stays `nullable = true`; only its type
     changes). That is a real distinction, not a fudge.

3. **Ground truth for D7's premise.** Read
   `backend/src/main/scala/com/helio/domain/engine/SchemaInferenceEngine.scala:81-97`. The
   second fold (`if (v == JsNull) m.updated(k, JsNull)`) plus
   `inferJsonType(JsNull) => (StringType, true)` (line ~112) confirm today's behaviour exactly as
   D7 and the proposal describe it. `case Some(_) => m` (first-value-wins) and the top-level-only
   fold are also as described. D7 is not a hallucination.

4. **Spot-check of what round 3 certified (not inherited).**
   - **Task 3.4 mechanically buildable**: `SparkJobSubmitter.scala:237` really is
     `case (JsNumber(n), IntegerType) => n.toInt`; `sparkDataType` (line 223) maps the wire
     strings `"integer"`/`"float"`; `model.scala:599/611` provides the
     `DataFieldType ⇄ "float"` wire mapping the task needs to feed an inferred type into a
     `StaticSource`; `SparkJobSubmitterSpec.scala:37,54,81-87` already constructs
     `new SparkJobSubmitter("local[*]", …)` and drives `loadDataFrame` over a `StaticSource`
     built from `{columns, rows}`. The task's chain is constructible as written.
   - **3.3 / 3.3b partition**: 3.3's clauses (null+fractional ⇒ nullable float; null+integral ⇒
     nullable integer) are genuinely red pre-fix given the null-overwrite pass above; the
     all-null clause is genuinely green pre-fix (`inferJsonType(JsNull)`), and is correctly split
     into the [CHAR] 3.3b. Assignment is right.
   - **3.8a / 3.8b partition**: 3.8a's inputs (single-shape rows, dotted/unicode/empty keys,
     depth bound, non-object elements, within-object collision) all satisfy subset+union pre-fix
     because pre-fix top-level union is sufficient when shapes match; 3.8b's inputs
     (heterogeneous nested shapes, cross-row leaf-vs-subtree) fail both clauses pre-fix. Correct
     assignment.
   - **AC traceability**: AC1→3.2, AC2→3.1, AC3→3.3+3.4, AC4→2.1+3.9, AC5→3.5. Every AC lands on
     a task; no task is outside the ticket's scope.

5. **Would an executor following tasks.md verbatim produce the right diff and conclusive
   evidence?** Yes. Tasks 1.1-1.6 fully determine the code shape (join definition, accumulator,
   single code path, `mergeObjects` deletion, the two dangling prose refs, and an explicit
   "don't touch `JsonFlattener`" tripwire). Evidence is conclusive rather than decorative
   because: the RED/CHAR split is per-test and pre-committed (3.x headers), 3.11 requires an
   *actual* revert transcript matching that split exactly, 3.9 asserts fixture adequacy in code
   rather than by checksum attestation, and 3.4 forbids the hand-declared-type variant that
   would be green on revert. These are precisely the "evidence-shaped non-evidence" traps this
   ticket's own history (HEL-599) produced.

### Verdict: CONFIRM

### Non-blocking notes

- `proposal.md:18` says the lattice is "reconciled with the widening order the CSV path already
  uses", which a fast reader could take as "consistent with CSV". D3 (`design.md:57-67`) and the
  spec delta (`spec.md:69`) are normatively the opposite — a deliberate divergence. Not blocking
  (the same bullet then states the JSON rules explicitly, and the binding text is the spec), but
  "reconciled against" → "deliberately diverging from" would remove the last soft spot.
- Environmental, for the orchestrator: this worktree's `scripts/concertino/` contains only
  `assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`, `start-servers.sh`, `lib`, `README.md` —
  there is no `next-report-number.sh`, `persist-evidence.sh` or `emit-event.sh`. The report
  filename here is unambiguous by inspection (`skeptic-design-1..3.md` exist), so no collision
  risk, but the persist/emit steps cannot be run from this worktree.
