## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `b5dc6808768258b9408e88772cf8d9ecb57309a9` (HEAD, worktree clean). Diff base resolved live:
`9c569fc6074d1d2296ad1a1f5fc91ee6b580a564` (origin/main). Spawn-cwd guard: `READY`.

### Phase 1: Spec Review — PASS

- AC1: `e2e/support/gridProcessedWidth.ts` exports `waitForGridWidth` (exact `${containerWidth}px` gate, phone-stack
  branch below 768, timeout message carries the last observed value) and `containerWidthForViewport`. Both inline
  copies (hel1023 `settledRects`, hel1392-burst `crossTo`) are replaced; hel1275 `resizeAndSettle` also migrated.
- AC2: audit complete. I diffed every `file:line` in audit.md against `git grep -n setViewportSize 9c569fc60 -- e2e`:
  all 78 base lines have exactly one row, no extra rows (hel1275:56/63/88 included). Grep proof re-run by me:
  `--panel-grid-processed-width` outside the helper = 0 hits; the box/`container.w` grep returns exactly the 5 lines
  evidence.md lists (hel1023:251, :282; hel1028:185-187), each with a stated allowed reason.
- AC3: the two semantic changes (hel1392-burst, hel1275) are recorded as "no red obtained" with observations, the
  outcome design D3 explicitly allows. No unobserved red is claimed (C1 honoured). I reproduced the negative result:
  the ORIGIN/MAIN copies of both specs under a 900 ms ResizeObserver-delay probe passed 5/5 (exit 0).
- AC4: `DesktopPanelGrid.tsx` is 196 lines. `git diff` on `useLayoutSave.ts` and `dashboardsSlice.ts` is empty; no
  `*.test.*` file is in the diff; `useLayoutSave(` is called only at `DesktopPanelGrid.tsx:109`.
- AC5: the archive edit touches two hunks only. l.18 rewording matches archived `skeptic-final-1.md` l.13 ("all 8 are at
  lg geometry, and only 4 fall outside the md bounds"); l.24 and l.28 are unchanged. The newest row of `dev-db-residue.txt`
  is `2026-10-08 16:04:07.588553-07` (305 rows), which matches the new window end.
- Tasks: all checked, and each matches the diff. No scope creep. `skip_specs: true` is justified because there are no API
  or schema changes.
- CONSTRAINTS C1/C2/C3: all honoured. C3 holds because `useCommitFlag` (its cleanup effect at `useCommitFlag.ts:28`)
  runs at `DesktopPanelGrid.tsx:108`, before `useLayoutSave` at :109. `latestLayoutRef`/`markLayoutChanged`/
  `commitInteractionLayout` reach `useGridLayoutInteraction` as plain arguments.
- files-modified.md: every path is complete and repo-relative. It lists no rendered Concertino files.

### Phase 2: Code Review — PASS

Gates I ran myself in WORKTREE_PATH (nice -n 19):
- `npm run lint`: exit 0
- `npm run format:check`: exit 0 ("All matched files use Prettier code style!")
- `npm run typecheck`: exit 0
- `npm run check:e2e-types`: exit 0
- `npm test -- --maxWorkers=3`: exit 0. I passed `--shard=1/2`, but the script did not forward it, so the whole suite
  ran: 590 suites / 7063 tests passed, 19 snapshots, 52 s.
- `npm --prefix frontend run build`: exit 0
- `npm run check:openspec`: exit 0 ("openspec/ is clean"). `check:openspec-version` OK.
- Backend: not touched, so `sbt testFull` was not applicable.

Behaviour-preservation review (diff line by line against the removed code):
- Effect and cleanup declaration order is unchanged. Before and after, the order is: editingTitleRef sync
  (`usePanelTitleEditing.ts:17`), then HEL-651 auto-close (`usePanelDetailState.ts:31`), then commit-flag cleanup, then
  `useLayoutSave`'s effects. `useGridLayoutInteraction` and `useProcessedWidth` declare no effects. The commit-timer
  cleanup therefore still runs before `useLayoutSave`'s unmount flush.
- Callback bodies and deps are copied verbatim. HEL-1023 derive-vs-edit and HEL-1457 `kept` items in
  `handleLayoutChange` are identical. The only dep added is `commitOnNextLayoutChangeRef` (a stable ref), so identity
  is unchanged.
- `handleStartEdit` keeps the same setState sequence: it clears confirm and detail, then calls `beginTitleEdit`. Its
  deps went from `[]` to `[beginTitleEdit]`, where `beginTitleEdit` has `[]` deps, so it is still stable.
- I1 and rebase-on-409 live entirely inside the unmodified `useLayoutSave.ts`. The inputs it receives
  (`layout`/`panels`/`panelsLoaded`/`registerLayoutFlush`) and its outputs' consumers are unchanged.
- Code-quality rules: no inline FQNs, no `any`, no TODO/FIXME, and no unused imports (lint is clean). Every new file is
  under the ~250-line budget (30/144/105/82/23/72 lines).

### Phase 3: UI Review — PASS

Servers: started with `start-servers.sh` (6850/9757), `assert-phase.sh servers` PASS, and stopped afterwards with
`stop-servers.sh` (`STOPPED ports=6850,9757`).

E2E (Playwright, 2 workers, nice -n 19, DEV_PORT=6850). Every exit code was captured:
- Migrated specs, unmutated app, no probe: hel1023 + hel1392-burst + hel1275: **10 passed (2.3m), exit 0**.
- The same specs under a 900 ms ResizeObserver-delay probe: **10 passed (3.0m), exit 0**. The probe is an evaluator
  scratchpad `--require` preload that wraps `Browser._innerNewContext` and adds an init script. No repo file was edited.
  I confirmed separately that the probe installs in a context (`window.__roDelay = 900`).
- OLD (origin/main) hel1392-burst + hel1275 under the same probe: **5 passed (2.0m), exit 0**. This confirms the
  executor's "no red obtained" claims.
- Split behaviour: hel1028 + hel1457 + hel1230 (drag/resize/undo, stale-tab save, drag-then-create): **16 passed
  (46.4s), exit 0**.
- Detail modal, card click and breakpoints: hel716 + hel572 + hel588: **7 passed (23.2s), exit 0**.
- Every run's teardown deleted its recorded throwaway users by exact id.

Manual pass in the live app (Playwright MCP), with one throwaway user and 4 text panels:
- Rename via the actions menu works. A blank title shows "Title must not be blank.", Enter commits, and Escape cancels.
- Starting a rename clears a pending delete confirm on another card.
- Customize opens edit mode. Close goes from edit to view, which is the pre-existing HEL-716 `attemptClose` behaviour.
  Escape closes the modal.
- A plain card click opens view mode.
- The delete confirm shows Confirm/Cancel.
- Breakpoints:
  - 1440: processed width 1152px, matching the box.
  - 1100: 812px, matching the box.
  - 768 and 360: the phone stack renders 4 items with no horizontal overflow.
  - Back to 1440: 1152px.
- Console: 0 errors and 0 warnings on the dashboard flow. The only errors were the expected `401 /api/auth/me` on
  `/login` before sign-in.
- The user `febc1c3d-1b03-4de3-92b5-9b8752931020` / `hel1418-eval-1791934157175@example.test` was deleted by exact
  (id, email) through `buildUserDeleteSql`. A follow-up query finds 0 user rows and 0 dashboard rows.
- No screenshots are cited as load-bearing evidence. All UI evidence above is numeric DOM readouts, so nothing needed
  persisting.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- audit.md says "on this tree", but its line numbers are origin/main (pre-edit) numbers. On HEAD, hel1023 is at
  352/355, hel1275 at 62/79 (the l.56 comment is gone), and hel1392-burst at 64/80. The new
  `e2e/support/gridProcessedWidth.ts:8` comment is also a grep hit. A one-line note ("line numbers are as of
  9c569fc60") would make the table reproducible as written.
- `PanelDetailModal`'s `onClose` changed from an inline arrow (new identity every render) to the stable `closeDetail`.
  This is benign: the modal only calls it inside `attemptClose`, and that was re-verified live. It is still an identity
  change that evidence.md does not mention.
- The executor's `useState(0)` mutation result (new wait red, old wait resolving on `0px`) was not re-run here, because
  reproducing it requires mutating app code. It is a supplementary demonstration, not an AC3 red claim, so nothing
  depends on it.
