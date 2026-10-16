# HEL-1575 C7 red-first evidence (pre-fix code, commit e01ddfc08 + new test only)

Worktree: /home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575

## Command

```
cd /home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend && nice -n 19 npx jest --maxWorkers=2 src/features/panels/ui/grid/PanelGrid.unmountFlush.test.tsx
```

## Output (pre-fix): 4 failed, 1 passed (the nothing-staged case)

```
  console.error
    Error: AggregateError
        at Object.dispatchError (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/xhr/xhr-utils.js:62:19)
        at Request.<anonymous> (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/xhr/XMLHttpRequest-impl.js:655:18)
        at Request.emit (node:events:531:35)
        at ClientRequest.<anonymous> (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/helpers/http-request.js:127:14)
        at ClientRequest.emit (node:events:519:28)
        at emitErrorEvent (node:_http_client:108:11)
        at Socket.socketErrorListener (node:_http_client:575:5)
        at Socket.emit (node:events:519:28)
        at emitErrorNT (node:internal/streams/destroy:170:8)
        at emitErrorCloseNT (node:internal/streams/destroy:129:3)
        at processTicksAndRejections (node:internal/process/task_queues:89:21) {
      type: 'XMLHttpRequest'
    }

      at VirtualConsole.<anonymous> (node_modules/@jest/environment-jsdom-abstract/build/index.js:87:23)
      at Object.dispatchError (node_modules/jsdom/lib/jsdom/living/xhr/xhr-utils.js:65:53)
      at Request.<anonymous> (node_modules/jsdom/lib/jsdom/living/xhr/XMLHttpRequest-impl.js:655:18)
      at ClientRequest.<anonymous> (node_modules/jsdom/lib/jsdom/living/helpers/http-request.js:127:14)

  console.error
    Error: AggregateError
        at Object.dispatchError (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/xhr/xhr-utils.js:62:19)
        at Request.<anonymous> (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/xhr/XMLHttpRequest-impl.js:655:18)
        at Request.emit (node:events:531:35)
        at ClientRequest.<anonymous> (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/helpers/http-request.js:127:14)
        at ClientRequest.emit (node:events:519:28)
        at emitErrorEvent (node:_http_client:108:11)
        at Socket.socketErrorListener (node:_http_client:575:5)
        at Socket.emit (node:events:519:28)
        at emitErrorNT (node:internal/streams/destroy:170:8)
        at emitErrorCloseNT (node:internal/streams/destroy:129:3)
        at processTicksAndRejections (node:internal/process/task_queues:89:21) {
      type: 'XMLHttpRequest'
    }

      at VirtualConsole.<anonymous> (node_modules/@jest/environment-jsdom-abstract/build/index.js:87:23)
      at Object.dispatchError (node_modules/jsdom/lib/jsdom/living/xhr/xhr-utils.js:65:53)
      at Request.<anonymous> (node_modules/jsdom/lib/jsdom/living/xhr/XMLHttpRequest-impl.js:655:18)
      at ClientRequest.<anonymous> (node_modules/jsdom/lib/jsdom/living/helpers/http-request.js:127:14)

  console.error
    Error: AggregateError
        at Object.dispatchError (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/xhr/xhr-utils.js:62:19)
        at Request.<anonymous> (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/xhr/XMLHttpRequest-impl.js:655:18)
        at Request.emit (node:events:531:35)
        at ClientRequest.<anonymous> (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/helpers/http-request.js:127:14)
        at ClientRequest.emit (node:events:519:28)
        at emitErrorEvent (node:_http_client:108:11)
        at Socket.socketErrorListener (node:_http_client:575:5)
        at Socket.emit (node:events:519:28)
        at emitErrorNT (node:internal/streams/destroy:170:8)
        at emitErrorCloseNT (node:internal/streams/destroy:129:3)
        at processTicksAndRejections (node:internal/process/task_queues:89:21) {
      type: 'XMLHttpRequest'
    }

      at VirtualConsole.<anonymous> (node_modules/@jest/environment-jsdom-abstract/build/index.js:87:23)
      at Object.dispatchError (node_modules/jsdom/lib/jsdom/living/xhr/xhr-utils.js:65:53)
      at Request.<anonymous> (node_modules/jsdom/lib/jsdom/living/xhr/XMLHttpRequest-impl.js:655:18)
      at ClientRequest.<anonymous> (node_modules/jsdom/lib/jsdom/living/helpers/http-request.js:127:14)

  console.error
    Error: AggregateError
        at Object.dispatchError (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/xhr/xhr-utils.js:62:19)
        at Request.<anonymous> (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/xhr/XMLHttpRequest-impl.js:655:18)
        at Request.emit (node:events:531:35)
        at ClientRequest.<anonymous> (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/helpers/http-request.js:127:14)
        at ClientRequest.emit (node:events:519:28)
        at emitErrorEvent (node:_http_client:108:11)
        at Socket.socketErrorListener (node:_http_client:575:5)
        at Socket.emit (node:events:519:28)
        at emitErrorNT (node:internal/streams/destroy:170:8)
        at emitErrorCloseNT (node:internal/streams/destroy:129:3)
        at processTicksAndRejections (node:internal/process/task_queues:89:21) {
      type: 'XMLHttpRequest'
    }

      at VirtualConsole.<anonymous> (node_modules/@jest/environment-jsdom-abstract/build/index.js:87:23)
      at Object.dispatchError (node_modules/jsdom/lib/jsdom/living/xhr/xhr-utils.js:65:53)
      at Request.<anonymous> (node_modules/jsdom/lib/jsdom/living/xhr/XMLHttpRequest-impl.js:655:18)
      at ClientRequest.<anonymous> (node_modules/jsdom/lib/jsdom/living/helpers/http-request.js:127:14)

  console.error
    Error: AggregateError
        at Object.dispatchError (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/xhr/xhr-utils.js:62:19)
        at Request.<anonymous> (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/xhr/XMLHttpRequest-impl.js:655:18)
        at Request.emit (node:events:531:35)
        at ClientRequest.<anonymous> (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/helpers/http-request.js:127:14)
        at ClientRequest.emit (node:events:519:28)
        at emitErrorEvent (node:_http_client:108:11)
        at Socket.socketErrorListener (node:_http_client:575:5)
        at Socket.emit (node:events:519:28)
        at emitErrorNT (node:internal/streams/destroy:170:8)
        at emitErrorCloseNT (node:internal/streams/destroy:129:3)
        at processTicksAndRejections (node:internal/process/task_queues:89:21) {
      type: 'XMLHttpRequest'
    }

      at VirtualConsole.<anonymous> (node_modules/@jest/environment-jsdom-abstract/build/index.js:87:23)
      at Object.dispatchError (node_modules/jsdom/lib/jsdom/living/xhr/xhr-utils.js:65:53)
      at Request.<anonymous> (node_modules/jsdom/lib/jsdom/living/xhr/XMLHttpRequest-impl.js:655:18)
      at ClientRequest.<anonymous> (node_modules/jsdom/lib/jsdom/living/helpers/http-request.js:127:14)

  console.error
    Error: AggregateError
        at Object.dispatchError (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/xhr/xhr-utils.js:62:19)
        at Request.<anonymous> (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/xhr/XMLHttpRequest-impl.js:655:18)
        at Request.emit (node:events:531:35)
        at ClientRequest.<anonymous> (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/helpers/http-request.js:127:14)
        at ClientRequest.emit (node:events:519:28)
        at emitErrorEvent (node:_http_client:108:11)
        at Socket.socketErrorListener (node:_http_client:575:5)
        at Socket.emit (node:events:519:28)
        at emitErrorNT (node:internal/streams/destroy:170:8)
        at emitErrorCloseNT (node:internal/streams/destroy:129:3)
        at processTicksAndRejections (node:internal/process/task_queues:89:21) {
      type: 'XMLHttpRequest'
    }

      at VirtualConsole.<anonymous> (node_modules/@jest/environment-jsdom-abstract/build/index.js:87:23)
      at Object.dispatchError (node_modules/jsdom/lib/jsdom/living/xhr/xhr-utils.js:65:53)
      at Request.<anonymous> (node_modules/jsdom/lib/jsdom/living/xhr/XMLHttpRequest-impl.js:655:18)
      at ClientRequest.<anonymous> (node_modules/jsdom/lib/jsdom/living/helpers/http-request.js:127:14)

  console.error
    Error: AggregateError
        at Object.dispatchError (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/xhr/xhr-utils.js:62:19)
        at Request.<anonymous> (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/xhr/XMLHttpRequest-impl.js:655:18)
        at Request.emit (node:events:531:35)
        at ClientRequest.<anonymous> (/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend/node_modules/jsdom/lib/jsdom/living/helpers/http-request.js:127:14)
        at ClientRequest.emit (node:events:519:28)
        at emitErrorEvent (node:_http_client:108:11)
        at Socket.socketErrorListener (node:_http_client:575:5)
        at Socket.emit (node:events:519:28)
        at emitErrorNT (node:internal/streams/destroy:170:8)
        at emitErrorCloseNT (node:internal/streams/destroy:129:3)
        at processTicksAndRejections (node:internal/process/task_queues:89:21) {
      type: 'XMLHttpRequest'
    }

      at VirtualConsole.<anonymous> (node_modules/@jest/environment-jsdom-abstract/build/index.js:87:23)
      at Object.dispatchError (node_modules/jsdom/lib/jsdom/living/xhr/xhr-utils.js:65:53)
      at Request.<anonymous> (node_modules/jsdom/lib/jsdom/living/xhr/XMLHttpRequest-impl.js:655:18)
      at ClientRequest.<anonymous> (node_modules/jsdom/lib/jsdom/living/helpers/http-request.js:127:14)

FAIL src/features/panels/ui/grid/PanelGrid.unmountFlush.test.tsx
  ● HEL-1575 C7 -- unmount flush of pending panel updates › flushes staged panel edits immediately when the grid unmounts (no timer advance)

    expect(jest.fn()).toHaveBeenCalledTimes(expected)

    Expected number of calls: 1
    Received number of calls: 0

      91 |     });
      92 |
    > 93 |     expect(batchMock).toHaveBeenCalledTimes(1);
         |                       ^
      94 |     expect(batchMock.mock.calls[0][0].panels).toEqual([{ id: "panel-a", title: "Renamed" }]);
      95 |   });
      96 |

      at Object.<anonymous> (src/features/panels/ui/grid/PanelGrid.unmountFlush.test.tsx:93:23)

  ● HEL-1575 C7 -- unmount flush of pending panel updates › flushes on a dashboard switch (keyed remount) before the next grid's auto-save

    expect(jest.fn()).toHaveBeenCalledTimes(expected)

    Expected number of calls: 1
    Received number of calls: 0

      105 |       rerender(grid("d2", [panelB]));
      106 |     });
    > 107 |     expect(batchMock).toHaveBeenCalledTimes(1);
          |                       ^
      108 |     expect(batchMock.mock.calls[0][0].panels).toEqual([{ id: "panel-a", title: "Renamed" }]);
      109 |   });
      110 |

      at Object.<anonymous> (src/features/panels/ui/grid/PanelGrid.unmountFlush.test.tsx:107:23)

  ● HEL-1575 task 4.5(5) -- a successful batch save clears only the keys it sent › keeps an edit staged on another panel during the round trip

    expect(received).toEqual(expected) // deep equality

    - Expected  - 3
    + Received  + 1

    - Array [
    -   "panel-b",
    - ]
    + Array []

      148 |
      149 |     const pending = store.getState().panels.pendingPanelUpdates;
    > 150 |     expect(Object.keys(pending)).toEqual(["panel-b"]);
          |                                  ^
      151 |   });
      152 |
      153 |   it("keeps a newer edit staged on the SAME panel during the round trip", async () => {

      at Object.<anonymous> (src/features/panels/ui/grid/PanelGrid.unmountFlush.test.tsx:150:34)

  ● HEL-1575 task 4.5(5) -- a successful batch save clears only the keys it sent › keeps a newer edit staged on the SAME panel during the round trip

    expect(received).toEqual(expected) // deep equality

    Expected: {"title": "Two"}
    Received: undefined

      167 |       resolveBatch({ panels: [] });
      168 |     });
    > 169 |     expect(store.getState().panels.pendingPanelUpdates["panel-a"]).toEqual({ title: "Two" });
          |                                                                    ^
      170 |   });
      171 | });
      172 |

      at Object.<anonymous> (src/features/panels/ui/grid/PanelGrid.unmountFlush.test.tsx:169:68)

Test Suites: 1 failed, 1 total
Tests:       4 failed, 1 passed, 5 total
Snapshots:   0 total
Time:        3.13 s, estimated 4 s
Ran all test suites matching src/features/panels/ui/grid/PanelGrid.unmountFlush.test.tsx.
```

## After the fix (same command, same worktree): 5 passed

```
cd /home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575/frontend && nice -n 19 npx jest --maxWorkers=2 src/features/panels/ui/grid/PanelGrid.unmountFlush.test.tsx --verbose
Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Snapshots:   0 total
Time:        2.819 s, estimated 3 s
Ran all test suites matching src/features/panels/ui/grid/PanelGrid.unmountFlush.test.tsx.
```

## What the fix is

- `usePanelUpdatesFlush`: an empty-deps unmount effect (latest-ref pattern, as `useLayoutSave`) flushes pending panel updates when the grid unmounts. `PanelList` keys `<PanelGrid>` by dashboard id, so the pre-existing dashboard-switch effect never ran (first-render guard).
- `updatePanelsBatch` success now dispatches `clearSentPendingPanelUpdates(sent)` (only the keys sent, and only while still equal to what was sent) instead of `clearPendingPanelUpdates()`.

Note: the red run above printed jsdom XMLHttpRequest noise from `getAssertionStatus`; the test file was afterwards given a mock for it (no assertion changed).

# Phase C: run while active, then leave and return (found by the e2e, fixed in `usePanelRunRefresh`)

Spec scenario "A run while active does not void warmth": the return sends no request for A's panel list or rows. The unit tests were green; the running app was not.

## Red: `e2e/hel1575-dashboard-tabs.spec.ts` against the code before the fix

```
e2e/hel1575-dashboard-tabs.spec.ts:621:7 > a run while the tab is active, then leave and return within the TTL: still warm
    Error: expect(received).toEqual(expected) // deep equality
    - Expected  - 1
    + Received  + 3
    - Array []
    + Array [
    +   "GET /api/outputs/89c786d4-2d8f-43b9-b408-c3dc4077385e/rows",
    + ]
      641 |     expect(net.since(from, PANELS), "run while active must not void warmth").toEqual([]);
    > 642 |     expect(net.since(from, ROWS)).toEqual([]);
```

Probe (request log from the return to A after a run while A was active): `GET /api/outputs/<A>` (metadata), `GET .../rows`, `GET .../assertion-status`, then `runs/latest` and `run-events`. The metadata read before any rows read is the cache miss.

## Root cause

`usePanelRunRefresh`'s SSE callback re-read the rows only. A `succeeded` event calls `invalidatePipeline`, which advances the Output's freshness generation; the rows were refetched under the new generation, but `outputMetaCache`'s entry stayed stamped with the old one. On remount `getOutputMetaCached` therefore returned nothing, `isReusable` needs `getOutputMetaCached(outputId)?.pipelineId` for the run baseline, so the held rows were not reused and both reads were repeated.

## Fix and green

`usePanelRunRefresh` now also calls `fetchOutputMeta(outputId)` in the callback, so the held metadata keeps pace with the generation (one metadata read per run per visible Output, instead of one on each later remount). Unit test added: `usePanelRunRefresh.test.ts` "re-reads the Output metadata with the rows refresh...". The e2e then passes 3 runs of 3 (17 of 17 each), transcript in `e2e-run.txt`.

## Observed, not changed

Row windows are reused only once the client knows the pipeline's latest run (the baseline a `runs/latest` read records, which a card that is unmounted first aborts). A user who leaves a tab within about 100 ms of opening it therefore refetches rows on return; the panel list is still warm. The e2e fixture waits for the baseline before leaving each tab. This is the existing HEL-1392 rule (reuse needs a run baseline), kept because without it a run that finished while away would go unnoticed.

# Cycle 2: an expired tab's rows were still reused (found by tightening the expiry e2e)

Spec scenario "Expired tab refetches": activating it requests its panel list and rows. The e2e asserted only the panel list. Asserting rows as well went red (2 of 2 runs): `expect.poll(rows requests since the switch) >= 1` received 0.

Root cause: `releaseTab` releases the tab's Output retentions, but `isRetained` then stays true for the 30 s remount grace, and the sweep that releases an expired tab runs only once a minute. So the held rows of a tab left for 15 minutes could still be reused for up to the sweep interval plus the grace. Fix: `expireTab` (in `warmCache.ts`) invalidates the tab's Outputs' generations before releasing, used by the sweep for non-warm tabs and by `showDashboardPanels` when a tab is activated while not warm. Unit test `showDashboardPanels.test.ts` "after the TTL the tab's held rows are void too" fails (1 of 19) with `showDashboardPanels.ts` reverted and passes with it; the e2e then passes 3 of 3.

# Cycle 3: the close expander captured 2px of the next tab (evaluation 2, CR1)

Under `(pointer: coarse)` the 24px close's centred 44px expander extends (44 - 24) / 2 = 10px per side against an 8px right margin, so it covered 2px of the next tab; `elementFromPoint(nextTab.left + 0.5)` returned the previous tab's close button.

Red, against the 24px code: `DashboardTabBar.css.test.ts` "under coarse pointers the 44px expander never reaches past the close's right margin into the next tab" failed with `Expected: <= 8, Received: 10` (sizes and margin resolved from the token values in `theme.css`). Also red: the new e2e "touch: a tap on a tab's left edge lands in that tab..." (a `hasTouch: true` context, `elementFromPoint` at each following tab's left edge) failed with the coarse size override removed, and passes with it.

Fix: inside the coarse block `.dashboard-tab__close` is `var(--control-sm)` (28px), so the expander extends exactly 8px and tiles against the margin; the 24px base stays for fine pointers.

Also: `warmCache.sweep.test.ts` proves `sweepWarm` expires (invalidates, not only releases) a non-warm tab. Reverting `sweepWarm` to `releaseTab` makes "expires a tab that is no longer warm" fail (1 of 3); restored, 3 of 3 pass.

## Final gate round 1 (skeptic-final-1.md): reload of the active dashboard, and Ask from /chat

Raw transcript of the red run: `/home/matt/Development/helio/.concertino/runs/HEL-1575/evidence/red-run-final1.txt`
(worktree `/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575`, product fixes stashed, new tests in place, servers on 7007/9914).

- **e2e "reload of the only, never-left dashboard is warm"**: RED before the fix: `expect.poll(warmEntryCount) toBeGreaterThanOrEqual(1)` received 0 for 15 s (no browser copy of the active tab exists without pagehide). GREEN after: 1 passed, then no panel-list or rows request after the reload.
- **e2e "Ask the assistant while already on /chat ..."**: RED before: after the first ask on /chat `stubbed reply` never appeared (hand-off ignored, no create/converse). GREEN after: one create and one converse per ask (2 total), and a reload sends nothing more.
- **jest `ChatPage.autoSend.test.tsx`**: with `ChatPage.tsx` stashed, 2 of 5 failed (second hand-off on /chat honoured once; same text asked again). 5 of 5 after.
- **jest `activeTabSnapshot.test.ts`**: with the listener registration stashed, 1 of 5 failed (the browser copy is written once the windows settle, without pagehide). 5 of 5 after.

## Final gate round 2 (skeptic-final-2.md): the idle heartbeat overwrote another device's tab set

Raw transcripts: `/home/matt/Development/helio/.concertino/runs/HEL-1575/evidence/exec-final-2/` (worktree `/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575`, servers 7007/9914, product fixes stashed for the red runs, new tests in place).

- **jest `activeTabSnapshot.test.ts`** (`cd frontend && npx jest --maxWorkers=1 --testPathPatterns=activeTabSnapshot`), RED on the old code: 2 of 4 failed. "an idle, visible active tab sends 0 preferences PATCHes over 2x the heartbeat" received 2 `patchDashboardTabsRequest` calls (`lastViewedAt` 07:36:50.880Z and 07:37:50.880Z); "stamps only the browser copy" saw `tabs[0].lastViewedAt` change from null in the store. GREEN after: 4 of 4.
- **jest `hydrateTabs.test.ts`**: "an idle active tab whose saved stamp is past the TTL is still warm on reload via the copy's stamp" fails (1 of 16) with the adoption of the copy's stamp disabled, passes (16 of 16) with it.
- **e2e two devices** (`DEV_PORT=7007 BACKEND_PORT=9914 npx playwright test e2e/hel1575-dashboard-tabs.spec.ts -g "never overwrites the tab set" --workers=1`; B saves a 1-tab set through a second context, A idles visible for 125 s): RED on the old code (`e2e-two-device-RED.txt`): at +25 s the server held `[A, +2 reverted tabs]` instead of B's one-tab set. GREEN after (`e2e-two-device-GREEN.txt`): `1 passed (2.2m)`, B's set intact at every 25 s check through +125 s and 0 preferences PATCHes from the idle device.

## Fix cycle 2 (evaluation-4.md): one PATCH per page leave

Raw transcript: `openspec/changes/archive/2026-10-15-persistent-dashboard-tabs-palette/red-run-fix2.txt` (worktree `/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575`, HEAD b91b454761). The new tests in `tabsBrowserTriggers.test.ts` were run against the unmodified b91b454761 `tabsBrowserTriggers.ts` (plus two exported constants so the file compiles). RED, 5 of 13 failed:

- "one leave (hidden followed by pagehide) sends at most one PATCH": expected 1 call, received 2.
- "sends nothing off the dashboard view": expected 0, received 2.
- "still flushes a pending real tab change off the dashboard view, once": expected 1, received 2.
- "skips the PATCH when only the re-stamp of a recently stamped tab would change": expected 0, received 2.
- "a visible burst refreshes the signals once per gap, and never off the dashboard view": expected 1, received 2.

GREEN after the fix: `npx jest src/features/dashboards/tabs` 17 suites / 213 tests passed.

## Fix cycle 2b: the leave capture rewound the browser copy's stamp (evaluation-5, CR1)

RED on e07eaaa5c (`tabsBrowserTriggers.test.ts`, "a leave capture never rewinds the browser copy's lastViewedAt below the fresher heartbeat stamp"; stored stamp 4 min old, heartbeat stamp 30 s ago, leave capture); transcript `fix2b/red.txt`:

```
Expected: >= 1792110430958
Received:    1792110191957      (about 4 min old: the stale stored stamp replaced the fresher heartbeat stamp)
Tests:       1 failed, 14 passed, 15 total
```

GREEN after passing `viewedAt: serverNowMs()` in the leave `captureTab`: tabs dir 17 suites / 215 tests passed (`fix2b/tabs-green.txt`).
The other capture paths cannot rewind: the heartbeat and the tab-switch listener stamp with now (the switch dispatches `tabViewed` first), and the debounced captures go through `laterOf` with the store stamp.
Note: the added "pending real change + hidden + pagehide = 1 PATCH" test passes with and without the `left` guard (mutation `fix2b/mutation.txt`: 15 passed), because after the first leave the stored stamp is fresh and nothing is pending; the guard is now belt-and-braces and that test pins the behaviour, not the guard.
