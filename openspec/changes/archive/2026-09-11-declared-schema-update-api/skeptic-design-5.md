## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed cold at `HEAD = 4e313d49b83fed424217cbb7d44b87fab4e2b754`. Every conclusion below was
re-derived this round from the artifacts as they now stand and from live source read directly. I did
not take the orchestrator's description of the round-5 fix as fact — in particular I independently
tested its assertion that "a retyped-but-otherwise-unchanged field must be treated as touched" rather
than assuming it.

### What I verified (with evidence)

**Step C re-derived end-to-end, against the full cross-product.** I re-enumerated
(added / kept / dropped) x (type same / changed) x (`required` unchanged / tightened / loosened) x
(`default` absent / resubmitted-unchanged / changed / removed) x (empty / non-empty) x (cell null /
non-null) against design.md:99-152.

- **Step 1 (candidate + retype validation)** is independent of the touched gate and runs for every
  NEW field: added -> `JsNull`; kept same-type -> value carried verbatim; kept retyped -> nulls exempt,
  present values must satisfy `validateValue(newType, _)`, field rejected `409` on any failure with
  step 2 skipped. Confirmed against live source that this is implementable exactly as written:
  `DatasetRowValidator.validateValue` (`DatasetRowValidator.scala:62-77`) is a pure
  `Either[String, Unit]` predicate with no conversion anywhere; `validateDefault` (83-92) returns
  `Right(())` for both `None` and `Some(JsNull)`, which is what makes Decision 3's
  `Option[Option[JsValue]]` idiom and the "an explicit-null default does not satisfy `required`" rule
  both expressible.
- **"Touched" is well-defined for an ADDED field.** design.md:122-127 defines it as
  `ADDED OR fieldType changed OR required differs OR default differs` — a disjunction whose first
  clause short-circuits, so no added field is ever compared against a nonexistent old declaration
  value. There is no path that dereferences a mapped index for an added field. Correct as the
  orchestrator described.
- **A retyped-but-otherwise-unchanged field IS treated as touched**, per the `fieldType changed`
  clause. I checked whether that is actually *required* rather than merely asserted: it is not needed
  for retype validation (step 1 runs regardless of touched), so its only effect is to allow default
  substitution into that field's own pre-existing nulls. That is a defensible product call — the
  caller is explicitly editing that field — and, critically, it does **not** contradict the spec: the
  new spec requirement's scenarios (spec.md:88-91) and tasks.md 4.2e both scope the no-backfill
  guarantee to a **different, untouched field** in a retype-only request, never to the retyped field
  itself. Decision 6's `rowsMigrated` is also unaffected (a retype always reports the full row count,
  spec.md:162-168). So the two readings do not collide anywhere that matters.
- **Round 4's actual defect is closed.** Untouched kept field (same index or reordered, same type,
  same `required`, same `default` resubmitted): step 2 is skipped entirely, so a pre-existing `JsNull`
  survives a rename-only, reorder-only, or other-field-retype-only edit. This is what spec.md:74-91
  now requires and tasks.md 4.2e now tests. Rounds 1-3's other properties survive the gate: 4.2b
  (required tightened -> `required` differs -> touched -> checked), 4.2c (retype + tighten -> touched
  twice over), 4.2d (`default` removed -> differs -> touched -> `409`, not a fall-through) all still
  reach step 2. I found no combination where the gate suppresses a check that a prior round required.
- **No new `500` path is introduced by the gate.** The only way an untouched field could now carry an
  un-backfilled null into Decision 8 is `required: true` with a `default` — and
  `validateRow` (117-142) substitutes `field.default` at 130-131 *before* the `required` decision at
  133, so it returns `Right` and the transaction proceeds, persisting Step D's own (still-null) row as
  Decision 8 demands. The `required: true` + `default: None` + stored-null combination is unreachable,
  since every prior write went through the same `validateRow`.

**`rowsMigrated` re-checked under the gate (round-4 CR2).** Decision 6 (design.md:206-225) and
spec.md:182-199 agree, and the `0`-for-pure-rename claim is now *provably* truthful rather than
merely asserted: a pure rename leaves every field untouched by the gate's own definition (same index,
type, `required`, `default`), so step 2 never runs and no cell can change. Reorder/retype/add/drop/
required-or-default change all report the full row count. No scenario contradicts it.

**Remaining items from the prompt's final-pass list.** RLS: tasks.md 6.1 carries the full (a)/(b)/(c)
structure plus the byte-identical assertion, matching spec.md:18-23; I confirmed
`RlsOwnerTablesSpec.scala` is the genuine non-superuser harness it is claimed to be (`helio_app_test`
non-superuser app pool vs. a `helio_privileged` BYPASSRLS pool wired via `setConnectionInitSql`, lines
36-87) and that its `listRows` block (570-628) really does establish the (a)/(b)/(c)+ shape being
reused. Response shape: verified `DatasetFieldResponse`/`DatasetSchemaResponse` at
`DataSourceProtocol.scala:315-316` with `jsonFormat1` at 646, and that tasks.md 1.1 adds a new,
distinct `DatasetSchemaUpdateResponse` while explicitly forbidding any edit to `DatasetSchemaResponse`
— consistent with Decision 6. The `GET .../schema` path this route sits alongside exists at
`DataSourceRoutes.scala:115`. Structural `400` rules (Step A / spec.md:25-40 / tasks.md 4.10) are
unchanged by the round-5 edit and remain internally consistent.

**Stale-language sweep.** I grepped all four artifacts for the round-4 "unconditional/uniform"
framing. Every surviving instance is either about a different rule entirely (drop-confirmation,
rename-collision `400`, tighten-to-required) or is the algorithm's "one algorithm for every field"
framing, which is still accurate — the gate narrows step 2, it does not re-split Step C into
per-archetype branches. tasks.md 2.1(c) carries the gate and marks it "required, not optional";
proposal.md's edit-kind list is an outcome summary that does not conflict. I found no artifact
asserting the pre-round-5 unconditional-substitution rule.

### Verdict: CONFIRM

The round-4 defect is genuinely fixed, the fix does not break any property rounds 1-3 established,
"touched" is well-defined for every field kind including added and retyped, and the four artifacts
agree on the normative rule. The items below are documentation-accuracy nits inside non-normative
prose; none of them can mislead an implementer who follows the explicit definition at
design.md:122-132, and none is worth burning the escalation.

### Non-blocking notes

- design.md:130-132's explanatory sentence ("a retype where `required`/`default` are both resubmitted
  unchanged, leave every untouched cell alone") reads, in isolation, as though the *retyped* field's
  own null is protected — which the touched definition four lines above contradicts. The normative
  definition governs and spec.md:88-91 scopes the guarantee correctly to a different field, so this is
  loose prose, not a rule conflict. Worth rewording to "…and a retype-only edit, leave every *other*
  field's cells alone".
- design.md's Risks bullet at 280-292 is now stale in its *reasoning*: it argues Decision 8's blind
  spot is benign "because Step C's own algorithm already backfills defaults into the candidate before
  Step D ever builds the row". After the gate, an untouched `required`-with-`default` column can reach
  Decision 8 with an un-backfilled null **without any bug**. The bullet's conclusion (benign) still
  holds — and `validateRow`'s pre-substitution is now load-bearing, since it is what stops that
  legitimate case from becoming a spurious `500`. Worth restating on that footing.
- `required: Option[Boolean]`'s absent-semantics are never pinned. Under full-replacement semantics
  absent should mean `false`, but an implementer could read it as "unchanged", which diverges for a
  loosening-by-omission edit (touched vs. untouched, hence backfill vs. not). Both readings produce a
  declaration-satisfying result, so this is not a corruption path — but one clause in tasks.md 1.1
  would remove the guess. (Contrast `default`, whose absent-vs-null ambiguity Decision 3 pins
  deliberately.)
- Round-4 CR2 asked for an explicit sentence in Decision 6 stating that a pure rename provably
  modifies no row. The property now holds by construction but the sentence was not added. Cosmetic.
- Carried forward, still unaddressed after three rounds of flagging, still non-blocking: design.md:
  74-78's unparseable clause (the adjacent unconditional-`400` sentence decides the case); tasks.md
  4.10's missing round-1 CR4(f) case (a `previousName` target that is also another payload field's
  plain `name`); ticket.md's policy table saying retype succeeds when values "convert under
  `DatasetRowValidator`'s coercion rules", which is factually wrong against live source — design.md
  Risk 1 and spec.md:147-154 correct it, but HEL-1079 reads the ticket.
