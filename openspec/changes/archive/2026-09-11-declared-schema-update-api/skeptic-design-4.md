## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed cold at `HEAD = 4e313d49b83fed424217cbb7d44b87fab4e2b754`. Every finding below was re-derived
this round from the current artifacts and from `DatasetRowValidator.scala` read in full — not from
rounds 1-3's narrative and not from the orchestrator's description of what the revision does.

### What I verified (with evidence)

**Step C's new general algorithm, re-derived against the full cross-product.** I enumerated
(kept / added / dropped) x (type same / changed) x (`required` unchanged / loosened / tightened) x
(`default` absent / present-unchanged / added / removed) x (empty / non-empty). The three-step
algorithm at design.md:99-127 does close round 3's two enumeration gaps:

- Retype + required-tightening on the same field (round-3 CR1): step 1 runs the retype check first and
  rejects the field outright on failure; step 2's `required` check then runs against whatever candidate
  step 1 produced. Well-defined. spec.md:156-161 and tasks.md 4.2c match.
- Kept `required: true` field with its `default` removed, rows null (round-3 CR2): step 2 is no longer
  gated on the field being added or type-unchanged, so this now reaches the same `required` check and
  yields `409` rather than falling through to Decision 8's `500`. tasks.md 4.2d matches.

Confirmed against live source that the pieces the algorithm leans on behave as claimed:
`validateValue` (`DatasetRowValidator.scala:62-77`) is a pure predicate, no conversion; `validateRow`
(117-142) treats `raw == JsNull` as missing, substitutes `field.default` at 130-131 *before* the
`required` decision at 133; `validateDefault` (83-92) returns `Right(())` for `None` and for
`Some(JsNull)`, so Decision 3's `Option[Option[JsValue]]` idiom and the "explicit null default does not
satisfy `required`" rule are both implementable as written.

**`rowsMigrated`'s new operational definition — checked against every scenario in spec.md.** Decision 6
(design.md:196-206) and spec.md:163-180 agree, and I found no scenario they contradict: empty dataset
`0` (row count is 0, so "full row count" and "0" coincide — consistent, not a special case);
rename-only `0` (spec.md:66, tasks.md 4.3); reorder full count (spec.md:72); retype full count even
where no value changed (spec.md:146-149, tasks.md 4.13); add-required-with-default full count
(spec.md:126); confirmed drop full count (spec.md:198). The round-3 self-contradiction is genuinely
gone, and the definition is checkable from the declaration diff alone. **This item is resolved** —
subject only to CR2 below, which is a consequence of CR1 rather than a defect in the definition itself.

**Stale enumerated-bullets language elsewhere.** tasks.md 2.1(c) and 4.2b/4.2c/4.2d are written in the
one-general-algorithm frame and explicitly warn the implementer off re-splitting it into branches.
proposal.md's edit-kind list (lines 15-19) is an outcome summary, not an algorithm, and does not
conflict. ticket.md's policy table still says retype succeeds "if every existing value **converts**
under `DatasetRowValidator`'s coercion rules" — stale and factually wrong (no coercion exists), but
ticket.md is the input artifact, and design.md Risk 1 + spec.md:128-135 correct it explicitly. Not a
blocker.

### Verdict: REFUTE

Round 3's three CRs are all addressed. But the mechanism used to address them — making step 2's
`default` substitution **unconditional** over every field — introduced a new contradiction with an
invariant that three prior rounds established and that Decision 8 exists specifically to protect. This
is not a re-litigation of round 3's items; it is a new defect created by round 4's fix, in the same
"one document's rule silently overrides another's" class.

### Change Requests

1. **Step C's step 2 backfills defaults into cells that the rename/retype-only requirements
   guarantee are left untouched — the design now violates its own no-silent-backfill invariant, in
   Step C rather than in Decision 8.** design.md:118-122 says: "for every row whose candidate (from
   step 1) is `JsNull`/absent, if the NEW field declaration supplies a `default` (outer `Some` …),
   replace the candidate with that default". The request is a **full replacement** declaration
   (proposal.md:52-53), so a caller performing a pure rename resubmits every other field exactly as it
   stands — including its existing `default`, which therefore arrives as outer `Some`. Step 2 is gated
   on nothing else: not on the field being added, not on `required` having changed, not on `default`
   having changed. So for a field that already has a `default` and already holds a pre-existing
   `JsNull` in some row, a **rename-only or retype-only edit silently rewrites that cell to the
   default**. That directly contradicts:
   - spec.md:58-68 ("Rename and reorder never modify row data" … "every existing row's stored values
     are unchanged (rename is metadata-only)");
   - spec.md:229-233 ("A successful rename/retype-only edit never backfills an untouched null cell" …
     "**THEN** that cell remains `null`/absent after the edit");
   - design.md:228-233, Decision 8's own stated rationale — "persisting its `Right` output here would
     silently backfill defaults into rows that Step D never intended to touch (e.g. a pure rename, or
     a retype that deliberately carries a pre-existing `JsNull` through untouched)". Decision 8 forbids
     `validate`'s vector from doing exactly what Step C now does itself, which makes the whole
     PASS/FAIL-only precaution pointless for this case: the backfilled value is now in Step D's own
     output, so persisting "Step D's ORIGINAL `migratedRows`" persists the backfill anyway;
   - tasks.md 4.12(b), which asserts the persisted rows contain no such backfill — and therefore
     contradicts tasks.md 2.1(c), which instructs the implementer to "uniformly apply
     `default`/`required` to whatever candidate resulted". As written, an implementer following 2.1(c)
     produces code that fails 4.12(b).

   This is not a misreading of ambiguous prose: design.md:270-272 (the new Risks note) states the same
   reading as fact — "Step C's own algorithm already backfills defaults into the candidate before Step
   D ever builds the row". The uniformity that fixed round 3's gaps was bought by deleting a condition
   that was load-bearing.

   **Required:** decide, and state in design.md, which invariant wins, then make all four artifacts
   agree. The minimal fix that preserves round 4's "no case enumeration" property is to keep step 2 a
   single uniform rule but give it the one predicate it needs: substitute the `default` into a
   `JsNull`/absent candidate **only when the field's own declaration actually changed in a way that
   requires it** — concretely, when the field is ADDED, or its `required` went `false`->`true`, or its
   `default` changed/was removed; a field whose type/`required`/`default` are all unchanged carries its
   `JsNull` through untouched. (This stays one rule over one predicate, not a return to per-archetype
   bullets.) The `required` enforcement in step 2's second half should remain unconditional, so the
   4.2d case still yields `409`. If instead the decision is that backfilling is acceptable, then
   spec.md:58-68, spec.md:229-233, design.md Decision 8's rationale and tasks.md 4.12(b) must all be
   rewritten — but note that choice also makes "rename is metadata-only" false, which is the property
   the positional-index-mapping model was adopted to guarantee.

2. **`rowsMigrated: 0` for a pure rename becomes false under CR1's current wording.** Decision 6
   (design.md:198-202) and spec.md:171-174 pin `rowsMigrated: 0` for a rename-only edit on the grounds
   that nothing about the rows changes. But per CR1, a rename-only edit on a defaulted column with
   stored nulls *does* change those rows. The operational definition itself is sound and I am not
   asking for it to be reopened — it just has to be re-checked once CR1 is resolved. **Required:** if
   CR1 is resolved by gating the substitution (the recommended fix), state explicitly in Decision 6
   that a pure rename provably modifies no row and `0` is therefore truthful; if CR1 is resolved by
   accepting the backfill, `rowsMigrated: 0` for rename-only is wrong and must change, along with
   tasks.md 4.3 and 4.13.

3. **Add the test that would have caught CR1.** tasks.md 4.12(b) tests the Decision 8 half of this
   invariant (the `validate`-return-vector half) but nothing tests the Step C half. **Required:** add a
   task — a rename-only (and a retype-only) edit on a **non-empty dataset whose affected column both
   has a `default` and contains a pre-existing `JsNull`**, asserting that cell is still `null` after a
   `200`, and that `rowsMigrated` matches whatever CR2 settles. Without it, the same defect is
   invisible to the suite regardless of which way CR1 is decided.

### Non-blocking notes

- design.md:74-78 still contains round-2 CR2's unparseable clause ("a `previousName` also equals
  another payload field's plain `name` with no `previousName` of its own targeting a different old
  field"). Harmless — the unconditional-`400` sentence beside it decides the case — but it is still not
  a decision procedure. Third round it has been flagged; delete it or replace it with the
  index-mapping formulation.
- tasks.md 4.10 still does not test round-1 CR4(f) (a `previousName` target that is also another
  payload field's plain `name`). Flagged in rounds 2 and 3; still absent.
- ticket.md's policy table's "converts under `DatasetRowValidator`'s coercion rules" is factually
  wrong against live source (no coercion table exists anywhere). design.md/spec.md correct it, so this
  is not blocking, but it is worth one correcting line in the ticket so HEL-1079 does not inherit the
  wrong expectation.
- The Steps A-D index-mapping model remains the right frame for a positional `JsArray` store, and the
  round-4 move from enumerated archetypes to one algorithm is the right direction. CR1 is a missing
  predicate inside that algorithm, not a reason to go back to enumeration.
- Decision 9 continues to refuse to harden the `V107` number. Still correct.
