## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec deltas
  (`specs/output-panel-placement/spec.md`, `specs/output-panel-controls-editor/spec.md`) in full.
- Read the actual shipped `backend/src/main/scala/com/helio/services/pipelines/OutputFilterCapability.scala`
  (HEL-1188) to check design.md D3's eligibility derivation against real code, not the driver's
  paraphrase. Confirmed: `staticOperatorsFor` gives `Contains` alone for `StringType`/`BooleanType`,
  `Contains+Gte+Lte` for `IntegerType`/`FloatType`/`TimestampType`; `Eq`/`In` is a separate
  cardinality gate (`MaxDropdownCardinality=50`) applied to any Structured column regardless of
  type. design.md D3's stated rule (`text` iff `Contains`; `dropdown` iff `Eq+In` any type;
  `numeric-range` iff `Gte+Lte` + type ∈ {integer,float}; `date-range` iff `Gte+Lte` + type =
  timestamp) is correctly derived from this, not a naive type→kind table. **Sound.**
- Read `backend/src/main/scala/com/helio/services/panels/PanelService.scala` (`update`,
  `rejectInconsistentForm`, `effectiveFormConfig`) and
  `backend/src/main/scala/com/helio/domain/panels/FormSchemaConsistency.scala` — the exact
  precedent design.md D4 claims to mirror. Confirmed `rejectInconsistentForm` re-validates the
  **entire** effective field list unconditionally whenever `configPatch` is present at all, not
  just the fields actually touched by that patch — there is no existing "skip unchanged entries"
  behavior in this codebase to fall back on by convention.
- Read `backend/src/main/scala/com/helio/domain/panels/OutputPanel.scala` — confirms `Patch`/
  `applyPatch` follows the same whole-field-replace shape, so a `controls` patch field would
  behave the same way (effective list = patch value if present, else existing list unchanged).
- Read `backend/src/main/scala/com/helio/domain/panels/FormPanel.scala`'s `FormFieldSpec` — closed
  `AllowedKeys`, strict decode, raw-`JsValue` `initialValue`/`options`. Confirms D2's claimed
  precedent for `OutputControlSpec` is real and reasonably apt (variable-length, kind-discriminated,
  closed-key list; `id`-per-entry is a genuine, justified departure since `column` is not unique
  here, unlike `sourceField`).
- Confirmed migration numbering: `ls backend/src/main/resources/db/migration/` → highest is `V111`,
  so `V112` is free, matching ticket.md's driver note and design.md's Migration Plan. Read
  `V108__*.sql` and confirmed the `NO FORCE`/`FORCE ROW LEVEL SECURITY` bracket precedent design.md
  D1 cites is real.
- Confirmed `openspec validate output-panel-control-config --type change` passes (`Change
  'output-panel-control-config' is valid`, re-run myself, not taken on faith).
- Confirmed `schemas/panels/*.schema.json` files tasks.md 2.3 names actually exist at those paths.
- Confirmed no requirement-title collision between the new spec deltas and the existing baseline
  `openspec/specs/output-panel-placement/spec.md` (6 existing requirement headers, none overlapping
  the 3 new ones).

### Verdict: REFUTE

### Change Requests

1. **Blocking internal contradiction: does an orphaned control block unrelated future saves, or not?**
   `design.md` D4 says server validation is "re-run on every write... into the PATCH path... no
   cached/skip-on-unchanged shortcut," explicitly mirroring `rejectInconsistentForm`, which (per the
   code I read) re-validates the **whole** effective config unconditionally whenever `configPatch`
   is present — not just the entries the patch actually touches. Applied literally to controls, this
   means: once any control on the panel drifts into ineligibility (e.g. its column's cardinality
   crosses 50, or the column is dropped), **every subsequent write that includes a `configPatch` for
   this panel — including one that only edits a different, unrelated control's label, or rebinds a
   different control, or adds a new control — is rejected with 400**, because the orphaned entry is
   still present in the effective controls list and still fails `kindsFor`.

   This directly contradicts D5, which states the orphan case is "NOT deleted or write-rejected
   (nothing writes to it after the fact)," and contradicts the AC's own intent ("a schema drift that
   orphans a control has defined, **visible** behaviour" — implying a non-blocking degraded state
   the author can see and act on, not a save-blocking lockout of the whole panel). It is also
   inconsistent with `specs/output-panel-placement/spec.md`'s own two requirements: Requirement 2's
   scenario ("A control valid at add-time is re-validated on every subsequent write") explicitly
   describes a write being rejected due to drift, while Requirement 3 ("A bound column that no
   longer exists... is a defined, visible drift state") explicitly forbids "erroring the whole panel
   read" but says nothing about writes — leaving the write-path behavior for an *untouched* orphaned
   control genuinely undefined and, per D4's literal text, actively hostile to the AC's intent.

   As written, a competent implementer following D4 verbatim (mirror `rejectInconsistentForm`
   exactly) ships a real lockout bug: an author cannot save *any* edit to an output panel — not even
   an unrelated title/appearance change that happens to route through the same `configPatch`, or a
   fix to a *different* control — once one control has drifted, unless they also fix/remove the
   drifted control in that same request. That is a materially different (and worse) user experience
   than "orphaned control is visibly flagged and the author can rebind or remove it at their
   leisure," which is what the AC and D5/Requirement 3 promise.

   **Required revision:** design.md D4 must state explicitly whether `rejectInvalidControls`
   validates every control in the effective list on every write (matching the form precedent, and
   accepting the lockout as intended — in which case D5's "not write-rejected" language and the AC's
   "visible, non-silent" framing need to be corrected to say "locked until fixed"), or whether it
   only validates controls that are new/changed in this specific write (excluding untouched,
   already-orphaned entries from re-validation — in which case Requirement 2's Scenario 2 needs to
   be rewritten, since as currently worded it says editing the *same* drifted control's label alone
   triggers rejection, which would need to be distinguished from editing something else while that
   drifted control sits untouched). Either resolution is implementable; the current text asserts
   both simultaneously.

2. **Undocumented wire shape for range-kind `defaultValue`.** `design.md` D2 gives
   `OutputControlSpec.defaultValue: Option[JsValue]` — a single opaque value, unvalidated in shape
   (matching `FormFieldSpec.initialValue`'s precedent). But D7 says a `numeric-range` control's
   author-entered default is "min/max numbers" — i.e., two values — and ticket.md's scope line
   explicitly lists "author default value" as part of what this ticket persists. Nowhere does
   design.md state the JSON shape a `numeric-range` (or `date-range`, if it ever needs two
   endpoints rather than D7's stated single anchor) default takes (`{"min":.., "max":..}` vs
   `[min, max]` vs something else) — unlike `FormFieldSpec`, where `initialValue` is genuinely a
   single scalar per field so no shape ambiguity exists. Since the server never validates
   `defaultValue`'s internal shape (by design, mirroring the form precedent), this is the kind of
   thing that two different frontend call sites (the editor component and, later, HEL-1190's viewer)
   could each guess differently with nothing catching the mismatch until runtime. **Required
   revision:** state the per-kind `defaultValue` wire shape explicitly in D2 or D7 (even a one-line
   convention per kind is sufficient) so the executor and HEL-1190's later leaf agree on it without
   having to reverse-engineer it from whichever ships first.

### Non-blocking notes

- D3's "text iff Contains present" is universally true for every Structured column type (since
  `staticOperatorsFor` never omits `Contains` from a non-empty Structured set), so a `text` control
  will be offered on boolean, integer, and timestamp columns, not just string columns. This is
  correctly inherited from HEL-1188's real contract rather than invented here, and applying/
  rendering is explicitly out of this leaf's scope, but it's worth the author-facing copy in the
  editor UI (task 3.3/3.5) not implying "text" only makes sense for string-like columns.
- D7's choice to give `date-range` a single-anchor-date default (rather than a from/to pair) while
  giving `numeric-range` a min/max pair default is a real asymmetry between two control kinds that
  are otherwise treated identically by the eligibility rule (both are "Gte+Lte, differentiated only
  by declared type"). Not blocking since leaf 3 (rendering/applying) is out of scope, but worth a
  one-line rationale in design.md so it doesn't read as an oversight to the next reader.
