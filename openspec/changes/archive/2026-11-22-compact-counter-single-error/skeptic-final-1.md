## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 28562242817205b68eb352b07c7ce41bad47c1f0. The base was resolved live with resolve-review-base.sh: d350dd7ae9fb0a5f790cbb8c169a5b8cc6ea4fe4.

### What I verified (with evidence)
- **Spawn guard:** assert-cwd.sh returned READY on the branch `bug/compact-counter-single-error/HEL-1818`.
- **Diff (`git diff BASE...HEAD -- frontend e2e`)**
  - `FormFieldControl.tsx` adds the optional `errorDescriptionId` prop. When `error` is set and this prop is present, `FormField` gets `error=null`, so no `.ui-form-field__error` paragraph renders. The control stays invalid, and the base `aria-describedby` becomes the external id with the caption id still appended.
  - `FormPanelView.tsx` changes only the compact branch: `useId()` on the always-mounted `<p role="alert" class="form-panel-view__alert">`, passed as `errorDescriptionId`. `handleImmediateStep` and the multi-field branch are unchanged.
  - This matches C1, the owner ruling `form-alert-B`. C2 holds: the hel1791 spec is not in the diff.
- **AC1, a test that is red on the old code:** two new tests in `FormPanelView.test.tsx`.
  - They check that the panel text contains the message once, that exactly one `role=alert` in the panel holds it and it is the form alert, that there is no field error, `aria-invalid`, that `aria-describedby` contains the alert id, that the accessible description equals the message, and that the status region is still mounted. A second test covers a repeated identical rejection: the alert empties at the next step's start and then refills.
  - `red-run.txt` shows both tests failing on the old code at test lines 580 ("Received length: 2", the duplicate) and 614. I confirmed those line numbers match the committed test file.
- **Multi-field form unchanged:** the existing multi-field rejection test now also asserts that `.ui-form-field__error` still shows "expected integer" next to the alert summary. It passes.
- **Gates, re-run by me:**
  - jest on `src/features/panels/ui/form` (3 workers): 5 suites, 91/91 passed.
  - `tsc --noEmit`: clean.
  - eslint `--max-warnings=0` on the form directory and the new e2e spec: clean.
  - prettier `--check`: clean.
- **AC2, rendered and announced in light and dark at 390 and 1440 px:**
  - I started the servers with start-servers.sh (lane DB helio_hel1818); assert-phase servers returned PASS.
  - I ran `e2e/hel1818-compact-counter-single-error.spec.ts` (4 cases) together with the hel1791 spec (6 cases) with `--workers=2`: 10/10 passed.
  - The new spec asserts, in each theme and width, that the alert holds the text, `aria-invalid`, the accessible description, no field error, exactly one `role=alert` in the panel holding the message, and that the text appears once in the panel.
- **Visual judgment:** I looked at the screenshots myself. In all four the message appears once, centred under the counter, in the error colour (`--app-error`, `--text-xs`). The value is styled invalid. It reads well in light and dark, with no layout shift and no duplicated line. Persisted evidence:
  - /home/matt/Development/helio/.concertino/runs/HEL-1818/evidence/e2e-evidence/HEL-1818/single-error-dark-390.png
  - /home/matt/Development/helio/.concertino/runs/HEL-1818/evidence/e2e-evidence/HEL-1818/single-error-light-390.png
  - /home/matt/Development/helio/.concertino/runs/HEL-1818/evidence/e2e-evidence/HEL-1818/single-error-light-1440.png
  - /home/matt/Development/helio/.concertino/runs/HEL-1818/evidence/e2e-evidence/HEL-1818/single-error-dark-1440.png
- I stopped the servers with stop-servers.sh (STOPPED ports=7250,10157).
- No mtime-ordering evidence was relied on.

### Verdict: CONFIRM

### Non-blocking notes
- Edge case not listed in design.md Risks:
  - The sequence: a definite rejection, then a later click that fails indeterminately and whose reconciliation fetch succeeds.
  - The result: `alertText` is cleared at that click's start and never refilled, while `externalErrors` is still set. The control then stays `aria-invalid="true"` and red, its `aria-describedby` points at an empty alert, and no text is shown anywhere until a later success clears it.
  - Before this change the stale field text stayed visible. The stale-invalid state itself pre-dates this ticket (HEL-1169: an indeterminate settle never clears `externalErrors`).
  - This is related to the "in-flight empty description" trade-off the owner accepted. It is worth recording in the PR body or in a follow-up, for example clearing `externalErrors` when reconciliation succeeds.
- The mutation checks in task 2.3 were not re-run by me. The red run on the old code is self-consistent with the committed test line numbers.
