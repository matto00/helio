## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD `a1cfd19dc09bca372654deae23d5fac376bf1157`. The change dir is untracked and there is no code change yet.
I treated owner rulings 1–3 (escalation `HEL-1784-1795077466035-790706`) as settled scope.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/editors-submit-form-panels/HEL-1784`.

**Round-2 revisions**

- **R1 (counter row shape not enforced on submit): addressed in intent.**
  - D4a (design.md:150-157) adds the check under the lock.
  - The spec adds "A counter submit is refused when the dataset no longer has the counter row shape" (form-panel-submit spec:229-243).
  - D6 (:202-204) no longer claims a false safety property.
  - Task 2.1 adds the renamed-`occurred_at` test.
  - Two defects in how it is written are covered by CR 1 and CR 2.
- **R2 (mapping wraps both submit branches): addressed.**
  - D4 "Where" (:145-149) names both branches and the pre-lock `buildRow` `Left` at `PanelFormFileSubmission.scala:54-55`, which I re-read.
  - Task 2.1 includes the multipart test (no unbound field named, no file stored).
- **R3 (typed reason): addressed.**
  - D4 (:142-144) adds `FormSubmitError.reason` (`FieldErrors | RowLimit | SourceKind | Other`), set where each failure is produced.
  - That matches the real producers: `DataSourceService.scala:868-876` and `PanelFormFileSubmission.scala:54-55`.
  - D4 (:140-141) now lists the source-kind message.
- **R4 (stale proposal line): addressed.** proposal.md "What Changes" now reads "named viewer → 403; no named grant (incl. public) → 404".
- **R5 (`skipCounterRowShape` threading): addressed.**
  - D6 (:199-202) names the option and both files.
  - C18 (tasks.md:14) allows `state/formConfigValidation.ts` and `state/formSubmission.ts`.
  - Task 5.1 adds the stacked-form jest case.
  - I re-confirmed the call sites by grep: `formSubmission.ts:112,167,212,247` and `FormPanelView.tsx:121`.
  - `FormEditor.tsx:58` also calls it. The default of `false` leaves that caller unchanged, which is correct.

**Question 1: is D4a's under-lock check feasible inside the `build` closure contract? Yes.**

- **The contract fits.** It is `(Vector[DatasetFieldDeclaration], Instant) => Either[Vector[FieldError], Vector[JsValue]]` (`DataSourceRepository.scala:656-663`). The closure receives the declaration read under `lockSource` (`:672-680`). `panel.config` is already captured by both closures (`PanelService.scala:125-126`, `PanelFormFileSubmission.scala:58-59`). A counter-shape failure can return `Left(Vector(FieldError("occurred_at", …)))`, and `appendBuiltRowAction` then writes nothing (`:683`).
- **One plumbing detail.** `FormSchemaConsistency.checkCounterRowShape` is `private` and returns `Option[String]` (`FormSchemaConsistency.scala:43-64`). It needs to be exposed or wrapped. That is trivial.
- **Placement (non-blocking).** D4a puts the check "in the build closure (and the file path's pre-lock check)", which means three sites. Putting it in `FormSubmission.buildRow` covers all three at once.
- **Existing tests.** The `FormSubmissionSpec` counter tests (`:238-298`) all use a complete `delta`/`occurred_at`/`value` declaration, so the check does not break them.

**Question 2: does "declared names carried in the Left" work for both paths? No.**

- **The in-lock path cannot carry the names as specified.**
  - `build` returns only `Vector[FieldError]`.
  - `appendBuiltRowAction` wraps it as `FormRowBuildFailure.FieldErrors(errors)` (`DataSourceRepository.scala:683, 1130`), which carries no declaration names.
  - To carry them, `FormRowBuildFailure.FieldErrors` (a repository type) would have to change. D4 does not say so, and proposal.md Impact does not list `DataSourceRepository`.
- **The pre-lock file path could attach them,** since `declaration` is in scope at `PanelFormFileSubmission.scala:51-53`.
- **The plumbing is not needed, and the rule it serves is wrong.** That rule is D4's "Unknown keys" refinement, which I suggested in round 2. See CR 1.

**Question 3: does D4a's owner direct-API change need a human ruling? No. I judge it acceptable without one.**

- It enforces the same rule the server already applies at configure time: HEL-1089 Decision 3a, `FormSchemaConsistency.checkCounterRowShape`, reached via `FormBindingValidator`.
- It fails closed, and only on the direct API: the owner's UI already disables that control (`formConfigValidation.ts:179` → `FormFieldControl`).
- The behavior it removes is a `201` that writes a counter event with no usable `occurred_at`. That is silent corruption, not a feature anyone relies on.
- The only client of the submit route is the web app. I grepped `.ts/.tsx/.scala` outside tests: only `panelService.ts`/`formSubmission.ts`/`FormPanelView.tsx`/`FormRenderer.tsx` reference it, and no helio-mcp tool does.
- D4a and the spec state the change explicitly. This is the orchestrator's call, and it is sound.

**New defects the revisions introduced**

- **D4's "Unknown keys" rule (design.md:137-139) creates a declared-field-name oracle.**
  - `buildRow` emits `FieldError(k, "not part of this form")` for any request key outside the configured names. That check is independent of the declaration (`FormSubmission.scala:73-75`).
  - Under D4 as written, the non-owner response depends on the declaration:
    - **guess is declared:** the error is dropped, and the message becomes "This form no longer matches its dataset…";
    - **guess is not declared:** the error is kept, and the response says `field 'guess' — not part of this form`.
  - So an editor can send `{"values": {"delta": 1, "guess": 1}}` and learn from the response whether `guess` is a declared field. They can repeat this for any name. That breaks the Goal at design.md:54-55 ("learns nothing about the dataset beyond the bound fields' declarations") and the spirit of the spec requirement "A non-owner submitter learns nothing of the dataset beyond the form's own fields".
  - My round-2 note suggested this rule, and that suggestion was wrong.
- **The same rule contradicts D4a and its own spec scenario.**
  - D4a's error names `occurred_at` (or `value`).
  - In the spec's exact test case, a renamed `occurred_at` (also a dropped `occurred_at`, or a dropped `value`), the name is NOT in the locked declaration. D4's rule therefore keeps the error, and the non-owner gets `field 'occurred_at' — counter field requires the bound dataset to declare a field named 'occurred_at'`.
  - The spec scenario (spec:236-239) and task 2.1 require the generic message instead. An implementer who follows D4 literally fails the test the plan prescribes.
  - D4a's own sentence (:156-157), "A non-owner gets D4's generic message because `occurred_at`/`value` are not configured fields", assumes a configured-names-only filter. That is not the filter D4 specifies.
- **The counter row shape is misdescribed.**
  - Design Context (:28-29) says the check needs `occurred_at` "and a numeric `value` if declared". The new spec requirement (spec:231-233) says "a timestamp `occurred_at` and, if declared, a numeric `value`".
  - Both real checks REQUIRE `value` to be declared, numeric and not required:
    - server: `FormSchemaConsistency.scala:55-62` ("requires the bound dataset to declare a field named 'value'");
    - client: `formConfigValidation.ts:210-227`.
  - D4a says it reuses "`FormSchemaConsistency`'s counter row-shape check". With `value` dropped, that check refuses the submit, while the spec text says the submit is allowed. Spec and design disagree on a testable behavior.

**Other checks**

- I re-read `appendFormRow` (`DataSourceService.scala:859-878`), `submitForm` (`PanelService.scala:115-131`) and `submitFormWithFiles` (`PanelFormFileSubmission.scala:42-73`). D2's owner-principal plan and D4's mapping point are still consistent with them.
- Owner rulings 1–3 are reflected in C15–C17, D6, D3 and D4. I found no drift from them.
- **Gate defect check (mtime evidence):** not applicable. No evidence directory or mtime-ordering claim is involved.

### Verdict: REFUTE

### Change Requests

1. **Make D4's non-owner field-error filter independent of the declaration, and drop the "declared names in the Left" plumbing.**
   - **The problem:**
     - design.md:137-139 keeps an error only when its name is not declared. That gives a declared-field-name probe (above).
     - It also keeps D4a's `occurred_at`/`value` errors when those names were renamed or dropped, which contradicts the D4a text, spec:236-239 and task 2.1.
     - The "declared names carried in the Left" mechanism (:148-149) has no specified carrier on the in-lock path: `FormRowBuildFailure.FieldErrors` holds only errors.
   - **Required:**
     - For a non-owner, drop every field error whose `field` is not one of the form's configured `sourceField`s, whatever the declaration says. That includes "not part of this form" errors and D4a's `occurred_at`/`value` errors. When any is dropped, use the generic message.
     - Remove the "Unknown keys" bullet and the "declared names" clause, so the mapping needs only the configured names.
     - If you would rather keep "not part of this form" errors for a malformed request, keep them **uniformly**, regardless of the declaration. Identify them by a typed origin, not by declaration membership. D4a's errors must still map to the generic message.
   - **Tests (task 2.1):**
     - Replace the "unknown request key keeps its error" case with this one: an editor submits an extra key that IS declared but unconfigured, and an extra key that is NOT declared. Assert that the two `400` bodies are byte-equal when the same configured values are sent.
     - Keep the renamed-`occurred_at` → generic-message case. Add a dropped-`value` variant.
2. **Describe the counter row shape the way the code enforces it.**
   - **Where to change:** design.md Context :28-29 and the form-panel-submit spec requirement :231-233.
   - **What to state:** the shape is a `timestamp` field named `occurred_at` AND a numeric, non-required field named `value` (`FormSchemaConsistency.scala:49-62`, `formConfigValidation.ts:196-227`).
   - **If you want "`value` optional at submit" instead:** D4a must say it uses a relaxed variant rather than "`FormSchemaConsistency`'s check", and must explain why it diverges from the configure-time rule.
   - **Either way:** design and spec must agree, and the spec scenario list should include the dropped-`value` outcome.

### Non-blocking notes

- **Put the D4a check inside `FormSubmission.buildRow`** (gated on a counter field), and expose a public wrapper over the private `checkCounterRowShape`. One edit then covers the JSON closure, the file path's in-lock closure and its pre-lock pass. Spreading it over three sites is how one gets missed.
- **List the `FormSubmitError.reason` assignment for the `NotFound` cases** (source gone, unbound) as `Other`, so nothing falls through untyped.
- **The editor's repeated `+` against a broken-shape form** gets the generic error and a rollback on each click. The e2e could assert that the announced text is the generic message.
