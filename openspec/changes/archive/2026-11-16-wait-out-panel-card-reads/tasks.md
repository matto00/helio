## 1. Sweep

- [x] 1.1 Run `git grep -n "panel-grid-card" HEAD -- e2e` on the branch base; record command, total and per-file counts in `sweep.md`.
- [x] 1.2 Classify every hit per design D2 with a line reference (FIX / OK-filtered / OK-settled / OK-not-a-read / OK-scoped).

## 2. Conversions

- [x] 2.1 Convert every FIX hit using `waitForPanelGrid`/`LIVE_GRID_ITEMS` or `waitForPanelStack`/`LIVE_STACK_ITEMS` (D1); no duplicate helper.
- [x] 2.2 hel1681 :332/:343: minimal live-layer conversion only (D4).
- [x] 2.3 hel1575-dashboard-tabs hits (:132, :196, :896): classify; convert only if FIX.
- [x] 2.4 Re-run the grep after the change; record the new count and the verdict line for each converted hit.

## 3. hel1028:310

- [x] 3.1 Wait for the mounted phone stack (`waitForPanelStack`) before the count-0 assertions (D3).
- [x] 3.2 Product mutation (real-card handle on the phone stack): new spec RED on the handle assertion with a nonzero received count (C2), recorded; old spec under the same mutation recorded; mutation reverted; transcripts in `mutation-hel1028.md`.

## 4. Verification

- [x] 4.1 Run every edited spec file once, pinned `DEV_PORT=7155 BACKEND_PORT=10062` (C1), at `--workers=2 --trace retain-on-failure` under `nice -n 19`; transcripts show no `DEV_PORT is unset` warning; hel1028 and hel1681 with `--repeat-each 3`; record summaries in `sweep.md`.
- [x] 4.2 Pre-commit hook passes (no `-n`).

## Standing Constraints

- [C1] Every Playwright run is pinned to this lane: DEV_PORT=7155 BACKEND_PORT=10062, and its transcript shows no 'DEV_PORT is unset' warning.
- [C2] The hel1028 mutation RED run must fail on a nonzero handle count (proving the mutated module was served); the mutation is reverted before commit.

Lane constraints (also binding): `e2e/hel1685-draft-polish.spec.ts` is not edited; `e2e/hel1681-refresh-control.spec.ts` changes only at :332/:343; no product code in the final diff; never read or print any `.env` file; heredocs quoted only (`<<'EOF'`).
