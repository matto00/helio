## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

Cited-anchor checks (all three named in the brief — verified at their REAL paths; design.md cites
bare filenames, the line numbers are correct):

- **D3's reorder claim — SUBSTANTIATED.** `backend/src/main/scala/com/helio/domain/engine/DatasetSchemaMigration.scala:45-96`
  (`resolveIdentity`) resolves fields by `name`/`previousName` and returns a per-new-field OLD index
  (`Right(claimedSource.map(_.map(oldNameToIndex)))`, :92); the new declaration's ORDER is the edits'
  order, so a `PATCH .../schema` can reorder declared fields. Its docstring confirms
  `DataSourceRepository.updateDatasetSchema` is the only caller and persists the output verbatim from a
  fresh-under-lock declaration. A name→position mapping computed outside `lockSource` can therefore
  misalign. D3's mitigation (build the row from the declaration read under the lock) is the right shape.
- **D5's precedent — CONFIRMED verbatim.** `api/routes/proposals/DashboardAuthoringRoutes.scala:56-63`
  is `completeAuthoring`, which reuses `ServiceResponse.statusCodeFor` (`api/routes/ServiceResponse.scala:76`,
  `private[routes]`) and diverges only in the body shape, falling back to bare `ErrorResponse(err.message)`.
  Three other cross-domain callers exist (`RefinementRoutes:48,50`, `AssistantConversationRoutes:258`,
  `DataSourceRoutes:68,72,83`), so this is an established pattern, not a one-off.
- **D8's `resetOnSuccess` default — SOUND.** `domain/panels/FormPanel.scala:139-143` is
  `FormSubmitSpec(writeMode, label, resetOnSuccess)` with `resetOnSuccess: Option[Boolean] = None` and no
  behaviour anywhere. Absent → reset is defensible (repeated entry is the primary use; a retained
  successful row invites a duplicate append), the opt-out is explicit, and the spec pins BOTH branches
  ("Default resets" / "Opt-out keeps values"). `useFormPanelValues.reset()` already exists
  (`ui/form/useFormPanelValues.ts:96-99`) and restores seeds + clears touched, so D8 is implementable as written.

Scope / architecture (the brief's escalation candidate):

- **D1's panel-scoped route is a SOUND reading of "wire submit to the row-append API", not overreach.**
  Verified the gap is real: `DataSourceRepository.appendRowsAction:576-624` validates only against the
  dataset's DECLARED schema via `DatasetRowValidator.validate`, and its sole error shape is
  `errors.mkString("; ")` → `ServiceError.BadRequest` (`DataSourceService.scala:775-778`). The form's
  tighten-only requirement is `field.required === true || declared.required`
  (`state/formFieldValidation.ts:19-21`) and `select` options live in panel config
  (`FormFieldSpec.options`, `FormPanel.scala:29`) — neither is visible to `POST .../rows`, which knows
  nothing about panels. A browser calling `.../rows` directly would also CHOOSE the write target,
  contradicting the AC "appends exactly one row to the panel's bound dataset source". D1 composes the
  existing locked path rather than re-implementing it. No escalation warranted.
- Route placement is viable: `api/routes/panels/PanelRoutes.scala:78` already has
  `path(PanelIdSegment / "duplicate")` alongside `path(PanelIdSegment)` (:63) — no shadowing risk.
- `PanelRepository.findById(id, callerOpt)` is genuinely sharing-aware (owner OR explicit grant OR
  public-viewer grant, "no existence leak") — D4's 404 story is grounded.
- Spec scenario "Unconfigured declared field takes its default" is mechanically achievable:
  `validateRow` substitutes `field.default` when the positional cell is `JsNull` (`DatasetRowValidator.scala:130-131`),
  which is exactly what D3(v)'s `JsNull`-for-unsupplied build produces.

The unregistered-schema question (the brief asked me to judge it):

- **Acceptable as planned; no surfacing needed, with one caveat.** `scripts/check-schema-drift.mjs` does
  NOT use a registry — it recursively walks `schemas/` and requires each file's `title` to match a case
  class in `JsonProtocols.scala`/`api/protocols/**`, erroring otherwise ("add to SKIP set ... if
  intentional"). HEL-1077's schemas needed no registration precisely because `RowWriteRequest`/
  `RowWriteResponse`/`RowWriteRowResponse` map 1:1 (`api/protocols/sources/DataSourceProtocol.scala:254-262`).
  So the new schemas are auto-discovered and self-checked, and `.husky/pre-commit:10` runs
  `npm run check:schemas` — the guard is not bypassed. Caveat recorded as a non-blocking note below.
- `.husky/pre-commit` touches nothing this change plans to edit; `openspec/config.yaml` exists (task 1.7).
- The REMOVED delta names the live requirement VERBATIM: `openspec/specs/form-panel-rendering/spec.md:156`
  is `### Requirement: No submit affordance is rendered yet`. Correct.

The two traps the brief demanded be closed:

- **Trap 1 (announcement proven by computed relationships, not presence) — CLOSED.** D8 mounts both
  regions ALWAYS and explicitly rejects "mounting a `role="alert"` node on error (presence ≠
  announcement — the HEL-1084 finding)". The spec requirement ends with "never by the presence of an
  alert node". Tasks 3.6 asserts computed ARIA only (C1) and 3.8 asserts the region is present and
  EMPTY pre-submit, then its COMPUTED role and text after the async rejection, plus
  `toHaveAccessibleDescription` and `toBeFocused`. That is association + pre-existence, not presence.
- **Trap 2 (preserved input proven red-first) — CLOSED.** 3.7 mutates `reset()` INTO the rejection
  branch and requires 3.6's field-error AND network cases to go red; 3.3 mutates away the
  effective-declaration tightening and requires the row COUNT to change. Both are mutations that
  exercise the specific guard, recorded in `mutation-evidence.md` (C7/C8). C8's "count before and
  after, never inferred from a 400 alone" is carried into 3.2 and 3.8.

Standing constraints: C1–C8 present in `tasks.md` `## Standing Constraints`; C7/C8 are the new ones and
are wired into concrete tasks (3.3/3.7/3.8) rather than merely asserted.

### Verdict: REFUTE

The architecture, the lock discipline, the error-shape precedent, the reset default and both evidence
traps are sound. I am refuting on four specific under-specifications, one of which defeats a stated
acceptance criterion as written.

### Change Requests

1. **A whitespace-only / empty string defeats the server-side enforcement of a form-tightened
   `required` — the AC's central promise.** Ground truth: `DatasetRowValidator.validateRow` treats a
   cell as missing ONLY when `raw == JsNull` (`DatasetRowValidator.scala:122-123`), and `validateValue`
   accepts ANY `JsString` for `string`/`string-body` (:67-68). D3(vi)'s effective declaration
   (`required = true, default = None`) therefore rejects only *missing/null*. The client blocks
   whitespace-only via `isEmptyValue`'s `value.trim() === ""` (`state/formFieldValidation.ts:11-15`), so
   `POST /api/panels/:id/submit {"values": {"note": "   "}}` is precisely "a payload the client would
   have blocked" — and it would be ACCEPTED and written. The spec even encodes the hole rather than
   closing it: "a field the form marks `required: true` that is missing **or null**"
   (`specs/form-panel-submit/spec.md`, the server-enforcement requirement), while the same requirement
   promises the server validates "independently of any client" and the ticket AC says "the server
   independently rejects a payload the client would have blocked". Required revision: D3 must add an
   explicit rule that a form-required field whose submitted value is an empty or whitespace-only string
   is rejected with reason `required` (this cannot be delegated to the effective declaration — the
   declared-schema validator will never do it); the spec requirement's wording must change from "missing
   or null" to include blank/whitespace-only; and task 3.2 must add a whitespace-only-for-a-form-required-field
   case asserting `400` + `fieldErrors` + unchanged row count. Note this is invisible from the browser
   because D6's `buildSubmitValues` omits empty strings — the API-level test is the only thing that can
   catch it, which is exactly why it belongs in 3.2 and in 3.8's API-bypass leg.

2. **D3(iv)'s `select`-membership rule is undefined when `options` is not a non-empty JSON array, and
   config validation permits exactly that.** `FormFieldSpec.options` is `Option[JsValue]` — arbitrary
   JSON (`FormPanel.scala:29`, decoded raw at :124) — and `FormPanel.validateConfig`'s only guard is
   `case f if f.control == "select" && f.options.isEmpty => "select field requires options"`
   (`FormPanel.scala:155-156`), which tests OPTION emptiness, not array-ness or non-emptiness. So
   `options: []`, `options: {}` and `options: 5` are all persistable config today. D3(iv) says only "not
   equal (JSON equality) to one of `options`", which a competent implementer can read two ways: reject
   every value (bricking the panel) or skip the check when `options` isn't a usable array — the latter
   silently removes the very server-side enforcement this ticket exists to add, and would pass every
   listed test. Required revision: D3 must state the behaviour explicitly for a non-array or empty
   `options` (recommend: any submitted value for that field is rejected with a named reason, never
   skipped), and task 3.1 must pin it in `FormSubmissionSpec`.

3. **D6 does not say what the client does with a `select` value that matches no configured option —
   the silent-drop risk C3 exists to forbid.** D6 specifies only that `buildSubmitValues` "resolves the
   typed option by its `String` key"; the unmatched case is unspecified, and omitting it would be a
   silent drop of a user-entered value (C3: "Never silently drop or coerce a submitted value"). This is
   reachable, not theoretical: `useFormPanelValues` re-seeds only when the FIELD LIST changes, keyed by
   `sourceField` alone (`useFormPanelValues.ts:49-51,64-68`), so an author editing a field's `options`
   while the panel is mounted leaves a now-invalid selected value in state; the renderer independently
   coerces non-array options to `[]` (`FormFieldControl.tsx:187`). Required revision: D6 must specify
   that `validateForSubmit` rejects a value that is not among the configured options with a named,
   label-aware message (no request sent), and task 3.4 must cover it.

4. **The spec's focus requirement and D8's fallback contradict each other for an unrendered rejected
   field.** The announcement requirement states unconditionally that a rejection "SHALL move focus to
   the first rejected control", while D8 says a field error naming a field the form does not render "is
   shown in the alert region with the field name" — in the case where EVERY field error names an
   unrendered field (D8's own example: a declared-required column the author omitted) there is no
   `[aria-invalid="true"]` control, so D8's DOM query finds nothing and focus moves nowhere, violating
   the spec as written. Required revision: either carve the exception into the spec requirement or define
   the fallback target explicitly in D8 (e.g. focus stays on the submit button while the alert region
   carries the summary), and cover that case in 3.6.

### Non-blocking notes

- **Keep both new schema titles 1:1 with new protocol case classes.** Because the drift guard errors on
  any `title` with no matching case class under `api/protocols/**` and its only escape hatch is the
  `SKIP` set — editing which IS editing the guard, excluded by Non-Goals — a schema whose title has no
  1:1 protocol case class would box the executor in. `FieldValidationErrorResponse(message, fieldErrors)`
  and `FormSubmitRequest(values)` both satisfy this; a third file for the nested `{field, reason}` shape
  would NOT (`DatasetRowValidator.FieldError` lives in `domain/engine`, which the guard does not scan) —
  keep it as a `$def`, as tasks 1.7's two-file list already implies.
- `FormPanelConfig.read` tolerates an absent `dataSourceId` by producing `DataSourceId("")`
  (`FormPanel.scala:63-67`, read-path tolerance), and `FormPanel.dataSourceId` returns `None` for it;
  the write path's `validateConfig` rejects it (:174). D4 enumerates 404/400/403 but not "form panel with
  an unbound source". `findByIdOwned(DataSourceId(""))` will produce a 404, which is acceptable — worth
  one sentence in D4 so it is a decision rather than an accident.
- `FormSubmitSpec.writeMode` is already pinned to `append` at config time (`validateConfig` :178-180), so
  the submit path needs no writeMode branch. Recording that it was considered would close the question.
- D9 says `Textarea` keeps Enter, but says nothing about `Select`'s trigger (a `button`) swallowing
  Enter; the spec scenario only claims Enter-in-`text` submits, so this is consistent — just untested.
