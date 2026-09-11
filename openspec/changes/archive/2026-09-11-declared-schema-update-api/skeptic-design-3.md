## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed cold at `HEAD = 4e313d49b83fed424217cbb7d44b87fab4e2b754` (change dir still untracked:
`?? openspec/changes/declared-schema-update-api/`). Every finding below was re-derived this round from
the current artifacts and from `DatasetRowValidator.scala` read in full, not from round 1's or round 2's
narrative.

### What I verified (with evidence)

Round-2's four items, re-derived rather than taken on the revision's word:

1. **CR1 (required-tightening unclassified) — PARTIALLY resolved.** design.md:94-105 now carries an
   explicit "Kept, same type, `required` TIGHTENED (`false`->`true`) on a NON-EMPTY dataset" case with
   the backfill-or-`409` rule; spec.md:90-111 adds the matching requirement + three scenarios;
   tasks.md 4.2b tests all three. For the *same-type* tightening the 500-instead-of-409 hole is
   genuinely closed. But the case is scoped by its own wording to `same type`, which re-opens the
   identical hole for the simultaneous retype+tighten edit — the very interaction round 2's CR1
   closing sentence called out. See CR1 below.
2. **CR2 (Step A self-contradiction) — RESOLVED.** design.md:73-78 now reads "with **no exception**"
   and "**a rename TO a name that is simultaneously being dropped is ALWAYS a `400`**"; the
   "unless one of them is being dropped" carve-out is gone. spec.md:35-40 agrees ("unconditionally, in
   every case"). Verified the two documents no longer disagree. (Note: the strict-injection rule alone
   does NOT decide this case — for old `{X,Y}` with new `[Y previousName=X]` and `Y` dropped, `X->Y` is
   a perfectly good injection — so it is the explicit unconditional sentence, not the injection
   formulation, that is load-bearing here. It is present and unambiguous, so the rule is decided.)
3. **CR3 (`rowsMigrated` double definition) — resolved for retype, broken for the NEW case.**
   design.md:186-194 now pins one definition ("stored `JsArray` CONTENT OR POSITIONAL ORDER actually
   changed") and spec.md:143-147 now says `rowsMigrated: 0` for a successful retype, matching
   tasks.md 4.13. The retype contradiction is gone. But the same sentence's enumeration contradicts
   the revision's own new tightening rule — see CR2 below.
4. **CR4 (which vector is persisted) — RESOLVED.** design.md:210-223 is now explicit that Decision 8 is
   "PASS/FAIL-ONLY", that `Right` means "write Step D's ORIGINAL `migratedRows` unchanged, discarding
   `validate`'s own returned vector entirely". Confirmed against live source that this was a real
   hazard: `DatasetRowValidator.validate` (line 104-115) returns `Right(perRow.map(...))` whose cells
   come from `validateRow`, which at lines 130-131 substitutes `field.default` for a `JsNull` cell.
   spec.md:188-205 and tasks.md 4.12(b) both carry the no-silent-backfill invariant. Resolved.

Independent checks this round:

- Re-derived Step C's case list against the full cross-product of (kept/added/dropped) x (`required`
  unchanged/loosened/tightened) x (type same/differs) x (`default` unchanged/added/removed) x (empty/
  non-empty). The bullets key on **type** and **required** only; **`default`** is never a
  classification axis, and the tightening bullet is type-gated. Two cells are uncovered — CR1 below.
- Re-read `validateRow` (lines 117-142) to confirm the failure mode: `raw == JsNull` -> `missing` ->
  `field.default` `Some(d)` returns `Right(d)`, else `required` -> `Left(FieldError(name, "required"))`
  (line 133). That `Left` is what Decision 8 maps to `500`.
- Confirmed `validateDefault` (line 83) does exist and does what Decision 3/tasks 2.2 claim (returns
  `Right(())` for `None` and for `Some(JsNull)`), so the "invalid default rejected even on an empty
  dataset" requirement is implementable as written.
- Checked the 400/409/500 split and its precedence (tasks.md 2.1(a) — structural before
  data-integrity) still holds; it does, and is coherent.

### Verdict: REFUTE

Round 2's items 2 and 4 are properly fixed, and item 1's same-type case is fixed. But the fix for
item 1 was written narrowly enough that the exact interaction round 2 flagged in its own closing
sentence is still undefined, and it lands on the same unactionable `500`. The new case also breaks the
single `rowsMigrated` definition that round 2's item 3 existed to establish. Both are cheap to fix in
prose now and expensive to discover in an execution cycle.

### Change Requests

1. **A field that is SIMULTANEOUSLY retyped and tightened to `required` is still unclassified, and
   still lands on a `500`.** design.md:94 scopes the new case to "Kept, **same type**, `required`
   TIGHTENED". A field whose `fieldType` also differs therefore does not match it, and falls solely
   under "Kept, retyped" (design.md:106-116) — which explicitly **exempts** `JsNull`/absent values from
   its check ("either `JsNull`/absent (treated as 'missing', exempt)") and carries the value over
   unchanged. So: field `age`, `integer`, `required: false`, some rows `JsNull`; caller submits `age`,
   `string`, `required: true`, no `default`. Step C admits it (the retype bullet's null exemption
   passes), Step D copies the `JsNull` across, Decision 8's `validate` hits `validateRow` line 133 and
   returns `Left(FieldError("age", "required"))`, and Decision 8 maps that to
   `500`/`ServiceError.Internal` — the precise outcome round-2 CR1 was raised to eliminate, for an
   ordinary caller error that the rubric says should be a `409`. Round 2's CR1 named this explicitly
   ("a field that is simultaneously retyped and tightened must satisfy both"); the revision did not
   cover it.
   **Required:** make Step C's classification exhaustive over the (type, `required`, `default`) triple
   rather than a list of prose archetypes. Minimum: (a) restate the tightening rule as an axis that
   applies to a kept field **whether or not it is also retyped** — i.e. a kept field is subject to BOTH
   the retype check (when the type differs) AND the tightening check (when `required` goes
   `false`->`true`), and both must pass; (b) state the interaction of the retype null-exemption with
   tightening explicitly (a `JsNull` exempt from the retype check is still subject to the tightening
   default-or-`409` rule); (c) add a matching spec.md scenario and a tasks.md test for
   retype+tighten-with-nulls, both with a `default` (200, nulls backfilled) and without (409, **not**
   500).

2. **A kept field whose `default` is removed or changed is also unclassified, and is the same `500`.**
   `default` appears nowhere in Step C as a classification axis for a KEPT field — only for added
   fields (design.md:117-126) and inside the tightening bullet. But the request is a full replacement
   declaration (proposal.md:52-53), so a caller can resubmit a field with identical `name`, type and
   `required: true` while **omitting** the `default` that previously existed. That matches bullet 1
   ("`required` unchanged ... always allowed at any row count", design.md:91-93). If any stored cell in
   that column is `JsNull` — a state this very feature can create, since the retype bullet deliberately
   carries pre-existing `JsNull`s through untouched — Step D copies the null, and Decision 8's
   `validate` fails `required` at line 133 -> `500` again.
   **Required:** classify `default` removal/change on a kept field explicitly (the natural rule,
   symmetric with CR1: removing the `default` from a kept `required` field is allowed only if no row
   holds `JsNull`/absent in that column, else `409` naming the field and the offending row count), with
   a spec requirement/scenario and a test task.

3. **The newly-added tightening case contradicts Decision 6's single `rowsMigrated` definition.**
   design.md:186-188 defines `rowsMigrated` as "the number of existing rows whose stored `JsArray`
   CONTENT OR POSITIONAL ORDER actually changed", then at 193-194 enumerates "the full row count for
   add/drop/**required-tightened-with-default**". But Decision 2's own tightening rule (design.md:
   100-103) backfills the default **only** into "every row whose OLD value was `JsNull`/absent",
   carrying "every other row's value over unchanged". When only some rows are null, the number of rows
   whose content changed is the **null-row count**, not the full row count — the definition and the
   enumeration give different answers for the same edit. tasks.md 4.13 repeats the wrong enumeration
   ("full row count for ... required-tightened-with-default"); spec.md:102-106's scenario pins no
   number at all, so the binding delta does not settle it either. This is the same class of defect as
   round-2 CR3, re-introduced by the CR1 fix, in the number the ticket calls out as what HEL-1079's UI
   renders.
   **Required:** make the enumeration consistent with the definition — for required-tightening, state
   `rowsMigrated` = the count of rows actually backfilled (`0` when every value was already present,
   matching spec.md:97-100's "no row is modified"), and correct tasks.md 4.13 accordingly; add the
   number to spec.md's two tightening success scenarios so the delta is self-contained.

### Non-blocking notes

- **Decision 8's safety net is structurally blind on any defaulted column.** Because `validateRow`
  substitutes `field.default` for a `JsNull` (line 130-131) *before* deciding, `validate` returns
  `Right` for a row holding `JsNull` in a `required` field **that has a default** — while Decision 8
  then persists Step D's own (un-substituted) row, i.e. a stored `JsNull` under a `required`
  declaration. It round-trips benignly today (every later read substitutes the default again), so this
  is not a blocker, but Decision 8's claim to enforce "no row may violate its declaration" is weaker
  than it reads. Worth one sentence stating the limit honestly.
- design.md:74-78 still contains round-2 CR2's unparseable clause ("a `previousName` also equals
  another payload field's plain `name` with no `previousName` of its own targeting a different old
  field"). It is now harmless — the unconditional-400 sentence beside it decides the case — but it is
  not a decision procedure and should simply be deleted, or replaced with round 2's suggested
  index-mapping formulation.
- tasks.md 4.10 still does not test round-1 CR4(f) (a `previousName` target that is also another
  payload field's plain `name`), as round 2's notes observed.
- Decision 9 continues to refuse to harden the `V107` number. Still correct.
- The index-mapping reframe (Steps A-D) remains the right model for a positional `JsArray` store; none
  of the above disturbs it. All three CRs are prose/classification completions, not a redesign.
