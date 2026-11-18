# Red evidence (HEL-1746)

## 1.1 AskSeamSpec, before fixtures and schemas exist
Command: `cd backend && sbt -J-Xmx3g "testOnly *AskSeamSpec"` (copy of output: `.concertino/scratch/HEL-1746/seam-red.txt`)
Result: `Tests: succeeded 0, failed 6`; the 200 cases fail with `NoSuchFileException: ../shared-test-fixtures/ask/ask-200-no-pin.json`
(the raw-body schema check passed, then the fixture read failed); the 422/403/429 cases fail with
`could not locate schemas/ask/ask-ungrounded-response.schema.json` (and the truncated and tier-error schemas).

## 429 coverage
The harness CAN drive a 429: the spec seeds the beta user's `assistant_daily_usage` row for today above the default cap, so the real
`CHAT_LIMIT_REACHED` body is covered (no schema-only gap).

## Frontend unit tests (2.x, 3.x)
**The frontend unit tests are proven by mutation, not by a red run.** They were written against the module as it was built, not before it, so
there is no "module missing" red run for them. Their proof is the mutation table in `mutations.md` (M2-M28): each guard was shown to fail when its
behaviour is removed, and restored.
The only red-first runs are the backend seam (above), the BottomSheet `size` prop (below) and the e2e spec (see the e2e section).

## 3.0 BottomSheet size
With `BottomSheet.tsx` and `Modal.tsx` stashed (no `size` prop, `ModalSize` not exported): `BottomSheet.test.tsx` failed to compile
(`TS2339: Property 'size' does not exist on type 'BottomSheetProps'`), and the CSS-text guard ran 3 tests with the comment-stripping bug
(2 failed, since fixed in the test itself).

## 4.1 e2e, before the UI exists
With `App.tsx`, `CommandBar.tsx`, `DashboardMetaRow.tsx` and `OutputEditorSheet.tsx` stashed (no Ask opener, no drawer, no sheet group),
`e2e/hel1746-ask-ui.spec.ts -g "keyboard-only drawer.*light desktop"` (DEV_PORT 7178, 1 worker) fails at the first UI step:
`expect(getByRole('button', { name: 'Ask about this dashboard' })).toBeVisible() failed ... element(s) not found, timeout 15000ms`
(`.concertino/scratch/HEL-1746/e2e-red.txt`). The seed (user, source, pipeline, outputs, dashboard) had run against the real backend.
