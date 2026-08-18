# HEL-745: HOTFIX: CommandBar mobile — move theme toggle to Settings (still not done) + fix oversized icon touch-targets

## Description

Two related regressions/gaps in `frontend/src/app/CommandBar.tsx`'s mobile layout, found via live testing right after today's 7-ticket batch (HEL-711/739/719/740/728/716/718, main HEAD c6105095).

### 1. Theme toggle was never actually moved to Settings — explicit human instruction, still unmet

**This is a direct, twice-stated instruction, not a design recommendation to weigh against precedent.** The user explicitly asked (in chat, before HEL-728 was filed): "move theme toggle (light/dark mode button) to settings, or at least user popover menu." This exact instruction was recorded as a comment on HEL-728. HEL-728's delivery (PR #389, merge commit `68bc8381`) explicitly did NOT do this — it kept the theme toggle unchanged in `CommandBar.tsx` (`faSun`/`faMoon`, `onClick={toggleTheme}`), citing the ticket's own pre-existing description (an old F-082 precedent — "the top-bar icon is the single canonical theme toggle") as authoritative over the newer explicit instruction, and only moved the accent-color picker to Settings.

**Do it this time.** Move the theme (light/dark) toggle out of `CommandBar.tsx` into Settings — either its own control in the new "Appearance" section HEL-728 already created (alongside the accent picker), or at minimum into the `UserMenu` popover if Settings is judged the wrong home. Update/remove the stale F-082 comment block in `frontend/src/features/auth/ui/UserMenu.tsx` (~lines 68-70, 159-164) since this explicitly reverses that decision. Do NOT re-litigate "should it stay in the top bar" — that question was already asked and answered by the user; this ticket's job is to execute the answer.

### 2. Icon-only buttons in the mobile CommandBar are oversized/cramped

Confirmed live at 390×844: `CommandBar.tsx`'s icon-only buttons ("Open assistant", theme toggle, etc.) now measure 44×44px on mobile, nearly filling the entire 48px-tall command bar.

**Root cause:** `frontend/src/shared/ui/IconButton.css:99-107` — `@media (max-width: 768px) { .ui-icon-btn { min-width: 44px; min-height: 44px; } }`, the established HEL-308/314/319 mobile touch-target-floor convention. HEL-718 (commit `c6105095`) migrated CommandBar's icon buttons onto this shared `IconButton`/`.ui-icon-btn` primitive, which carries the floor unconditionally. Confirmed via `git show cccbdba3^:frontend/src/app/App.css` that the pre-HEL-718 `.cmd-btn--icon` class these buttons previously used had no such mobile floor (stayed ~28px, same as desktop). Desktop is unaffected — confirmed still 28px there.

**This is not a bug in intent** (44px touch targets are correct, established practice — do not remove the floor / do not shrink below 44px, that would be a real accessibility regression) **— it's a bug in effect**: the 48px-tall command bar was never designed to hold 44px squares. Fix belongs in the bar's own sizing (increase mobile height/padding to properly frame 44px targets) rather than fighting the touch-target floor. Note: fixing item 1 above (removing the theme-toggle icon from this row entirely) directly reduces the crowding this describes — implement both together, in this order, and re-measure item 2's severity after item 1 lands before deciding how much additional bar-height/padding work is still needed.

## Acceptance Criteria

- The theme (light/dark) toggle is removed from `CommandBar.tsx`'s mobile (and desktop — single canonical toggle, not a mobile-only move) top bar and relocated to Settings' "Appearance" section (preferred) or, at minimum, the `UserMenu` popover.
- The stale F-082 "single canonical top-bar toggle" comment block in `frontend/src/features/auth/ui/UserMenu.tsx` (~lines 68-70, 159-164) is updated/removed to reflect this reversal.
- At a real 390×844 mobile viewport, the CommandBar's remaining icon-only buttons (44×44px touch targets, per the HEL-308/314/319 floor — do not shrink below 44px) are no longer cramped/oversized relative to the bar: the bar's own mobile height/padding is adjusted to properly frame 44px targets.
- Desktop layout (28px icon buttons, existing command bar height) remains unaffected.
- Both changes are live-verified at a real 390×844 mobile viewport (not just jsdom/unit tests) before this ticket is considered done, per explicit user request to scrutinize quality this round.

## Context

Filed 2026-08-18 as an urgent hotfix from live post-merge mobile testing (post HEL-711/739/719/740/728/716/718 batch, main HEAD c6105095). Priority: Urgent.
