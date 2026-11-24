## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 4e3ea04432ecc6caea0f194413d43fdcb603b6a4 against the live-resolved base fe07492b6a83dce675c124026700dbd002594628
(resolve-review-base.sh), 2 commits. The diff has no production code: one new jest file, one new e2e spec, a comment-only
hel1794 edit, and the change dir.

### Phase 1: Spec Review — PASS
Issues: none.
- AC1 (rule decided, today's behaviour kept): no production diff. `HistoryPayloadsField` still renders the link whenever
  `historyPayloadsAvailable !== true`, with no role gate (`OutputEditorSheet.tsx` History card, `HistoryPayloadsField.tsx`).
- AC2 (viewer and editor pinned, red under mutation): jest covers viewer, editor, default and owner. e2e covers a real
  viewer and a real editor in light and dark. I confirmed the red myself with a different mutation (see Phase 2).
- AC3 (live on main before tests): `live-verification.md` records 4/4 captures and the conditions (owner free,
  `historyPayloadsAvailable:false` from the real response, saved `table` Output, viewer's own tier free and irrelevant,
  Ask disclosure collapsed). The executor's screenshots are cropped above the link. My own captures (Phase 3) show it.
- AC4 (HEL-1839 `readOnly = true` default): `OutputEditorSheet.tsx:99` defaults to `readOnly = true`. The jest
  "fail-closed default (no readOnly prop)" test omits the prop (spread only when defined), finds the link inside the
  disabled fieldset, and goes red under the read-only mutation.
- Spec delta: the MODIFIED requirement carries over all four existing scenarios verbatim and adds viewer and editor
  scenarios. This matches the ruling.
- Tasks are all checked and match the files. No scope creep: sibling files for HEL-1837/HEL-1852 are untouched.
- Constraint C1 holds. The e2e proves liveness by clicking (popup at `/settings#beta-access`, sheet still open), never
  by `toBeEnabled`. Every locator is scoped to the History card in both files. The committed
  `mutation-a-readonly-jest-red.txt` shows viewer and default red with editor and owner green in the same run.

### Phase 2: Code Review — PASS
Gates, run fresh in WORKTREE_PATH after `cd frontend && nice -n 19 npm ci`:
- `npm run lint`: clean (zero warnings). `npm run format:check`: clean. `npm run typecheck`: clean.
- `npm test`: root 76/76 suites (683 tests), frontend 939/939 suites (10893 tests), exit 0.
- `npm --prefix frontend run build`: exit 0.
- No backend files changed, so `sbt testFull` was not required.

Independent mutation (sharper than the executor's (a)). The executor's mutation `available = ... || readOnly` also
removes the note, so its e2e red fired on the note text, not on the link. I applied a mutation that hides ONLY the
link: a `readOnly` prop on `HistoryPayloadsField`, and `{!readOnly && <Link .../>}`, keeping the note.
- jest `OutputEditorSheet.viewerUpsell` (full file): viewer RED, default RED, editor and owner green (2 failed, 2 passed).
- e2e `hel1838-viewer-beta-upsell.spec.ts` (full file, 2 workers, lane DB): viewer light and dark RED on the History-card
  link locator (`...filter({ has: heading History }).getByRole('link', ...)`), editor light and dark green.
  The page-wide Ask upsell with the same name did not mask it, which confirms the scoping.
- I reverted both files byte-for-byte from saved copies; `git diff` is empty and HEAD is unchanged.
- Evidence: /home/matt/Development/helio/.concertino/runs/HEL-1838/evidence/.concertino/scratch/HEL-1838/eval-mutation-linkonly-jest.txt
  and .../eval-mutation-linkonly-e2e.txt

Green e2e on reverted code: `hel1838-viewer-beta-upsell.spec.ts` (4/4) plus `hel1794-viewer-read-only.spec.ts` (4/4) in one
run, 8 passed, with the lane DATABASE_URL exported. The teardown deleted all 24 recorded users.
Evidence: .../evidence/.concertino/scratch/HEL-1838/eval-e2e-green.txt

Code quality: the test files follow the existing `OutputEditorSheet.history.test.tsx` harness shape. They have no
`any`, no dead code and no magic values beyond the named `LINK_NAME`. The e2e asserts the owner's free tier from the
real Output response (`historyPayloadsAvailable === false`, `kind === "table"`) instead of assuming it. The hel1794
comment edit is accurate (two upsells share the allow-listed name). The `as HTMLElement` cast on `closest(...)` in the
jest helper is acceptable: a null would fail loudly in `within`.

### Phase 3: UI Review — PASS
Lane servers came up through start-servers.sh (lane DB, ANTHROPIC_API_KEY empty) and assert-phase passed. I seeded
three real users through the API (plain `@example.test` emails): a free owner, plus an editor grant and a viewer grant
on a pipeline with a saved `table` Output. The viewer's `GET /outputs` returned `historyPayloadsAvailable: false`, and
the viewer's own tier was `free`. In the shared Playwright MCP browser, on port 7270 only (it started on about:blank
with no open dialog), I signed in as the viewer, opened the Output sheet and scrolled the History card into view:
- Light (1440x900): the link "Request Beta access (opens in a new tab)" is visible next to "Free stores run summaries
  only", with `href=/settings#beta-access`, `target=_blank`, inside the disabled fieldset, `pointer-events:auto`,
  focusable (`tabIndex 0`, `focus()` takes). "Ask about this Output" is collapsed, so the visible link is the History card's.
  Screenshot: /home/matt/Development/helio/.concertino/runs/HEL-1838/evidence/.concertino/scratch/HEL-1838/eval-viewer-light-history-link.png
- Dark (1440x900): the same, with the link in the dark accent colour.
  Screenshot: /home/matt/Development/helio/.concertino/runs/HEL-1838/evidence/.concertino/scratch/HEL-1838/eval-viewer-dark-history-link.png
- 768 and 390: the link stays inside the card. At 390 it wraps and has no horizontal overflow.
  Screenshot (390, dark): .../evidence/.concertino/scratch/HEL-1838/eval-viewer-dark-390-history-link.png
- Console: a 401 on `/api/auth/me` before login (expected), and a 404 on `GET /api/pipelines/:id/schedule` for the
  viewer. Neither comes from this diff, which has no production code. The schedule 404 is the sibling HEL-1837 area.
All three seeded users were deleted by exact id and email through `deleteUsersAndFolders` (`buildUserDeleteSql`)
against the lane DB. A follow-up query shows 0 remaining users and the pipeline gone. Servers stopped with stop-servers.sh.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- At 768px the pipeline page behind the sheet reports `scrollWidth > innerWidth`. That code is unchanged by this
  ticket; it is worth a look in a layout ticket if it shows up outside the modal backdrop.
- The executor's committed e2e mutation-red (`mutation-a-readonly-e2e-red.txt`) went red on the note text. The
  link-only mutation run above is stronger evidence for the link assertion itself and could be cited alongside it.
