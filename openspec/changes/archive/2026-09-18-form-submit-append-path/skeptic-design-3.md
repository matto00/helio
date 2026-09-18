## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold re-review. The prior reports and the orchestrator's closure summary were read as claim sets; every
closure below was re-derived from the worktree's code. Review base resolved live:
`resolve-review-base.sh` → `b1b954e364b1725787e28c0d86540c910c1fc460`.

### What I verified (with evidence)

**Round-2 CR part 1 (non-editable fields) — GENUINELY CLOSED, not re-worded.**
The premise still holds in code: `FormFieldControl.tsx:48-66` (`file`) and `:68-74` (`issue`) each render a
`disabled readOnly` `TextField` with `value=""` and only `hint`/`hintId` — no `error`, no `errorId`, so no
`aria-invalid` and no error-as-accessible-description is possible for such a field; `FormPanelView.tsx:52-53,89`
already feeds `issue` per field from `computeFormIssues`. The fix changes *behaviour*, which is what makes it
real: design.md D6 (`:89-94`) excludes non-editable fields from per-field validation and from the payload,
skips an optional one, and blocks a REQUIRED one up front with a form-level announced summary, no request,
focus on the submit button; D8 (`:111-114`) now says "client-side and server-side alike" for that fallback, and
the fallback target exists by construction (D9's always-rendered button). The spec's client-validation
requirement carries the same carve-out in the requirement text (`specs/form-panel-submit/spec.md:35-38`) —
i.e. the unconditional "focus SHALL move to the first such control" clause is now scoped to *editable* fields
(`:31,33`) — plus both new scenarios (`:53-61`). Tasks 2.2 / 3.4 / 3.6 each carry a concrete case. The
`computeFormIssues` set the design calls "non-editable" matches the renderer exactly (any issue at all →
the disabled branch), and `file` is checked before `issue`, so the two descriptions do not diverge.
The "not submittable until HEL-1086" decision is recorded (D6 `:93-94`).

**Round-2 CR part 2 (reason precedence) — CLOSED.** D3(iii) (`design.md:48-50`) now states undeclared →
`not declared by the bound dataset` "whether or not a value was supplied (this reason wins; the field is
skipped by the rules below)"; spec scenario `:121-123`; task 3.1 pins "wins over `required`". The reason
ordering is unambiguous for the required case.

**Round-1 CR1–CR4 — still closed.** Re-derived rather than trusted:
`DatasetRowValidator.validateRow` (`:118-123` in the file read this round) still treats a cell as missing
only when `raw == JsNull` and `validateValue:66-67` still accepts ANY `JsString` for `string`/`string-body`,
so the blank rule genuinely cannot live in the declared-schema validator — D3(iv)/(v) put it in the new pure
`FormSubmission.buildRow`, mirroring `formFieldValidation.ts:11-15`'s `isEmptyValue`, with spec scenario
`:101-103` and tasks 3.1/3.2/3.8. `FormFieldSpec.options` is still raw `Option[JsValue]`
(`FormPanel.scala:29`) and `validateConfig` still checks presence only, so `[]`/`{}`/`5` persist — D3(vi)
pins `options are not configured`, "never skipped". Client-side unmatched `select` → D6 `:87-88` with
"never dropped (C3)". Focus fallback lives in the spec requirement text (`:162-164`).

**Non-blocking notes folded in, correctly.** D3(v) `:53-54` (blank optional configured field → `JsNull` →
declared default; matches `validateRow`'s `field.default` substitution for a `JsNull` cell) + spec `:125-127`
+ task 3.1; D6 `:96` `select` "first match wins" (matching the renderer's `String(v)` keying,
`FormFieldControl.tsx:187-189`); D9 `:120-121` names `Toggle`'s input alongside `Textarea`/`Select`.

**Also re-checked:** route placement is free (`PanelRoutes.scala:63,78` — `path(PanelIdSegment)` and
`path(PanelIdSegment / "duplicate")`, no shadowing); the REMOVED delta names the live requirement verbatim
(`openspec/specs/form-panel-rendering/spec.md`: "No submit affordance is rendered yet"); C1–C8 present in
`tasks.md` `## Standing Constraints` and mirrored in `workflow-state.md`; D10/3.3/3.7 keep both red-first
mutation proofs tied to the guards they exercise, with row counts (C7/C8). A `date` control's value is
ISO-local-date, which the backend accepts (`TimestampParsing.looksLikeTimestamp` includes
`ISO_LOCAL_DATE`) — no dead date field.

**No round-1 or round-2 change request survives.** The one below is new, and is a consequence of the
round-2 fix rather than an unaddressed part of it.

### Verdict: REFUTE

### Change Requests

1. **D3(iii) and D6 now contradict each other for an *optional* field the dataset no longer declares, making
   any panel with an orphaned field permanently unsubmittable while the client believes it is skippable.**

   - Client side, as designed: an orphaned field is flagged by `computeFormIssues`
     (`formConfigValidation.ts:122-128`, `'<name>' is not declared by the bound dataset`) → rendered by the
     `issue` branch (`FormFieldControl.tsx:68-74`) → therefore "non-editable" per D6 `:89-94`. If it is not
     required, D6 says it is "skipped (**the server treats it as not supplied**)" and
     `buildSubmitValues` never sends it. The spec's new scenario is explicit about the outcome:
     "An optional non-editable field is skipped … **the request is sent without that field and the row is
     appended**" (`specs/form-panel-submit/spec.md:59-61`).
   - Server side, as designed: D3(iii) rejects "a configured field the declaration lacks →
     `not declared by the bound dataset`, **whether or not a value was supplied**". Nothing in D3 narrows
     this to required or to supplied-only fields. So the very payload D6 predicts will append gets a `400`,
     with a `fieldError` naming a field that has no rendered control — the user sees only D8's
     submit-button-focused summary and can never submit, and the design nowhere records that.
   - This is reachable with no bad authoring: any dataset schema edit that drops or renames a column
     orphans a configured field — precisely the case HEL-1085's "surfaced, never dropped" requirement
     exists for. It is also an implementer fork: a competent implementer reading D3(iii) literally and one
     reading D6's parenthetical will write opposite code, and each will pass the tests currently listed
     (3.1 only pins the `required: true` orphan; 3.4/3.6 only mock the client side — no test crosses the
     seam for an *optional* orphan).

   Required revision, pick one and pin it in both places:
   (a) narrow D3(iii) to fire only when a value **is supplied** for the undeclared field **or** the field is
   configured `required: true` (an unsupplied undeclared optional field is ignored — nothing is dropped, so
   C3 is untouched, and D6's claim becomes true); or
   (b) keep D3(iii) as written and remove D6's "the server treats it as not supplied" promise and spec
   scenario `:59-61`'s "the row is appended" for the orphaned case, restricting that scenario to `file`
   fields, and record explicitly that a panel with ANY orphaned configured field is unsubmittable until the
   config or dataset is fixed — in which case D6 must also block submit up front for an orphaned *optional*
   field with an announced summary, rather than sending a request the server is certain to reject.
   Whichever is chosen, add the missing test that crosses the seam: a `FormSubmissionSpec`/route case for an
   **optional** orphaned configured field with no value supplied (task 3.1 and 3.2), and the matching
   `FormPanelView` case in 3.6.

   Two smaller parts of the same decision, to state while you are in D3/D6:
   - **D6 does not say how "required" is determined for an orphaned field.** It says "a REQUIRED one
     (`isFieldRequired`)", but `isFieldRequired(field, declared)` requires a declaration
     (`formFieldValidation.ts:19-21`) and an orphaned field has none — `FormFieldControl.tsx:45` falls back
     to `false` for exactly this reason. State that for an undeclared field the test is `field.required ===
     true` alone (which is what spec scenario `:53-57`'s "a required field the dataset no longer declares"
     assumes).
   - **The spec's server-enforcement requirement prose never states the undeclared-configured-field rule**
     (`:84-95` enumerates unknown key, `file` value, type mismatch, unconfigured declared-required-without-
     default, row bound) — it exists only as scenario `:121-123`. Add the rule, in whichever form (a) or (b)
     resolves to, to the requirement text so the scenario is an example of a stated rule rather than the
     only statement of it.

### Non-blocking notes

- **The client's `timestamp` check is looser than the server's, in the safe direction.**
  `isValidTypedValue` uses `Date.parse` (`formConfigValidation.ts:75`) while the server requires one of four
  formats (`TimestampParsing.looksLikeTimestamp`). A `text` control over a timestamp column can therefore
  pass D6's client check and be rejected `expected timestamp, got string`. That is the AC's intended
  direction (client is convenience) and the error is announced and associated, so it is not blocking — worth
  one sentence in D6 so it is a recorded asymmetry.
- `FormPanelView` builds `issuesByField` as a `Map` from `computeFormIssues` (`:53`), so a field with two
  issues surfaces the first. D6's non-editable rule keys off *presence* of an issue, not its text, so this is
  harmless; the form-level summary wording for a required non-editable field will just quote the first issue.
- D2 pins `201` + `RowWriteResponse` whose `rows` holds exactly one entry. Worth one sentence on whether the
  reader rejects a `values` object with zero keys for a form that has fields, or lets D3(v) produce the
  `required` errors (either is defensible; only the second is currently implied).
