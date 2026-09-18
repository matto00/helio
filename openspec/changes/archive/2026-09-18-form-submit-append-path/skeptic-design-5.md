## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Cold review at `HEAD = b1b954e364b1725787e28c0d86540c910c1fc460`. The prior reports, the premise
validation and the orchestrator's round-4 closure summary were read as claim sets only; every
closure below was re-derived from the worktree's code.

### What I verified (with evidence)

**Round-4 CR (the two D6 clauses both claiming an unusable-`options` `select`) — GENUINELY CLOSED
via option (a), and the two clauses are now disjoint rather than re-worded.**

- Clause A (`design.md` D6) is now scoped to "an EDITABLE `select`"; the "(or whose `options` is not
  a non-empty array)" parenthetical is gone. Clause B covers "ANY field for which
  `computeFormIssues` returns an issue (orphaned, unfit, unusable options, duplicate, bad
  step/initialValue, …)". Disjointness is real, not verbal: a `select` whose `options` is not a
  non-empty array IS flagged by `computeFormIssues`
  (`frontend/src/features/panels/state/formConfigValidation.ts`, `if (field.control === "select") {
  if (!isOptionsArray(field.options)) … "Options must be a non-empty list" }`, `isOptionsArray` =
  `Array.isArray(value) && value.length > 0`), so it lands only in clause B, and an editable
  (issue-free) `select` necessarily has a non-empty valid-typed array — clause A's case.
- Clause A is implementable for its remaining case: the issue-free field reaches
  `FormFieldControl.tsx`'s default branch, which DOES pass `error`/`errorId` into `FormField`
  (`:74-99`), unlike the `file` (`:47-64`) and `issue` (`:66-72`) branches, which pass only
  `hint`/`hintId`. Clause A is also still reachable: `useFormPanelValues` re-seeds only when
  `fieldsKey` (the `sourceField` list) changes (`:49-51`, `:64-68`), so an options edit that keeps a
  usable array leaves a stale selection in `values` while the field stays editable.
- Clause B's rule is now single-valued: optional AND holding no value → skipped (matches D3's
  server-side "unsupplied optional undeclared field is ignored"); required (`field.required ===
  true` alone for an undeclared field — the only implementable rule, since
  `isFieldRequired(field, declared)` dereferences `declared.required`,
  `formFieldValidation.ts:19-21`) OR holding a non-empty value → block up front, announced
  form-level summary, no request, focus per D8. No silent-drop reading survives (C3).
- The rule is carried in spec prose, not only scenarios: `specs/form-panel-submit/spec.md`'s
  client-validation requirement states both halves, with scenarios "An optional non-editable field
  holding no value is skipped" and "A stale value in a select whose options became unusable blocks
  submit, never dropped". Tasks 2.2, 3.4 and 3.6 each carry both branches, including the previously
  missing "optional `select` with `options: []` HOLDING a non-empty value → form-level summary, no
  request" case.
- D7's `seedValueFor` change is real and load-bearing: today `seedValueFor`
  (`ui/form/useFormPanelValues.ts:33-39`) returns `String(field.initialValue)` for every non-checkbox
  control including `file`, so without the change an optional `file` field with an `initialValue`
  would "hold a non-empty value" and permanently block submit under clause B. Tasks 2.3/3.5 pin it.

**Orchestrator self-review item (1) — D3's "rules per field in order, first match wins, collected
across fields" introduces no contradiction.** One error per field, every field's error collected, is
consistent with `tasks.md` 1.2 ("all errors collected") and 3.1 ("multiple errors collected" — the
listed cases are one per field). The precedence D3 already asserts ("this reason wins over
`required`") is exactly first-match-wins, so (iii) and (v) no longer both fire. (i) is keyed on
submitted keys rather than configured fields; that is not a fork — 3.1 tests it as its own case.
Blank-is-not-supplied (iv) feeding (v) rather than (vi) is likewise deterministic.

**Orchestrator self-review item (2) — D4's authorization is decidable exactly as written.**
`Panel.ownerId: UserId` is on the trait (`domain/model/Panel.scala:48`), so `panel.ownerId !=
user.id` is decidable from the sharing-aware read alone
(`PanelRepository.findById(id, callerOpt):130`, documented "Sharing-aware read … no existence
leak"). `DataSourceRepository.findByIdOwned:155-160` filters `id === … && ownerId === caller`, so it
genuinely cannot distinguish unowned from nonexistent — the earlier `403` would have been
unimplementable and the `404` is the only sound mapping. The reused message is real and pinned:
`DataSourceService.appendRows` maps `findByIdOwned` `None` → `ServiceError.NotFound("Data source not
found")` (`services/sources/DataSourceService.scala:764-769`). `ServiceError.Forbidden`/`NotFound`
exist (`services/ServiceError.scala:21-22`) and `statusCodeFor` maps them to 403/404
(`api/routes/ServiceResponse.scala:76-86`, `private[routes]` — the `DashboardAuthoringRoutes.scala:51-62`
route-local-completion precedent D5 cites is verbatim there). D4's rationale that the panel owner is
the source owner is also true rather than assumed: both `rejectMissingDataSource` and
`rejectInconsistentForm` resolve the binding through `findByIdOwned(user)` at create/patch time
(`PanelService.scala:508-531`, `:548-578`), and production wires `dataSourceRepo`
(`ApiRoutes.scala:262`), so the check is not fixture-only. The spec's authorization requirement and
its three scenarios follow the same order (404 invisible → 400 non-form → 403 non-owner → 404 source).

**Orchestrator self-review item (3) — the spec's focus clause no longer contradicts the
mixed case.** The client-validation requirement now says focus "follows the editable-field rule
above and remains on the submit button when no editable field failed", which is exactly D8 ("the
first `[aria-invalid="true"]` control … otherwise focus stays on the submit button"). The
announcement requirement's fallback now reads "does not render or renders non-editably" and scopes
invalid-marking to a "rendered editable control", closing round 4's non-blocking note. Task 2.4 and
3.6 state the same focus rule.

**Also re-checked.** Rounds 1–3 closures still hold against code:
`DatasetRowValidator.validateRow` still treats a cell as missing only when `raw == JsNull` and
substitutes `field.default` before the `required` check, and `validateValue` accepts any `JsString`
for string types (`domain/engine/DatasetRowValidator.scala:117-147`), so D3(iv)/(v) genuinely cannot
live in the declared-schema validator; `validate` is the only public row entry point, so 1.1's
`validateRowStructured` extraction is additive. `appendRowsAction` is already
`private[persistence]` with the lock → fresh declaration → validate → insert → inferred-schema
refresh shape D3 composes (`DataSourceRepository.appendRowsAction`), so the
`insertAppendedRowsAction` extraction and `appendBuiltRow` seam are mechanical and leave
`applyWriteBacks` untouched. `RowWriteResponse(rows, updatedAt)` / `RowWriteRowResponse(id, seq,
updatedAt)` exist (`api/protocols/sources/DataSourceProtocol.scala:262-270`), matching D2. The drift
guard keys only on each file's top-level `title` and diffs top-level `properties` against a
case-class param list (`scripts/check-schema-drift.mjs:120-158`, recursive walk covering
`schemas/shared/`), so D5's two titled schemas with a `$defs` `{field, reason}` entry satisfy it
without editing the guard or its SKIP set; neither `FormSubmitRequest` nor
`FieldValidationErrorResponse` collides with an existing case class. `config.submit.label` /
`resetOnSuccess` exist on both sides (`FormPanel.scala:139-150`, `types/panel.ts:193-199`), so D9/D8
are configurable as written. `PanelIdSegment / "duplicate"` is the routing precedent D1 copies
(`PanelRoutes.scala:78`). `openspec/config.yaml:35` carries the endpoint list 1.7 amends. C1–C8 are
in `tasks.md` `## Standing Constraints` and mirrored verbatim in `workflow-state.md` `CONSTRAINTS`.

**No round-1, round-2, round-3 or round-4 change request survives.** I found no new contradiction
between D3, D4, D6, D8, the spec and `tasks.md`: I traced the full client→server matrix for each
field shape (editable valid / editable stale-select / optional non-editable empty / non-editable
holding a value / required non-editable / unconfigured declared / undeclared optional / undeclared
required) and every cell has exactly one behaviour, stated the same way in D3, D6, the spec prose
and at least one task.

### Verdict: CONFIRM

The design is implementable as written and every prior finding is closed against code rather than
re-worded. The three notes below change no required behaviour and none of them blocks an
implementer, so they are notes and not change requests.

### Non-blocking notes

1. **One reachability premise repeated since round 1 is false, and it is now embedded in a spec
   scenario's `WHEN`.** `design.md`'s Context says "`validateConfig:155-156` only checks `options`
   presence, so `[]`/`{}`/`5` persist". `FormPanel.validateConfig` indeed only rejects an *absent*
   `options` ("select field requires options"), but the service layer rejects the rest:
   `FormSchemaConsistency.checkOptions` returns "options must be a non-empty array" for both
   `JsArray(empty)` and any non-array (`domain/panels/FormSchemaConsistency.scala:47-59`), and it runs
   on the EFFECTIVE post-patch config for both create and update via
   `PanelService.rejectInconsistentForm` with `dataSourceRepo` wired in production
   (`PanelService.scala:216`, `:548-578`; `ApiRoutes.scala:262`). `validateConfig` also requires a
   non-empty `dataSourceId` ("dataSourceId is required"). So for a bound form panel, an unusable
   `options` value — and an unbound `DataSourceId("")` — cannot be reached through the panel write
   API; the new scenario's premise ("options were edited to an empty list while the panel was open"
   would 400) is not producible end-to-end. Nothing is unimplementable: D3(vi) and clause B stay
   correct defense-in-depth, and tasks 3.4/3.6 construct the config directly at unit/component
   level, where the case is perfectly testable (no e2e leg depends on it). The reachable sibling that
   exercises the identical clause-B path is a *dataset type change* that makes previously valid
   options invalid (`computeFormIssues`'s "Option … is not a valid `<type>` value"). Worth
   re-wording that scenario and the D6 parenthetical to the type-drift framing, and softening the
   Context sentence, so no later reader treats an impossible transition as the justification.
2. **D7 fixes prefill-blocks-submit for `file` but not for issue fields.** `seedValueFor` has no
   notion of issues, so an *optional orphaned* (or bad-`initialValue`) field carrying a configured
   `initialValue` seeds a non-empty value and, under clause B, permanently blocks submit while its
   control renders empty. D6 does state this explicitly ("a stale entry or a prefill the renderer can
   no longer show as sendable") and records the panel as unsubmittable until fixed, so the behaviour
   is chosen, not accidental — but tasks 3.4/3.6 only cover the user-typed stale value. Either
   extend D7's rule to "never seed a prefill into a non-editable field" (mirroring the `file` fix) or
   add the prefilled-orphan case to 3.4 so the chosen behaviour is pinned.
3. **The spec's authorization requirement does not enumerate "the bound source exists but is owned
   by someone else".** Under `findByIdOwned` that also yields `404 Data source not found`, which is
   consistent with D4 and near-unreachable given the config-time ownership invariant; one clause
   ("or is not the caller's") would make the spec describe the implementation exactly.
