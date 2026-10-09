# HEL-1392: Viewport resize remounts panels and refetches rows → resize/theme-toggle bursts hit the /api rate limit ("Rate limit exceeded" on panels)

## Description

origin_kind: followup
origin_ticket: HEL-1181

Side finding from HEL-1181's live probe (not investigated, so verify first): resizing the viewport across grid breakpoints appears to remount panels, and each remount refetches its rows. Bursts of resizes and theme toggles then exhaust the per-user `/api` rate limit (`RATE_LIMIT_REQUESTS_PER_WINDOW`, default 120/60s), and panels show "Rate limit exceeded". A real user rotating a tablet or dragging a window edge on a dashboard with many panels could hit this.

## Acceptance criteria

- Root-cause the remount (breakpoint change → React Grid Layout key churn, or a parent re-keying) and the refetch (cache miss on remount).
- A resize or theme toggle doesn't refetch rows already in redux/pagination state; red-first test counting row fetches across a breakpoint change.
- No change to the rate limiter itself.

## Driver notes (claims to verify)

- Premise is an unverified side finding. Measure in the running app: count `/rows` requests across a breakpoint change and a theme toggle. If not reproducible, widen the repro (many panels, rapid drag-resizes, tablet-width rotation, theme toggles) before calling it not-reproducible.
- If breakpoint changes remount the desktop grid, the unmount flush (`usePanelUpdatesFlush.ts` / `useLayoutSave.ts`) may fire — check for layout writes too.
- HEL-1418 (apply RGL processed-width wait to other live-resize specs; split DesktopPanelGrid.tsx) is a separate ticket: do not absorb it.
- Visual cohesion verified against the RUNNING app in both themes.
- Dev DB: throwaway users, residue removed by exact id; never use matt@helio.dev.

## Owner ruling (2026-10-08, recorded via `concertino answer`, channel=chat): rows-plus-output-meta

Scope is extended beyond the literal AC: in addition to rows, the Output-metadata refetch (`GET /api/outputs/:id`,
`useOutputMeta`) on remount is in scope, because it dominates the per-crossing request burst. Added acceptance criteria:

- A remount of panel cards (desktop grid <-> phone stack swap) does not refetch Output metadata already fetched
  recently; identical concurrent metadata requests are merged into one network request.
- The metadata cache is invalidated when an Output is written (edit/config patch, kind change, delete) and when its
  pipeline is re-run or edited, so fresh metadata and rows still appear after those events (tested explicitly).
- The proof measures ALL `/api` requests across N desktop<->phone crossings in the running app, before and after the fix,
  accounting for React StrictMode dev doubling and stating the production expectation.
- The cold-load double row fetch (16 requests for 8 panels in dev) is investigated: fixed if it is the same root
  cause, otherwise listed as a follow-up.
- Still no change to the rate limiter.
