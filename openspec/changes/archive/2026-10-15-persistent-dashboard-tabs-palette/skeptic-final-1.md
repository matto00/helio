## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `4adba1ebcc6dcf3397c28375288e192ecc8990cb` (the code head is `9f6cf9580`; `4adba1ebc` adds evaluation-3.md only). The review base was resolved live with `resolve-review-base.sh`: `cd64409ad`. origin/main is one commit ahead (`60086f02b`, HEL-1605); `git merge-tree` against it is clean. HEL-1579 and HEL-1578 have not merged, so there is no shared-predicate duplication to check yet.

Evidence directory (durable, outside the worktree): `/home/matt/Development/helio/.concertino/runs/HEL-1575/evidence/skeptic-final-1/`. It holds the screenshots and the two probe scripts cited below.

### What I verified (with evidence)

**Gates: all re-run fresh in this worktree.**

| Gate | Result |
| --- | --- |
| `npm run lint` / `typecheck` / `format:check` (frontend) | exit 0 / exit 0 / exit 0 |
| Full frontend `npm test` (3 workers, nice 19) | 630 suites / 7473 tests passed, exit 0 |
| Focused HEL-1575 suites (`--json`) | 21 suites / 224 tests, 0 failed. Every result path is `.../HEL-1575/frontend/src/...` |
| Backend `sbt testOnly` of `UserPreferencesRoutesSpec`, `DashboardChangesRoutesSpec` and `AuthServiceSpec` | 3 suites / 39 tests, 0 failed. Run from `.../HEL-1575/backend`. The backend has not changed since `e01ddfc08` |
| `e2e/hel1575-dashboard-tabs.spec.ts` (2 workers, `start-servers.sh` on 7007/9914) | 18 passed (1.3m); teardown deleted 18 throwaway users |

**C5 (NOBYPASSRLS).** The checks hold:
- `TwoUserRlsApiFixture` builds `UserPreferenceRepository(appDb)` on the `helio_app_test NOBYPASSRLS` pool (fixture lines 86 and 117).
- `DashboardChangesRoutesSpec` asserts `rolbypassrls = false` for that role.

**C7 (leave flush, red-first).** I mutated a throwaway detached worktree at `9f6cf9580`, removing `useEffect(() => () => flushPanelUpdatesRef.current(), [])`. `PanelGrid.unmountFlush.test.tsx` then failed 2 of 5. Restored, it passed 5 of 5. The throwaway worktree was removed afterwards. This confirms `evidence-red-first.md`.

**C2 (20-tab cap, 8 warm).**
- `dashboardTabsSlice.ts` `insertAfterActive` evicts the least recently used inactive tab at `MAX_TABS`, treating null as oldest and breaking ties to the leftmost.
- The server rejects 21 tabs and accepts 20 (spec passing).
- `purgeUser` keeps the 8 latest entries within the TTL.

**AC3 (no refetch on a warm switch), live as `matt@helio.dev`.**
- Activating a tab with Enter and switching back made no request for the panel list or rows. The network log stops at request #2312.
- A reload where the active tab's stored copy came from an earlier leave was warm: only `dashboard-changes` and `runs/latest` were requested.

**C4 (the dot).** The live tab "Helio Roadmap (copy)" shows the dot. Its accessible name is "Helio Roadmap (copy), changed since you last viewed". The computed dot colour is `rgb(33,29,25)`, which is `--app-text` in light; the accent is `#eab308` (Yellow preset).

**Accessibility (live DOM).**
- The tablist is labelled "Open dashboards".
- Tabs have `aria-selected`, with a roving tabindex: 0 on the active tab, -1 on the others.
- The tabpanel's `aria-labelledby` equals the active tab's id.
- Arrow Right moved focus, and the focus ring is closed on all four sides (`dark-1280-tabbar-focus.png`). Enter activated the tab.
- The close control is a sibling of the tab and is `aria-hidden`.

**Residue.** The checks are clean:
- the dev DB has 0 users matching `hel1575%`;
- `git status` is clean in the worktree and in the main checkout.

The one probe that wrote anything was blocked or answered locally, so no conversation was created.

**Design (screenshots I took and looked at).**
- `dark-1280-initial.png`, `light-1280-tabs.png`, `light-1280-tabbar-zoom.png`, `light-820.png`, `light-768.png`, `dark-375.png` and `dark-1280-palette-ask.png`.
- The tab bar follows the B2 board: a raised active tab with a 2px accent top edge, muted inactive tabs, and the "Search, jump, or ask" box at the right. At 820 the box collapses to the icon plus the shortcut keys.
- 768 and 375 use the phone shell with no strip, as designed.
- The accent appears only on the active edge and focus.
- **Neutral dot judgement: accepted.** DESIGN.md section 0 outranks the boards, and an intent colour can collide with an accent preset. A 6px `--app-text` dot reads clearly on a muted inactive tab in both themes.

### Verdict: REFUTE

Two defects, each reproduced at least twice, break owner-binding behaviour that the gates do not exercise.

### Change Requests

1. **The active tab's warm copy is never written on reload, so a reload while viewing a dashboard is cold.** This breaks owner ruling 1 / C1 and the spec scenario "Reload within the TTL is warm" (`specs/dashboard-tabs/spec.md:125-128`: "reloads within 15 minutes of viewing A … THEN A's panels render without requests").
   - **What fails.** `tabsBrowserTriggers.ts` `handlePageHidden` calls `captureTab(..., {immediate: true})`. That fires an async IndexedDB `write()` (`boundedWarmStore.ts:41-57`, `await raw.put`) during `pagehide`, and it does not complete before the document unloads.
   - **Reproduction 1, a fresh browser context** (`evidence/skeptic-final-1/pagehide-probe.cjs`). Log in and view the auto-selected dashboard for 6s: IndexedDB is `[]`. Reload: requests go out for `GET /api/dashboards/e690e243…/panels` and both `/rows`, and IndexedDB is still `[]`.
   - **Control.** Leave the tab and return, then reload: zero requests.
   - **Reproduction 2, the live MCP session.**
     - The `e690e243` entry's stored `lastViewedAt` stayed at `06:51:09` (its last leave) across a reload at `06:52:11`.
     - The `c330858b` tab, never left before its reload, refetched its panels and rows.
   - **Why the e2e misses it.** The e2e "reload within the TTL is warm" (`e2e/hel1575-dashboard-tabs.spec.ts:515-524`) passes only because it switches B, C, then A first and polls until at least 2 entries exist. A's copy therefore comes from the leave path. The same holds for the reload steps in the dragged-panel and renamed-panel cases.
   - **Practical effect.** The most common reload, of the dashboard you are looking at, is always cold. Because the stored `lastViewedAt` is not advanced on hide, the TTL runs from the last leave rather than "when the user last saw it", which is the requirement at line 123.
   - **Fix.** Persist the active tab's entry through a path that does not depend on unload. For example, a debounced `scheduleWrite` once its panel list and row windows settle, and again on change. Keep `pagehide` as a best-effort extra.
   - **Test.** Add an e2e that opens one dashboard, never switches, reloads, and asserts no panel-list or rows request.

2. **"Ask the assistant" does nothing when invoked on `/chat`, and the unsent text is sent later, on reload.** This breaks owner ruling 3 / C3: any palette text opens a new conversation and is sent exactly once.
   - **Cause.** `useAskAssistantAction.ts:28` calls `navigate("/chat", {state: {draft, autoSend: true}})`. `ChatPage.tsx:29-32` reads that state only in a `useState` initializer. When the user is already on `/chat`, `ChatPage` does not remount, so the hand-off is ignored.
   - **Reproduced three times.**
     - Twice in the MCP session: the queries "skeptic from chat page" and "zzq second attempt from chat" made 0 POSTs, and the composer stayed empty.
     - Once in `evidence/skeptic-final-1/ask-probe.cjs`, in step B: `posts=[]` and `history.state={"usr":{"draft":"probe-B already on chat","autoSend":true}}`.
   - **Second effect, step C.** On a reload of `/chat`, the stale history state is read on mount and `POST /api/assistant-conversations` fires. The text is sent at a moment the user did not choose.
   - **Control, step A.** The same action from the dashboard view makes exactly 1 create POST.
   - **Fix.** Key the hand-off on the navigation, not the mount: react to `location.key`/`location.state` changes, or give the `/chat` route `key={location.key}`. Clear the state after consuming it so a reload cannot replay it.
   - **Test.** Add a test for "ask while on /chat sends once", and one for "a reload after a hand-off sends nothing more".

### Non-blocking notes

- **Hairline under the active tab.** A 1px `--app-border-subtle` line runs under the active tab, because `.dashboard-tab-bar`'s border-bottom spans the full width (`light-1280-tabbar-zoom.png`). The B2 board joins the active tab to the bar below with no line, and the CSS comment's "raised so it joins the command bar" intent is undercut. This is polish, not a blocker.
- **DESIGN.md section 9 "Keyboard" says the close is a "24px … control with a 44px touch expander".** Under `pointer: coarse` it is 28px (`--control-sm`), which is what makes the expander tile. Make the doc match.
- **Tabpanel and `display: contents`.** `role="tabpanel"` sits on an element with `display: contents`. Older Safari and Chromium dropped such elements from the accessibility tree. Worth a quick VoiceOver check, or move the role onto a real box.
- **Clipped last tab.** The last visible tab in an overflowing strip is cut with no fade. This was already noted by the executor and is acceptable.
- **HEL-1579 merge order.** This branch adds a `hideDashboardBreadcrumb` prop to `CommandBar`. If HEL-1579 merges first with `app/hidesBreadcrumbItemName.ts`, this branch must fold its condition into that predicate rather than keep a parallel prop. If this branch merges first, HEL-1579 must extend it.
- **Pre-existing, out of scope.** After an Ask hand-off whose create is still pending, `/chat`'s breadcrumb and list highlight show the previously selected conversation while the body shows "New conversation".
