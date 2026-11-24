## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 4e3ea04432ecc6caea0f194413d43fdcb603b6a4 against the live-resolved base fe07492b6a83dce675c124026700dbd002594628.

### What I verified (with evidence)
- Cwd guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/pin-viewer-beta-upsell/HEL-1838`.
- Diff scope (`git diff fe07492b6...HEAD --stat`): only tests (`e2e/hel1838-viewer-beta-upsell.spec.ts`, `OutputEditorSheet.viewerUpsell.test.tsx`), one comment in `e2e/hel1794-viewer-read-only.spec.ts`, and change-dir docs/evidence. No production code changed, so the branch's behaviour is main's behaviour. That matches the ruling to keep today's behaviour.
- Source of the rule: `HistoryPayloadsField.tsx` shows the link only when `!available`. `OutputEditorSheet.tsx:420-425` passes `available={output?.historyPayloadsAvailable === true}` and has no role gate. `readOnly = true` is the default (line 99). It fences fields in a `<fieldset disabled>`, which does not disable an `<a>`.
- AC1 (rule decided and kept): ticket.md records the owner ruling. No prod diff.
- AC2 (pinned for viewer and editor, mutation-proven):
  - Jest: `expectUpsell()` queries the link by role and name inside the History card *before* it checks the note. So the committed mutation-(a) jest red (viewer and default red, editor and owner green, `mutation-a-readonly-jest-red.txt`) fails on the link query itself. Mutation (b) turns the editor test red as well (`mutation-b-ownership-jest-red.txt`).
  - e2e: the spec asserts that the link is visible inside the History card, checks its `href`/`target`, clicks it, and requires the popup to be at `/settings#beta-access`.
- AC3 (live on main, light and dark, conditions named): `live-verification.md` names the conditions: owner tier free (`historyPayloadsAvailable: false`), a saved Output, kind not insight, the viewer's own tier irrelevant, and the Ask disclosure collapsed. My own e2e run (below) on code identical to main shows a real viewer sees the link and can follow it in both themes. The evaluator's screenshot shows the link rendered in the viewer's History card (dark): `/home/matt/Development/helio/.concertino/runs/HEL-1838/evidence/.concertino/scratch/HEL-1838/eval-viewer-dark-history-link.png`.
- AC4 (HEL-1839 default does not hide the link): the jest test "the sheet's fail-closed default (no readOnly prop) still shows the link" omits the prop entirely and passes. Under mutation (a) it goes red.
- C1: liveness is proved by a popup click, not `toBeEnabled`. Every locator is scoped to the card that holds h3 "History". The mutation-(a) red shows the viewer (and, in jest, the default case) red and the editor green in the same run.
- Gates I re-ran fresh:
  - `npm ci`: exit 0.
  - Jest `--testPathPatterns=outputEditor/OutputEditorSheet`: 17 suites and 193 tests passed.
  - ESLint `--max-warnings 0` on the new test: exit 0.
  - Prettier check on all 3 changed code files: clean.
  - `npm run typecheck`: clean.
  - Lane servers started with the lane DB and an empty API key, and `assert-phase servers` returned PASS. `playwright test e2e/hel1838-viewer-beta-upsell.spec.ts e2e/hel1794-viewer-read-only.spec.ts --workers=2` passed 8 of 8, and 24 throwaway users were deleted by recorded id. Output: `/home/matt/Development/helio/.concertino/scratch/HEL-1838/skeptic-e2e.txt`. Servers stopped (`STOPPED ports=7270,10177`).
- The orchestrator's specific question was whether the committed e2e red proves the link. On its own, no. `mutation-a-readonly-e2e-red.txt` removes the whole unavailable branch and fails at the note-text assertion (spec line 59), before the link assertion (line 61) runs. It proves the viewer test goes red when the upsell block disappears, not that the link locator does any work.
  - The link pin is still adequately proven by two other pieces of evidence:
    1. The committed jest mutation red fails on the link query, because the link query precedes the note check.
    2. The evaluator's link-only e2e mutation (note kept, link removed) is persisted durably at `/home/matt/Development/helio/.concertino/runs/HEL-1838/evidence/.concertino/scratch/HEL-1838/eval-mutation-linkonly-e2e.txt`. I read it: the viewer light and dark tests fail at `expect(link).toBeVisible()` at line 61 with "element(s) not found", and the editor tests stay green.
  - I also confirmed by reading the spec that line 61 is an unconditional assertion on the card-scoped link. It cannot pass if only the link is hidden.
  - No mtime-ordering claim is relied on anywhere here.

### Verdict: CONFIRM

### Non-blocking notes
- `mutation-a-readonly-e2e-red.txt` is accurate but weaker than its framing: the red lands on the note text, not the link. When the PR body cites mutation evidence, it should cite the evaluator's link-only e2e red (path above) alongside it.
- The executor's live screenshots (`.concertino/runs/HEL-1838/evidence/viewer-dark.png`, which I checked) are cropped above the History card's body, so they do not show the link. The "visible" cells in `live-verification.md` rest on the probe's assertions, not on those images. The evaluator's `eval-viewer-*-history-link.png` frames the link and is the better visual citation.
