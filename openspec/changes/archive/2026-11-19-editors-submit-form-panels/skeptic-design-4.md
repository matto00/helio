## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at HEAD `a1cfd19dc09bca372654deae23d5fac376bf1157`. The change dir is untracked and there is no code change yet.
I treated owner rulings 1–3 (escalation `HEL-1784-1795077466035-790706`) as settled scope.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/editors-submit-form-panels/HEL-1784`.

**Round-3 CR 1 (declaration-independent non-owner filter): addressed.**

- **Design.** D4 (design.md:131-141) drops every field error whose `field` is not a configured `sourceField`, regardless of the declaration. That explicitly includes "not part of this form" errors and D4a's `occurred_at`/`value` errors. Any drop switches the message to the generic one.
- **Plumbing removed.** The "Unknown keys" bullet and the "declared names carried in the Left" clause are gone. A grep for `declared names|unknown key|keeps its error` over design/proposal/tasks/specs returns nothing. D4 "Where" (:147-152) says the mapping needs only the configured `sourceField`s and the writer.
- **Probe-proofness, checked against the code.** In `FormSubmission.buildRow`:
  - `unconfiguredErrors` (`FormSubmission.scala:73-75`) depends only on request keys vs configured names (plus `injectedKeys`, which is declaration-independent).
  - `perField` errors depend only on configured fields.
  - Any non-empty `allErrors` returns `Left` before `DatasetRowValidator` runs (`:142-146`).
  - So for identical configured values, a declared-unconfigured extra key and an undeclared extra key yield identical errors once non-configured entries are filtered. The generic message replaces `fromFieldErrors`'s name-bearing message (`FormSubmitError.scala:20-22`). The byte-equal claim holds.
- **Spec.** The form-panel-submit spec has the scenario "An editor cannot probe which fields the dataset declares" (spec:264-267), requiring identical bodies.
- **Tasks.** Task 2.1 has the byte-equal probe case and the dropped-`value` variant. The old "unknown request key keeps its error" case is gone.

**Round-3 CR 2 (counter row shape as the code enforces it): addressed.**

- Context (design.md:27-30) now says `occurred_at` and "a numeric, non-required `value`".
- D4a (:157-159) states the exact configure-time rule and cites `FormSchemaConsistency.scala:49-62` / `formConfigValidation.ts:196-227`: a `timestamp` `occurred_at` AND a numeric, non-required `value`. Re-read; it matches `checkCounterRowShape` (None → `occurred_at` missing; non-timestamp; `value` missing; non-Integer/Float; required).
- The spec requirement (spec:231-233) says the same, and adds a "Dropped value refuses the counter write" scenario (:241-243).
- Design and spec agree.

**Round-3 non-blocking suggestions: adopted.**

- D4a puts the check inside `FormSubmission.buildRow`, through a public wrapper over the private `checkCounterRowShape` (:153-157). Every production call site goes through `buildRow`: `PanelService.scala:126` and `PanelFormFileSubmission.scala:54, 60` (grep). So one edit covers all three, and the in-lock call receives the locked declaration.
- D4 (:150-152) assigns `reason = Other` to every `NotFound`.

**New issues the revisions could have introduced: none blocking.**

- **Existing tests survive D4a.** Every counter fixture in `FormSubmissionSpec` (e.g. :239-243), `CounterEventRowModelSpec` (:67-68, :198-200, :238-240) and `FormSubmitRoutesSpec` (:707-710) declares a timestamp `occurred_at` and a non-required integer `value`. So the new check passes for them. The four counter e2e specs all reference `occurred_at`.
- **Configured `value`/`occurred_at` edge.** If a form configured a field literally named `value`, a D4a error on it would be kept for a non-owner. It would reveal only that field's declaration, which the editor already gets from the form-schema route. Not a leak.
- **Generic message on a broken counter shape.** This tells an editor that the dataset no longer fits the form, but nothing about which field. That is the intended disclosure.
- **Context claims spot-checked:**
  - `PanelService.authorizeEditorOnDashboard` exists (`PanelService.scala:315`).
  - The four `computeFormIssues` call sites (`formSubmission.ts:112,167,212,247`) and `checkCounterRowShape` at `formConfigValidation.ts:179` are as stated.
  - The latest migration is V145, so V146 is free on this HEAD.
- **Gate defect check (mtime evidence):** not applicable. No evidence directory and no mtime-ordering claim.

### Verdict: CONFIRM

### Non-blocking notes

- **proposal.md lags the design.**
  - "What Changes" does not mention the D4a behavior change: the owner's direct-API counter submit to a broken-shape dataset goes from `201` to `400`.
  - It also omits the non-owner error filtering, and the row-limit message with no number.
  - Impact does not list `FormSubmission`, `FormSchemaConsistency`, `FormSubmitError`, or the new `schemas/panels/form-submit-response.schema.json`.
  - Worth a one-line update so the PR body and archive read correctly.
- **D7 (design.md:222-227) does not list the tests.** It is missing the byte-equal probe, the renamed-`occurred_at` case and the dropped-`value` case, all of which task 2.1 does list. Tasks is the binding list, but keep the two in sync.
- **D4a does not say how the shape error combines with other errors.** For example, with a non-numeric `delta`, is it appended to `allErrors` or does it short-circuit? A non-owner gets the generic message either way. For the owner, pick one and assert it in `FormSubmissionSpec`.
- **e2e suggestion carried from round 3.** On a broken-shape counter, the editor's `+` could assert that the announced text is the generic message.
