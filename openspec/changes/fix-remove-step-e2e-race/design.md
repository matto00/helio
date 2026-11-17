## Context

See proposal.md (Why). The spec under repair is `e2e/hel1685-draft-polish.spec.ts:252`. It seeds a linear chain
filter → sort → compute with Outputs chart (on filter), table (on sort) and metric "Avg minutes" (on compute,
`outputIds[2]`, the watched Output), opens the pipeline, clicks the spine row `Step 3:` and then the unscoped
`getByRole("button", { name: "Remove step" })`.

Selection is URL state (`frontend/src/features/pipelines/hooks/useStepSelection.ts`, `?step=` written with
`setSearchParams`); the default selection is the trunk's first step. The focused editor is a
`<section aria-label="Step N <label>">` (`ui/StepCardFocused.tsx`) that holds the only "Remove step" button. The
spine row's accessible name is `Step N: <label>, …` (`ui/spine/SpineStepRow.tsx`).

CI trace evidence (run 43949524653, `.concertino/scratch/HEL-1711/trace3/`): the Remove-step click's input snapshot
shows the focused section "Step 1 Filter rows"; the 422 cascade response names step `a01caaef` (filter) and Output
`70ce139d` (chart); the saved definition still contains `b581d5f4` (metric), whose preview then returns 200. So the
watched Output was never removed: the assertion fired on a legitimate preview.

## Goals / Non-Goals

**Goals:** a local red reproduction and a probe-confirmed root cause; a spec whose Remove-step click is guaranteed to
target Step 3; a failure message that names the real problem if the wrong step is ever removed again.

**Non-Goals:** changing selection, preview or save behaviour in the product; widening any timeout; adding retries;
a sweep of every e2e spec (only the one other identical `Step 3:` → `Remove step` site, hel1631:250-252).

## Decisions

1. **Probe before fixing.** Reproduce with `npx playwright test e2e/hel1685-draft-polish.spec.ts -g "item 7"
   --repeat-each=N --trace retain-on-failure --workers=2` (raise N until it fails, or add CPU pressure via `nice`'d
   load if it will not fail locally; record what was needed). From the failing local trace, record which step the
   cascade removed and what the focused section was at the Remove-step click. A green-only local run is not a
   reproduction; if no red is obtained, say so explicitly and use the CI trace as the red, with a mutation that forces
   the race (e.g. temporarily clicking Remove step with no wait after re-selecting) to show the new wait closes it.
2. **Branch on the probe.** If the selection merely lags the click (the focused section becomes Step 3 shortly after),
   it is a test race → Decision 3. If the selection reverts or never moves (a product defect), or a preview is requested
   for an Output the save actually removed, STOP and raise an ESCALATION: the plan becomes a product fix with a red-first
   unit/seam test, which needs a new design gate.
3. **Wait on the focused section, scope the click.** After clicking `Step 3:`, take
   `const focused = page.getByRole("region", { name: /^Step 3 / })` (or the equivalent section locator — verify the
   role the `<section aria-label>` exposes), `await expect(focused).toBeVisible()`, assert it names the compute step,
   then `focused.getByRole("button", { name: "Remove step" }).click()`. A locator wait is web-first and deterministic;
   no `waitForTimeout` is added. Alternative rejected: waiting on the `?step=` URL param — it proves the URL changed,
   not that the button rendered for the new step.
4. **Self-checking dialog.** Assert the "Confirm removals" dialog contains "Avg minutes" before confirming, so a
   wrong-step removal fails at the dialog with a clear message.
5. **Same fix at hel1631:250-252**, which uses the identical unscoped pattern (it only asserts the spine count, so the
   race would not fail it today, but it can remove the wrong step and test a different draft than intended).

## Risks / Trade-offs

- [The race does not reproduce locally] → Decision 1's documented fallback (CI trace as the red + forced-race
  mutation); never claim a local red that did not happen.
- [The section's ARIA role differs from `region`] → verify in the DOM/trace before writing the locator.
- [Other assertions in the test still depend on timing (`networkidle` + 3 s window)] → out of scope unless the probe
  shows they contribute; note any finding in the report.

## Planner Notes

- Self-approved: test-only change, `skip_specs: true`; the ticket allows "the test's wait is made deterministic".
- Driver claims checked at Setup (premise-validation evidence): run 43963094133 did not fail this test; "#1120 saw 4
  requests" could not be verified.
