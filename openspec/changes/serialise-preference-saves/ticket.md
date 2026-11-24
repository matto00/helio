# HEL-1829: Settings appearance: rapid radio changes send unordered preference saves, so an older choice can win

## Description

Follow-up to HEL-1826 (PR #1240, merged as 943b5dd73). The owner chose a standalone ticket that serialises the saves.

### Problem

In Settings → Appearance, each radio change runs `handleAppearanceChange` → `saveAppearancePreferences` (`frontend/src/main.tsx`). That sends its own `PATCH /api/users/me/preferences`, and nothing orders the requests, so whichever arrives last wins. Clicking Mono then Serif quickly can leave the stored preference on Mono, even though the UI showed Serif.

The CI trace from HEL-1826 shows Mono's PATCH landing after the final Serif one. Holding the Mono PATCH reproduces it. HEL-1826 fixed only the test, by waiting for each style's save; the app is unchanged.

### Do

- Serialise preference saves. Allow at most one request in flight. While one is in flight, keep only the latest pending choice, and send it when the current request settles. The stored result must equal the user's last choice.
- Check the other preference writers that share this route, such as the assistant default model (HEL-1755) and motion. Use one serialiser for all of them, so saves of different fields can't overwrite each other either. Confirm whether the PATCH merges fields or replaces them.
- Make the HEL-1572 appearance spec toggle rapidly again, without waiting for each save, and assert it ends on the last choice.

## Acceptance criteria

- [ ] A test that fails first: with an earlier PATCH held, rapid changes end with the last choice stored, read back from the server.
- [ ] No extra requests: at most one in flight, plus one trailing.
- [ ] The e2e guard passes 20 times in a row, also under 4x CPU throttling.

## Driver context (verified at Planning)

- The PATCH MERGES per top-level key server-side (`UserPreferenceRepository.mergePrefs`, jsonb `||`; `motion: null` removes the key). A coalesced trailing save therefore carries the union of every queued key, latest value per key.
- Writers of `PATCH /api/users/me/preferences` on main 71e2802bb: `saveAppearancePreferences` (type style, density, motion), `saveShellPreferences` (`useContextListLayout.ts`: context-list width/collapsed), `saveAssistantModelPreference.ts` (HEL-1755 `assistantModel`), `tabsPersistence.ts` (`dashboardTabs`: `patchDashboardTabsRequest` and a `keepalive` `fetch` flush).
- HEL-1634: new module-level per-user state registers a session reset (`registerSessionReset`), enforced by `sessionResetGuard.test.ts`; a pending save must never fire for user A after A signs out.
- Frontend only; no backend change, no migration.
