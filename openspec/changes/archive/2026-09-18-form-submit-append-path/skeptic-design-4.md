## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Cold review. The prior reports and the orchestrator's round-3 closure summary were read as claim sets only;
every closure below was re-derived from the worktree's code and artifacts. Reviewed at
`HEAD = b1b954e364b1725787e28c0d86540c910c1fc460` (worktree clean apart from the untracked change dir).

### What I verified (with evidence)

**Round-3 CR (the D3(iii) ↔ D6 orphaned-optional-field contradiction) — GENUINELY CLOSED, option (a),
consistently everywhere.** Re-derived rather than trusted:

- `design.md:47-50` D3(iii) now fires `not declared by the bound dataset` only "when a value IS supplied for
  it or it is configured `required: true` (this reason wins over `required`)", and states "an unsupplied
  undeclared OPTIONAL field is ignored".
- `design.md:90-93` D6 matches: an optional non-editable field "is skipped (the server ignores it, D3)", and
  for an undeclared field "required" is pinned to `field.required === true` alone "since `isFieldRequired`
  needs a declaration". That matches the code: `formFieldValidation.ts:19-21` `isFieldRequired(field,
  declared)` dereferences `declared.required`, and `FormFieldControl.tsx:45` already falls back to `false`
  for an undeclared field — so the design's rule is the only implementable one.
- Spec prose, not just a scenario: the server-enforcement requirement text now carries the rule in both
  halves (`specs/form-panel-submit/spec.md:93-94`), which was the third part of the round-3 CR. Scenarios
  `:124-126` (undeclared `required: true`, omitted → 400 undeclared) and `:128-130` (unsupplied optional
  undeclared → 201) are now examples of a stated rule.
- The seam-crossing tests the CR demanded exist: `tasks.md:22` (3.1 `FormSubmissionSpec`: "unsupplied
  optional undeclared → ignored and the row builds"), `tasks.md:23` (3.2 route spec: "optional orphaned
  configured field omitted → 201 and one row"), `tasks.md:29` (3.6 `FormPanelView`: "an optional `file` field
  and an optional orphaned field → request sent without them"). `tasks.md:4` (1.2) states the rule for the
  implementer.
- I traced the whole client→server matrix for an orphaned field and it is now consistent in every cell:
  required orphan → client blocks up front (D6), server would reject as undeclared (D3(iii)); optional
  orphan, no value → client omits, server ignores → 201; optional orphan with a value → only reachable by
  API bypass, server rejects as undeclared (C3 satisfied — surfaced, never dropped).

**The two round-3 non-blocking notes were folded in correctly.** `design.md:41-42` D2 now pins that an empty
`values` object is valid ("D3(v) yields the `required` errors, or an all-default row appends"), with the
matching case in `tasks.md:23`. `design.md:101-102` D6 records the client/server timestamp asymmetry; I
confirmed it is real and in the safe direction — `isValidTypedValue`'s `timestamp` branch
(`formConfigValidation.ts`) uses `Date.parse`, while the server requires `TimestampParsing.looksLikeTimestamp`.

**Rounds 1–2 closures still hold.** Re-derived from code, not from the prior reports:
`DatasetRowValidator.validateRow` still treats a cell as missing ONLY when `raw == JsNull` and substitutes
`field.default` for a `JsNull` cell before the `required` check
(`backend/src/main/scala/com/helio/domain/engine/DatasetRowValidator.scala`, `validateRow`'s
`missing = raw == JsNull` / `field.default match { case Some(d) => Right(d) … }`), and `validateValue`
accepts ANY `JsString` for `string`/`string-body` — so the blank-is-not-supplied and
required-without-default-fill rules genuinely cannot live in the declared-schema validator, which is why
D3(iv)/(v) put them in the new pure `FormSubmission.buildRow`. `FormFieldSpec.options` is still raw
`Option[JsValue]` (`FormPanel.scala:29`), so `[]`/`{}`/`5` persist and D3(vi) is a real rule. The
`file` and `issue` branches of `FormFieldControl.tsx:47-73` still render a `disabled readOnly` control with
`value=""` and only `hint`/`hintId` — no `error`, no `errorId` — so a non-editable field genuinely cannot
carry an associated field error, which is what makes D6's form-level-summary route the right shape.

**A candidate finding I dissolved against ground truth (recorded so it is not re-raised).** D6's
"`checkbox` sends the boolean" looked like it could fork for an untouched checkbox (`isEmptyValue` returns
`false` for `checkbox` unconditionally, `formFieldValidation.ts:12`, so the client's required check always
passes for one) — a server `required` rejection the client could never prevent. It is not reachable:
`useFormPanelValues.emptyValueFor` (`:27-29`) seeds a checkbox to `false` and `seedValueFor` (`:33-39`)
coerces with `Boolean(...)`, so the values map always holds a real boolean for a checkbox, never `undefined`.
No change request.

**Also re-checked:** C1–C8 are present in `tasks.md` `## Standing Constraints` (`:35-44`) and mirrored in
`workflow-state.md`; the REMOVED delta (`specs/form-panel-rendering/spec.md`) names the live requirement
("No submit affordance is rendered yet") with a migration note; D10/3.3/3.7 keep both red-first mutation
proofs tied to the guard each exercises, with row counts (C7/C8); `FormPanelView.tsx:52-53,89` already feeds
`issue` per field from `computeFormIssues`, so D6's non-editable set is computable where it is needed.

**No round-1, round-2 or round-3 change request survives.** The one below is new — and, like round 3's, it is
a seam between two D6 clauses added in different rounds that the round-3 fix did not touch.

### Verdict: REFUTE

### Change Requests

1. **D6 contains two rules that both claim a `select` whose `options` is not a non-empty array, and they
   demand opposite behaviour — one of which silently drops a value the user typed (C3) and the other of which
   is unrenderable.** `tasks.md` 3.4 inherits the contradiction as two incompatible test expectations for the
   same field.

   - **Clause A** (`design.md:87-89`): "for a `select`, a non-empty value matching no configured option (or
     whose `options` is not a non-empty array) → '<label> must be one of the configured options' — never
     dropped (C3; reachable after an options edit while mounted)".
   - **Clause B** (`design.md:89-91`): "Non-editable fields — a `file` control, or any field
     `computeFormIssues` flags (**orphaned, unfit, bad options**) — are never validated per field nor sent:
     an optional one is skipped".
   - Ground truth: a `select` whose `options` is not a non-empty array **is** flagged by
     `computeFormIssues` — `formConfigValidation.ts`, `if (field.control === "select") { if
     (!isOptionsArray(field.options)) issues.push({… "Options must be a non-empty list" }) }`, where
     `isOptionsArray` requires `Array.isArray(value) && value.length > 0`. So such a field lands in clause B's
     set *and* in clause A's set.
   - The case is reachable with a non-empty held value and no bad authoring: `useFormPanelValues` re-seeds
     only when the **field-list key** changes (`fieldsKey` = the `sourceField` list, `:49-51`, checked at
     `:64-68`). An author editing only a field's `options` while a viewer has the panel mounted changes no
     `sourceField`, so the viewer's previously-typed value survives in `values` while the field flips to the
     non-editable `issue` branch (`FormFieldControl.tsx:68-73`) — exactly the "reachable after an options edit
     while mounted" scenario clause A itself cites.
   - Consequences of each reading, which is why this is an implementer fork and not a wording nit:
     clause B → the typed value is silently not sent and the submit succeeds, dropping it with no field, no
     reason, on neither the wire nor the UI (a direct C3 violation); clause A → a per-field error on a field
     the renderer cannot give an `error`/`errorId` to (the `issue` branch passes neither), so clause A is not
     implementable as a per-field error for the very case its parenthetical names.
   - The tests currently pin both: `tasks.md:27` (3.4) requires "a `select` value outside the configured
     options **and unusable `options`** (never dropped)" *and* "an optional one skipped" — an implementer will
     write whichever they read first and can satisfy exactly one.

   Required revision, pick one and pin it in D6, in the spec's client-validation requirement, and in task 3.4:
   (a) treat an unusable-`options` `select` **holding a non-empty value** like the required-non-editable case —
   block the submit up front with the announced form-level summary naming the field and why its value cannot
   be sent, no request, focus on the submit button (satisfies C3 without needing an association the renderer
   cannot provide), and narrow clause B's "an optional one is skipped" to a non-editable field whose held
   value is empty; or
   (b) drop clause A's "(or whose `options` is not a non-empty array)" parenthetical, letting clause B govern
   — but then state explicitly in D6 and the spec that a stale value in a field whose options became unusable
   is discarded without being reported, and get that C3 exception recorded as a deliberate, named exception
   rather than an unremarked one.
   Whichever is chosen, add the test that crosses this seam to 3.4 (and, if (a), to 3.6): an **optional**
   `select` with `options: []` **holding a non-empty value**, asserting the chosen outcome — the current
   3.4 wording covers only the empty/editable variants.

   One smaller part of the same decision, to state while in D6/clause B: clause B enumerates
   `computeFormIssues`'s set as "orphaned, unfit, bad options", but the function also emits **duplicate field**,
   **"Step must be positive"**, **"Step is only valid for the number control"**, **"Option … is not a valid
   `<type>` value"** and **"Initial value is not a valid `<type>` value"** issues. Behaviour is still
   well-defined (clause B keys off the *presence* of an issue, and the renderer's `issue` branch fires for any
   issue at all), so this is not a second fork — but the parenthetical reads as an exhaustive list and is not
   one. Either mark it "e.g." or say "any issue `computeFormIssues` returns", so no implementer treats the
   step/initial-value cases as editable.

### Non-blocking notes

- `FormPanelView` builds `issuesByField` as a `Map` (`:53`), so a field with two issues surfaces the first;
  D6's form-level summary wording for a required non-editable field will quote the first issue. Harmless,
  worth knowing when writing 3.6's expected text.
- The announcement requirement's focus clause (`specs/form-panel-submit/spec.md:169-171`) explains the
  keep-focus-on-the-button case as "every error names a field the form does not render, or the failure is not
  field-level". A required non-editable field **is** rendered (as a disabled control) and is simply never
  marked invalid, so it is covered by the governing clause ("when at least one rendered control is rejected
  … when none is") but not by that dash-parenthetical's enumeration. The client-validation requirement
  (`:35-38`) states the behaviour explicitly, so nothing is ambiguous; one word ("or names a field it renders
  non-editably") would make the two read identically.
- D3(v)'s "required (config `required: true` OR declared — `isFieldRequired`)" cites a TypeScript symbol
  inside a Scala rule. Clear in context; the Scala implementation has no such helper.
