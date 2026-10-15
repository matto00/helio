# HEL-1575: Persistent dashboard tabs with server-side TTL warm cache, plus ⌘K "search, jump, or ask"

## Description

Dashboards are the owner's daily surface, and moving between them today means going back through the sidebar every time. Open-dashboard tabs make switching instant, give dashboards their identity (replacing the page title), and naturally define what to keep warm, which shapes future caching.

## What

- A tab strip at the top of the content area: the active tab is marked with an accent top bar, a dot marks a dashboard that changed since you last viewed it, plus close (×), "+" to open, and drag to reorder. Middle-click or `⌘`-click on a dashboard in the context list opens it in a new tab.
- **Persistence (owner ruling):** the open-tab set, order and active tab are saved **server-side per user** and restored on any device. Each tab's loaded state is kept warm for a **TTL**. A return within the TTL renders instantly from warm state. After expiry the tabs and their order remain, and each dashboard simply reloads (an extra second or two is acceptable). The spike/design picks client vs server warm-state storage and the TTL value, and measures dashboard load time under a realistic panel count.
- The `⌘K` box in the tab bar, styled as "Search, jump, or ask". Extend the existing command palette (HEL-516) so a query can also hand off to the Assistant.
- Tab open and close animate in place (motion primitives) once the motion foundation lands.
- Reference: "B2 · Dashboard" and "Motion II" (panel 3) on the epic's canvas.

## Acceptance criteria

- [ ] Opening, closing, reordering and switching tabs works with mouse and keyboard, and the tab strip is an accessible `tablist`
- [ ] The tab set and order survive a reload and a sign-in on a second device (server-persisted, schema, OpenAPI and backend tests)
- [ ] Switching to a tab within the TTL makes no dashboard/panel refetch (verified via network log). After TTL expiry the tab still exists and refetches on activation
- [ ] The chosen TTL and the measured warm vs cold switch times are recorded in the PR
- [ ] `⌘K` opens the palette from anywhere, and a free-text query offers an "Ask the assistant" action

## Owner rulings (HEL-1575 escalation, answered 2026-10-15 via chat)

1. `client-persistent-15m`: warm state is kept in client memory plus a per-user browser-stored copy that survives a page reload within 15 minutes. The tab set, order, active tab and last-active times are saved server-side. The browser copy must respect the existing outputFreshness generations/invalidation, be cleared on logout, be per-user, be size-bounded, and hold no secrets.
2. `scroll-cap20-lru`: the strip scrolls sideways when tabs do not fit (active tab kept in view); the saved set is capped at 20, and opening a 21st closes the least recently used inactive tab; only the 8 most recently used tabs are kept warm.
3. `new-chat-send`: any typed palette text adds "Ask the assistant: <text>", which opens the Assistant in a new conversation with the text sent as the first message.
4. `data-or-edit`: the tab dot shows when the dashboard was edited, or a pipeline run produced new data for one of its panels, since the user last had that tab open. The design must define exactly which signals drive it.

Earlier rulings (HEL-1570/1571/1574): no dashboard page title; Home is a rail item aliasing the dashboards view until HEL-1578; per-user UI preferences live in `users.preferences` (extend it, no second table); motion foundation (HEL-1573) not shipped, so tab motion is static and no motion tokens are invented. "OpenAPI" in the AC: the tree has no OpenAPI document; the contract is `schemas/` JSON Schema plus openspec specs (premise validation, minor staleness).
