## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold re-review of the revised artifacts against worktree ground truth. Round 1's report was read as a
claim set; every closure below was re-derived from code, not from the orchestrator's checklist.

### What I verified (with evidence)

**Round-1 CR1 (blank string defeats form-tightened `required`) — GENUINELY CLOSED.**
The fix is in the right layer, which is what makes it real rather than re-worded:
`DatasetRowValidator.validateRow:122-123` still treats a cell as missing ONLY when `raw == JsNull`, and
`validateValue:67-68` still accepts ANY `JsString` for `string`/`string-body`, so the declared-schema
validator can never reject `"   "`. D3(iv) now assigns the blank rule to the new pure builder
(`FormSubmission.buildRow`), where it is enforceable: blank/whitespace `JsString` for a configured field is
NOT SUPPLIED, and D3(v) turns that into reason `required` with no declared-default fill, mirroring the
client's `isEmptyValue` (`state/formFieldValidation.ts:11-15`). The spec's server-enforcement requirement
now reads "missing, null, or blank" and carries the "Blank string does not satisfy a form-tightened
requirement" scenario; tasks 3.1 (`"   "` treated as not supplied), 3.2 (`400` + `fieldErrors` + row count
unchanged) and 3.8 (API-bypass leg) pin it at three levels. Not delegated to the validator — which was the
substance of the CR.

**D3(v)'s extension to declared-required configured fields — SOUND, judged as asked.** The client blocks
them: `isFieldRequired` is `field.required === true || declared.required`
(`formFieldValidation.ts:19-21`), so a blank value in a declared-required, config-optional field never
leaves the browser. Without the extension the server would fill the declared `default` for exactly that
payload (`DatasetRowValidator.validateRow:130-131` substitutes `field.default` for a `JsNull` cell), i.e. a
blank submit would silently store a default the user never saw — the AC's "the server independently rejects
a payload the client would have blocked" fails, and C3 ("never silently coerce") is violated. The extension
is scoped to *configured* fields only, so D3(vii)'s `JsNull` for *unconfigured* fields still lets the
declared default apply (the spec's "Unconfigured declared field takes its default" scenario remains
achievable). Correct parity, correctly scoped.

**Round-1 CR2 (`select` membership undefined for unusable `options`) — CLOSED.** The hole is still open in
the code (`FormFieldSpec.options` is raw `Option[JsValue]`, `FormPanel.scala:29,124`; `validateConfig`
checks only presence, so `[]`/`{}`/`5` persist), and D3(vi) now states the behaviour rather than leaving the
implementer a choice: any supplied value for such a field → `options are not configured`, "never skipped".
Task 3.1 pins all three shapes, the spec has the "Unusable options reject every value" scenario, and D2
lists the reason in the closed vocabulary. The permissive reading that would have removed the enforcement is
no longer available.

**Round-1 CR3 (client-side unmatched `select` value) — CLOSED.** D6 now requires `validateForSubmit` to
reject a non-empty `select` value matching no configured/usable option with "<label> must be one of the
configured options", explicitly "never dropped (C3)"; spec scenario "A select value outside the configured
options is caught, never dropped"; task 2.2 and 3.4 both carry it. Reachability re-confirmed:
`useFormPanelValues` re-seeds only on a field-LIST key change (`useFormPanelValues.ts:49-51,64-68`) and the
renderer coerces non-array options to `[]` (`FormFieldControl.tsx:187`), so a stale selection survives an
`options` edit.

**Round-1 CR4 (spec/D8 focus contradiction) — CLOSED and implementable.** The announcement requirement now
defines the fallback in the requirement text itself ("when none is … focus SHALL remain on the submit button
and the summary SHALL name each unrendered field"), has the matching scenario, D8 states the same, and tasks
3.6/3.8 assert it. The fallback target exists by construction (D9's always-rendered submit button) and the
regions are always mounted, so this is satisfiable, not aspirational.

**Non-blocking notes from round 1 — folded in, correctly.** D5 pins both schema titles 1:1
(`FormSubmitRequest`, `FieldValidationErrorResponse`) with `{field, reason}` as a `$defs` entry and "never a
third file", which matches the drift guard's constraint (title → `api/protocols/**` case class, `SKIP` set
off-limits per Non-Goals). D4 records the unbound `DataSourceId("")` → 404 case, which is real read-path
tolerance (`FormPanel.scala` config reader: absent `dataSourceId` → `DataSourceId("")`). Context records
`writeMode` pinned at config time (`FormSubmitSpec` rejects anything but `append`).

**Also re-checked:** C1–C8 present verbatim in `tasks.md` `## Standing Constraints` and mirrored in
`workflow-state.md` `CONSTRAINTS`; the REMOVED delta names the live requirement verbatim
(`openspec/specs/form-panel-rendering/spec.md`: "### Requirement: No submit affordance is rendered yet");
D10/3.3/3.7 keep the two red-first mutation proofs tied to the guards they exercise (C7) and the row-count
discipline (C8).

### Verdict: REFUTE

All four round-1 change requests are genuinely closed in code-grounded terms, and the architecture, lock
discipline, error vocabulary and evidence plan remain sound. I am refuting on one class of field the design
does not account for anywhere, which makes a stated spec requirement unsatisfiable for a config that is
persistable today.

### Change Requests

1. **Non-editable fields (a `file` control, and any field surfaced via `issue`) are unaccounted for on the
   submit path — they make the spec's client-validation focus requirement unsatisfiable, break C3's
   association promise, and can permanently brick submit.**

   Ground truth: `FormPanelView.tsx:52-53` already computes `computeFormIssues(config, schema)` and passes
   `issue` per field. `FormFieldControl.tsx:48-64` (the `file` branch) and `:66-72` (the `issue` branch)
   both render a **`disabled readOnly` `TextField` with `value=""`**, passing only `hint`/`hintId` — **no
   `error`, no `errorId`, hence no `aria-invalid` and no error as accessible description is possible for
   such a field**. `useFormPanelValues` seeds `""` for it (`:27-28,41-45`) and the user cannot change it.

   Now apply the design as written: D6 has `validateForSubmit` run `validateFieldValue` "for every
   configured field", and `validateFieldValue` (`formFieldValidation.ts:33-35`) returns "<label> is
   required" whenever `isFieldRequired` holds and the value is empty. `isFieldRequired` is true whenever the
   *declaration* is required — so for a `file` control over a declared-required `binary-ref` column
   (`file` is that type's only fitting control: `FormFieldSpec.FittingControls`, `FormPanel.scala:54`;
   `CONTROL_FITNESS`, `formConfigValidation.ts:21` — i.e. this config is not merely persistable, it is the
   *only* legal shape for such a column), and equally for an orphaned/unfit field that became an `issue`
   after a dataset schema edit (the exact scenario HEL-1085's "Inconsistent or not-yet-supported fields are
   surfaced, never dropped" requirement exists for), every submit is blocked client-side by an error the
   user cannot clear, which:
   - has **no `[aria-invalid="true"]` control to focus**, so the spec's *client-side* requirement
     ("focus SHALL move to the first failing control", `specs/form-panel-submit/spec.md`, "Submit-time
     client validation blocks a request the declared schema would reject") is unsatisfiable — the same
     defect round 1's CR4 closed for the *server* path, which the added fallback text does not reach
     because it lives in the announcement requirement's server/transport wording and this requirement's
     clause is unconditional;
   - cannot be marked invalid or given the error as its computed accessible description at all, since the
     two branches above accept no `error` prop — so C3 ("every rejected value is surfaced with its field
     and reason … and in the UI") cannot be met without a rendering change this change does not plan;
   - leaves the panel permanently unsubmittable with no stated user-visible explanation of why.

   Required revision: D6 and D8 must state explicitly how the submit path treats a field that is rendered
   non-editable (`file`, or any `computeFormIssues` issue) — e.g. exclude such fields from
   `validateForSubmit` and let the server reject (D3(ii)/(iii)/(v)) with the failure carried in the
   always-mounted alert region and focus on the submit button, per the CR4 fallback; or block submit up
   front with a named, announced summary. Whichever is chosen, the spec's client-validation requirement
   must carry the same carve-out its announcement sibling now has, and task 3.6 must cover a required
   `file`/issue field. State also whether such a panel is expected to be submittable at all (a
   declared-required `binary-ref` column arguably cannot be until HEL-1086), so this is a recorded decision
   rather than an accident.

   Second, related, part of the same decision: D3(v) applies the `required` reason using "config
   `required: true` OR declared", but D3(iii)'s "not declared by the bound dataset" fires only when a value
   *is* supplied. An orphaned configured field marked `required: true` with no value supplied therefore
   comes back as reason `required` for a column the dataset does not declare — a misleading error the client
   cannot act on. Pin which reason wins for an undeclared configured field (recommend `not declared by the
   bound dataset` regardless of whether a value was supplied) in D3 and in task 3.1.

### Non-blocking notes

- **Configured-optional-but-blank should be pinned.** D3(iv)+(vii)+(viii) imply that a blank value in a
  configured, non-required field becomes `JsNull` and therefore takes the *declared default*
  (`DatasetRowValidator.validateRow:130-131`) rather than being stored as `null`. That is consistent with
  the spec's "treated as not supplied, never stored" and with `buildSubmitValues` omitting empty strings,
  but it is derived rather than stated — worth one `FormSubmissionSpec` case in 3.1 so the implementer does
  not force `JsNull` past the default.
- **`select` option identity via `String(v)` is lossy for non-scalar or stringwise-colliding options.**
  D6 resolves the typed option "by its `String` key", matching the renderer
  (`FormFieldControl.tsx:187-189`, `String(v)` for both value and label). For `options: [1, "1"]` or object
  options the key is ambiguous/`"[object Object]"`. Nothing is silently dropped (the server's JSON-equality
  check rejects a mismatch, and `computeFormIssues` already flags options that are not valid typed values
  for the declared type), so this is not blocking — but "first match wins" is worth one sentence in D6.
- D9 still says nothing about Enter inside `Toggle`'s native input (a checkbox does not submit on Enter in
  browsers). Consistent with the spec, which only claims Enter-in-`text` submits; merely untested.
