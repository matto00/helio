# HEL-1701 root cause

Mechanism (H1, probe-confirmed): `Link` to `/chat` calls `history.pushState` synchronously, but React Router v7
commits the resulting location inside a transition. Under CPU load the render trails the URL: the URL is `/chat`
while the whole previous tree (Dashboards h1, Dashboards tab with `aria-current="page"`) is still committed. The commit
is atomic: tab state and `/chat` content change in one commit. `ChatPage` is not lazy; no chunk load is involved.

Probe (probe-timeline-4x.txt, 6 runs at 4x CPU): `pushState path=/chat cur=[Dashboards=page] h1=[Dashboards]` then,
~150 ms later, one mutation batch `path=/chat cur=[] h1=[Assistant]`. No frame ever shows the /chat page with a tab
current. Red: 5 of 10 runs fail at 4x throttle (red-throttled-4x.txt); 0 of 40 fail warm.

Decision (design D3): the nav agrees with what the user sees (previous page and its tab, together), so no user sees
a wrong state; the test is wrong to snapshot on URL alone. Fix is test-side: wait for ChatPage's own composer
(`main` > textbox "Message") before the snapshot. The assertion that no tab is current on /chat is unchanged; no
timeout or retry added.

Results (all dev build, lane DB, 2 workers, nice -n 19):
- Fixed test, 4x throttle: dark 10/10 + light 10/10 pass (green-4x.txt; p~0.5 so ceil(3/p)=6 runs suffice, 20 run).
- Fixed test, warm: 40/40 across both theme spec files (green-40-warm.txt).
- Mutation (fix reverted), 4x throttle, dark: 10/10 fail (mutation-red-4x.txt).
- Both full glass-nav spec files, warm: 30 passed (regression-full-glass-nav.txt).
Throttling wrapper source: probe-throttle-wrapper.spec.ts.txt (temporary, not committed as a spec).
