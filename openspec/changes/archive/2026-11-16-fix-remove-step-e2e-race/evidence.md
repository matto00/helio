# HEL-1711 evidence

## Natural local red: NONE obtained

No natural (unforced) local red was obtained. Per design.md Decision 1 the CI trace is the natural red and a forced-race
mutation is the local red. Unmodified spec, item 7, against this worktree's servers (DEV_PORT=7143, BACKEND_PORT=10050):

- `DEV_PORT=7143 BACKEND_PORT=10050 nice -n 19 npx playwright test e2e/hel1685-draft-polish.spec.ts -g "item 7" --repeat-each=20 --trace retain-on-failure --workers=2` -> 20 passed (1.6m).
- Same command with `--repeat-each=30` while two `nice -n 19 sh -c 'while :; do :; done'` busy-loops (each wrapped in `timeout 400`, run in the background) loaded the CPU -> 30 passed (2.4m).

## Natural red: CI trace (run 43949524653, job 133587986311)

Trace at `.concertino/scratch/HEL-1711/trace3/` (not committed):

- The first `POST /draft/save` request body has steps sort `37cfa1c0` and compute `ce6da272` only: the filter step `a01caaef` is missing.
- It returned 422 `CASCADE_CONFIRMATION_REQUIRED` with `stepIds:[a01caaef (Filter rows)]`, `outputIds:[70ce139d (Run duration chart)]`.
- After the confirmed save, `POST /preview?outputId=b581d5f4` (metric "Avg minutes", the watched Output on the compute step) returned 200. That Output was never removed, so the preview was legitimate.
- At the Remove-step click the focused section was still "Step 1 Filter rows" although the URL already had `?step=<compute id>` (selection lag). Cause: test race (click on `Step 3:` then unscoped `Remove step` with no wait for the card).

## Forced race (executor mutation, spec temporarily edited, then restored)

```ts
const step3 = await page.getByRole("button", { name: /^Step 3:/ }).elementHandle();
const rm = await page.getByRole("button", { name: "Remove step" }).elementHandle();
await page.evaluate(([a, b]) => { (a as HTMLElement).click(); (b as HTMLElement).click(); }, [step3, rm]);
```

With the new dialog assertion, `--repeat-each=2 --workers=2`: 2 failed, both:

```
Error: removal must name the watched Output
Expected string: "Avg minutes"
Received string: "This save removes other thingsConfirm to save the draft and remove everything listed here.Step: Filter rowsOutput: Run durationKeep editingRemove and save"
```

This matches the CI cascade (filter step + Run duration chart removed).

## Evaluator variant M2 (cycle 1 evaluation-1.md)

Evaluator spec `.concertino/scratch/HEL-1711/eval/m2-nodialog.spec.ts` (same forced race via one `page.evaluate`, original assertions, no dialog check; I read the spec, I did not re-run it). Reported result: red with the exact CI signature, focused region afterwards "Step 1 Sort rows", dialog listed "Output: Run duration", failure at `requests naming the removed Output` with one `POST .../preview?outputId=<watched metric>`.

## Fixed spec

- Item 7, `--repeat-each=20 --workers=2`: 20 passed (1.7m).
- `hel1685-draft-polish.spec.ts` + `hel1631-draft-mode.spec.ts` in full: 15 passed (56.2s). Evaluator: 15/15 and item 7 10/10.
- eslint and prettier --check on both specs: exit 0.
