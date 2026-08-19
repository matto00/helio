# HEL-746: HOTFIX: No mobile-reachable way to start a new chat conversation

## Description

Confirmed live at 390×844 (main HEAD c6105095, right after today's 7-ticket batch): the "New chat" trigger (`frontend/src/shared/chrome/SidebarItemList.tsx`, `aria-label="New chat"`) only exists inside the desktop sidebar, which is `display: none` at ≤768px (`App.css` mobile media query). No equivalent affordance exists anywhere in the mobile chrome — checked `BottomNav.tsx`, `MobileNavSheet`, and `CommandBar.tsx`'s quick-launcher, all of which just land on the user's most-recent existing conversation. A mobile user with an existing conversation history has no way to start a fresh one at all.

Raised alongside a user report of "chat is broken on mobile" (a screenshot showing a completely blank Assistant-area page). Direct `/chat` navigation and the bottom-nav "Assistant" tap were tested against the dev account and rendered correctly (existing conversation, no console errors) — this specific gap was not reproduced exactly as described, and could be a distinct issue tied to a specific account/dashboard/conversation state not available in the test account. **Root-cause this fully before closing** — reproduce against the actual reported scenario if possible (ask the user for the specific dashboard/conversation, or a screen recording, if a fresh investigation still can't reproduce a genuine blank-page crash). Do not treat fixing the "new chat" affordance alone as closing out the "chat is broken" report unless live re-verification confirms that was the whole story.

## Acceptance Criteria

- Add a reachable "New chat" affordance to the mobile chrome — e.g., in `BottomNav.tsx`'s Assistant tab, `MobileNavSheet`, or a `CommandBar.tsx` control visible on `/chat*` routes — following the existing pattern in `SidebarItemList.tsx`'s desktop trigger.
- Root-cause the "chat is broken on mobile" blank-screen report beyond the confirmed missing-affordance gap: try additional accounts/dashboards/conversation states, check for a React error boundary swallowing a crash, check for a genuinely-empty-conversation-list cold-start state that might render blank.
- Do not treat the affordance fix alone as closing the broader "chat is broken" report unless live evidence shows it was the whole story. If a genuine blank-screen crash is found and distinct from the affordance gap, fix it too (or escalate/spin off if out of hotfix scope).
- Verify against a real mobile viewport (390×844) before closing — explicit user request to scrutinize quality this round given hotfix urgency.

## Context

Filed 2026-08-18 as an urgent hotfix from live post-merge mobile testing, right after today's 7-ticket batch merged to main.

## Correction (mid-planning, direct from the user via the coordinator)

The "chat is broken on mobile" report is specifically about tapping the **"Open assistant"
quick-launcher icon** (`CommandBar.tsx`'s `faComments` icon, `onClick={onOpenQuickLauncher}`) from
the **dashboard page** — not the "Refine with AI" icon, and not the missing-affordance gap above.
Symptom: a blank area with just a horizontal line, nothing else.

The **same** symptom also appears when tapping **"Review proposal"** (`ProposalHandoff.tsx`'s
button, `navigate("/pipeline-proposals/review"` or `"/combined-proposals/review"`, with
`location.state`). Two different triggers producing an identical visual symptom strongly suggests
one shared root cause. User's own hypothesis to verify (not assume): a modal/sheet
height-calculation bug on mobile viewports — the horizontal line could be a collapsed sheet's own
drag-handle/header border with a zero-height body.

Requested: reproduce BOTH exact flows live at 390×844, find the real shared root cause, and widen
the check to any other action routing through the same component. The missing-"New-chat"-affordance
gap above is still real and worth fixing, but is very likely a **separate, unrelated finding** —
not assumed to be the same bug as this report.
