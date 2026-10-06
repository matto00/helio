## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `27dd24b812954561b61d3001956f5c46c5be176c`. Base resolved live with `resolve-review-base.sh`: `f4601ba2ee9300f7ecb2775a56559f234c966431`.
Logs are in the session scratchpad, all prefixed `hel1327-skeptic-*`.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/history-delta-test-gaps/HEL-1327`.
- **Scope and C1.** `git diff --stat BASE...HEAD` lists two code files plus files under the change dir:
  - `e2e/hel1275-metric-delta-sparkline.spec.ts`
  - the new `frontend/src/features/dashboards/ui/PublicDashboardViewerPage.history.test.tsx`
  - files under `openspec/changes/history-delta-test-gaps/`

  The diff has no product code. It does not touch `OutputHistoryService`, the history schemas, `PublicDashboardRoutes*`, the L7 scrubber, `ci.yml`, `playwright.config.ts`, `.gitignore` or `helio-mcp/`. Item 1 is correctly absent.
- **AC2 (public history source).**
  - The real page passes `historySource={historySource}` at `PublicDashboardViewerPage.tsx:134`.
  - The new test renders the real page at `/dashboards/dash-1/panels?token=tok` in two cases: anonymous, and a preloaded authenticated owner.
  - It asserts `fetchPublicOutputHistory` is called with `("dash-1","panel-1","tok")` exactly once. Here `panel.id` is `panel-1` and differs from `outputId` `out-1`. It does not use `expect.any(String)`.
  - It asserts `fetchOutputHistory` is never called.
  - It asserts the public-only payload reaches the DOM (`2,222`, `▲ 11% vs 7d`).
  - `beforeEach` resets the cache and the comparison store, and calls `mockReset` on every mock. C5 is honoured.
  - Green on real code: `Tests: 2 passed, 2 total`.
  - My own product mutation (deleted line 134, the `historySource` prop) turned it red: `Tests: 2 failed, 2 total`, `Expected: "dash-1", "panel-1", "tok" / Number of calls: 0` (`hel1327-skeptic-ac2-red.log`). Reverted with `git checkout`.
- **AC3 (no reload).** I used a different mutation from the executor's, to check that the window covers the whole round trip and not only the last hop. In `Sidebar.tsx`, I set `reloadDocument={destination.label === "Data Pipelines"}`, which reloads on the first hop.
  - Result: red at spec line 323, `full document loads during editor -> dashboard`, Received `["http://localhost:6759/pipelines"]` (`hel1327-skeptic-ac3-red-pipelines.log`). Reverted.
  - The run reached line 323, so the pre-existing `vs 1d` and no-`vs 7d` text assertions passed under a real reload. They do not guard on their own, which confirms the new assertion adds real coverage.
  - I did not re-run the sentinel red. The executor's sentinel-only red and the evaluator's raw-log cross-check are recorded. The sentinel logic is plain: a new document drops window props, and the read happens after `page.off`.
- **AC4 (resize, then settle).** I wrote my own freeze mutation in `PanelList.tsx`: freeze `gridContainerWidth` at the first measured width that is greater than 0 and not 1280.
  - The new wait went red at the `resizeAndSettle` poll: `card width never changed from 333px after resizing the viewport to 1100px` (`hel1327-skeptic-ac4-red-new.log`).
  - Under the same mutation, a temporary untracked copy of the spec with the change-poll disabled (`if (false && resizes)`, the OLD wait) went GREEN: `1 passed (10.4s)` (`hel1327-skeptic-ac4-oldwait-under-mutation.log`). This confirms the old wait passed vacuously, as the ticket claims. The copy is deleted and the mutation reverted.
  - The skip for the no-op 1440 iteration is correct: the viewport starts at 1440. The `before`-is-non-null precondition prevents a vacuous `.not.toBe(null)` poll.
- **Green on real code, both themes.** `start-servers.sh <wt> 6759 9666 HEL-1327` started the servers and `assert-phase servers` returned PASS. The listener cwds are this worktree's `backend/` (java 1924086) and `frontend/` (node 1924751).
  - Run: Playwright `--workers=1` under `nice -n 19` with `DEV_PORT=6759`.
  - Result: `2 passed (26.0s)` (`hel1327-skeptic-green.log`).
  - Afterwards `git status` shows only the orchestrator's untracked `evaluation-2.md`. No tracked screenshots or product files changed.
- **HUSKY=0 bypass.** `.husky/pre-commit` uses `set -e`. When `check:helio-mcp-types` fails it stops every later hook gate, so the bypass could hide format, openspec and jest failures. I re-ran the ones relevant to this diff myself, all with exit 0:
  - `eslint --max-warnings=0` on both changed code files
  - `prettier --check` on those files and the change dir
  - `tsc -p e2e/tsconfig.json`
  - frontend `tsc --noEmit`
  - `check-repo-integrity`, `check-openspec-hygiene`, `check-spec-structure`, `check-test-temp-dir-hygiene`, `check-no-credential-in-agent-surface`

  The evaluator's pasted run of the full suite (frontend jest 4618/4618, root 375/375) covers the rest. The diff does not touch `helio-mcp/`, so the mcp-types failure cannot come from this change. Nothing is hidden.
- **UI judgment.** This is a test-only change with no UI diff, so the visual review does not apply.
- **Process hygiene.** I stopped my servers by exact PID (1924751, 1924734, 1924086, 1923420, 1923371). Both ports are free.

  Dev-DB users my runs created (no delete route exists, see HEL-1301):
  - `1d702d7e-6dc4-4330-9a97-cdf512df0979` (green, light)
  - `b215be41-dbcd-422f-8aba-911192c11e17` (green, dark)
  - `855fc262-03fa-40ad-8958-2ac5bad1223f` (AC3 red)
  - `e9c63e37-5fe1-47b0-b4fb-f9121a715698` (AC4 new-wait red)
  - `4b925eae-38e2-4d7b-856e-f80e43e762d3` (AC4 old-wait green)

### Verdict: CONFIRM

### Non-blocking notes

- `mutation-evidence.md`: the parenthetical "(copy line numbers; spec line 327 area)" is out of date. The sentinel assertion is now around spec line 329, and the count assertion is at 323. This is cosmetic, and the evaluator noted it too.
- Under the AC4 mutation, the spec's existing 1100px sparkline-geometry assertions still pass at the frozen width. They were always blind to whether a reflow happened. The new change-poll is what now forces the 1100 iteration to measure a reflowed grid.
