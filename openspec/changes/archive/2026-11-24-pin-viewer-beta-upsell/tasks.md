## Standing Constraints

- [C1] Liveness of the viewer link is proved by clicking it (e2e popup at /settings#beta-access, original tab keeps the sheet), never by toBeEnabled on an anchor; every locator is scoped to the History card (h3 History closest card), never page-wide; mutation (a) red evidence shows viewer+default red and editor green in the same run.

## 1. Live verification (before any test)

- [x] 1.1 Start lane servers (start-servers.sh, lane DATABASE_URL, ANTHROPIC_API_KEY empty) on the unmodified worktree; as a real viewer grantee on a free-owned shared pipeline, open a saved non-insight Output's sheet in light and dark; record what is shown and the conditions (owner tier, Output kind, saved vs create, viewer tier, and whether the Ask disclosure was expanded) in `openspec/changes/pin-viewer-beta-upsell/live-verification.md` with screenshots under the main checkout's `.concertino/runs/HEL-1838/evidence/`. If the viewer does not see the link, STOP and return ESCALATION with the evidence.

## 2. Jest pin (D1)

- [x] 2.1 Add `OutputEditorSheet.viewerUpsell.test.tsx` covering viewer, editor and default-readOnly, scoped to the History card; verify the file passes.
- [x] 2.2 Mutation-red: gate the link on read-only, then on pipeline ownership; record each red jest run as `.txt` under the change dir and commit; revert each mutation and verify green.

## 3. e2e pin (D2)

- [x] 3.1 Add `e2e/hel1838-viewer-beta-upsell.spec.ts` (viewer + editor, desktop, light + dark, real free-tier owner asserted from the Output response); verify the full file passes with the lane DATABASE_URL exported.
- [x] 3.2 Mutation-red: the read-only gate turns the e2e viewer tests red and the editor tests stay green; record as `.txt`, commit, revert, verify green.

## 4. Spec and comment

- [x] 4.1 Correct the `hel1794-viewer-read-only.spec.ts` ALLOWED comment for "Request Beta access (opens in a new tab)" (D5); verify the hel1794 spec still passes.
- [x] 4.2 Run lint, typecheck, format check and the outputEditor jest folder; verify all green.
