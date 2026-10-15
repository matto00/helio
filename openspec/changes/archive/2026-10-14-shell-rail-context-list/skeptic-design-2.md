## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD e0376657d1940b2c084abc65fdece74a7001283e. The planning artifacts are uncommitted in the change dir.
I treated the owner rulings in ticket.md as binding, including `keep-six-1583-decides`.

### What I verified (with evidence)

- **Round-1 CR1 (delete) is resolved.** `PipelineDetailHeader.tsx:46` already imports `ActionsMenu`, and lines
  196-203 build an `actionItems` array that line 400 renders as `<ActionsMenu label="Pipeline actions">`. Adding a
  `danger: true` Delete item (`ActionsMenuItem.danger` exists, `shared/chrome/ActionsMenu.tsx:7-12`) is a plain
  append. `SourceDetailPage.tsx` delegates its header to `SourceDetailPanel.tsx` (`.source-detail-panel__header` /
  `__title-row`), which has no actions menu yet but has a title row where one can go. Feasible. The design calls it
  "the `SourceDetailPage` header", but the header is actually in `SourceDetailPanel` (see notes).
- **Round-1 CR2: every `UserResponse.fromDomain` caller is enumerated.** `grep -rn "UserResponse.fromDomain"
  backend/src/main` finds exactly four production sites: `ApiRoutes.scala:848` (/me), `AuthService.scala:52`
  (`AuthResult.of`, MFA), `AuthService.scala:246` (`authResultOf`: login, register, OAuth) and
  `BetaAccessRoutes.scala:57`. This matches D2's list. No other code constructs `UserResponse`. On the frontend, the
  login, register, OAuth-callback and verifyMfa `fulfilled` reducers (`authSlice.ts:207/221/239/251`) and `setAuth`
  (`settingsSlice.ts:345`, beta redeem) are the only `currentUser` writers. All of them are covered once the server
  responses carry preferences.
- **Round-1 CR3: the merge SQL works on the TEXT column.** I ran it read-only against the dev DB:
  - `(COALESCE(NULL::text,'{}')::jsonb || '{"contextListWidth":320}'::jsonb)::text` returns `{"contextListWidth": 320}`.
  - With `'{"accentColor":"#ff0000"}'` stored, the merge returns `{"accentColor": "#ff0000", "contextListCollapsed": true}`.
  - Of 13134 users, 52 have non-null preferences, and 0 of those 52 start with anything other than `{`. No stored
    row would make `::jsonb` throw.
  - `upsertGlobalPrefs` overwrites the whole column today (`UserPreferenceRepository.scala`
    `.update(Some(jsonStr))`), so D2 is right that it must change.
- **The RLS claim for `users` is false.** D2 says "`users` already has RLS". It does not:
  - `pg_class` on the dev DB returns `relrowsecurity=f, relforcerowsecurity=f` for `users`.
  - No migration enables RLS on it.
  - `V88__user_tier.sql:9-10` says so explicitly: "`users` itself carries NO RLS ... it is the pre-identity table
    `SlickUserSessionRepository`/`AuthDirectives` read BEFORE any user context exists".
  - `UserPreferenceRepository` runs on the raw app `db` handle (`Main.scala:136`), not through
    `withUserContext`.
  - The planned proof therefore cannot pass. The spec scenario "RLS blocks a cross-user write" (non-BYPASSRLS session,
    `app.current_user_id`=B, merge-update on A's row: "no row is changed"), C3 and task 4.3 would all change A's row.
    See CR1.
- **Can a non-owner trigger a cross-user write?** Not through the planned API. `PATCH /api/users/me/preferences`
  takes no user id and is keyed on `authenticatedUser.id`, the same pattern as the existing `/users/me/update`
  (`ApiRoutes.scala:867-871`). Isolation is application-level, the same as the accent today. That is acceptable, but
  it has to be specified and tested as application-level isolation, not as RLS (CR1).
- **Round-1 CR4: the 768 boundary is pinned and sound.** I count 37 `max-width: 768px` uses, and `theme.css.test.ts:77`
  guards the phone block on `max-width: 768px`. Reading the ticket's ">=768" as "the canonical 768 breakpoint", with
  768 staying phone, is consistent with the codebase and is recorded in DESIGN.md §9. I don't think it needs an owner
  ruling: the boundary moves one pixel, it is disclosed, and the alternative edits ~36 phone stylesheets against AC5.
  One wrinkle: DESIGN.md §4 says "CSS media queries use these values only [mechanical]" (1440/1100/768/430), and
  `min-width: 769px` appears nowhere in `frontend/src` today. See CR2.
- **Round-1 CR5 (OpenAPI) is resolved.** `git ls-files | grep -iE 'openapi|swagger'` returns nothing. The repo's own
  CLAUDE.md defines the contract as `schemas/` JSON Schema plus `openspec/` specs. `check:schemas`
  (`scripts/check-schema-drift.mjs`) checks the schemas against the Scala case classes. proposal.md and design.md now
  agree, and the schema paths are named (task 1.7). This reasonably meets the AC's wording, so no escalation is needed.
- **Round-1 CR6 (tiling test) is resolved.** Task 4.6 names `e2e/hel1574-shell-rail.spec.ts` and covers 768 vs 769 and
  7 owner tabs at 375px, each ≥44px with no overlap. The 320px overflow is accepted under `keep-six-1583-decides` and
  recorded in Risks.
- **V134 is still free** (round 1 checked against origin/main; the plan re-checks before merge).

### Verdict: REFUTE

### Change Requests

1. **Replace the false "users has RLS" premise and the requirement built on it.**
   - **What's wrong:** `users` has no RLS (V88:9-10, `relrowsecurity=f`), and enabling it is out of scope and would
     break the pre-identity session and login lookups. As written, the `user-ui-preferences` requirement "Preferences
     are private to their user" and its scenario "RLS blocks a cross-user write", C3's "and on the preferences write",
     and task 4.3's "and on the preferences merge" specify a test that will fail. That would push the executor either
     to fake the test or to turn on RLS for `users`.
   - **Revise D2:** delete "Row-level security: `users` already has RLS..." and state that preference isolation is
     application-level. The endpoint takes no user id. The repository update is keyed solely on the session user's
     id, the same as the existing `/users/me/update`.
   - **Rewrite the spec requirement and scenario:** user B's `PATCH /api/users/me/preferences` changes only B's row,
     and A's stored preferences (including `accentColor`) are byte-identical afterward. Prove this with a route-level
     test.
   - **Scope C3 and task 4.3 to the two new folder tables only.** The NOBYPASSRLS proof stays mandatory there.
2. **Express the shell boundary without a non-canonical media value, or record an exception.** DESIGN.md §4
   [mechanical] limits CSS media queries to 1440/1100/768/430. D1/C5 prescribe `(min-width: 769px)`. Do one of these:
   - Specify that the rail grid is the default (unqueried) layout and the phone layout overrides it under the existing
     `(max-width: 768px)`. `useIsPhoneShell` uses the same query, and no `769` literal is written in CSS. The app-shell
     spec can keep describing the semantics as "above 768px".
   - Or have D11 add an explicit §4 note allowing `min-width: 769px` as the complement of the canonical 768.

   Either way, C5 must say which.

### Non-blocking notes

- **D12 location.** The source header lives in `SourceDetailPanel.tsx` (`.source-detail-panel__header`), not
  `SourceDetailPage.tsx`. Name the right file in D12/3.5.
- **Who fetches the references.** Today `fetchSourceReferences` fires only from `SidebarBody.tsx:74-76` and
  `SourcesPage.tsx:46`. A deep link or reload on `/sources/:id` will have no `sources.references` unless the detail
  page dispatches it. D12 should say the detail page fetches it, or the HEL-1258 warning silently vanishes there.
- **Pipeline delete warning.** The sidebar's pipeline delete showed a warning ("Any panels bound to this pipeline's
  Outputs will stop working.", `SidebarBody.tsx:147-151`). D12's "same confirm dialog" should explicitly carry it over.
- **Delete visibility.** The sidebar showed Delete to every viewer. In `PipelineDetailHeader`, Share is already
  `isOwner`-gated. Decide whether Delete is owner-gated too, or keep today's parity and rely on the server refusing.
  Say which.
- **Preference parsing.** `getPreferences` currently parses only `accentColor`. Task 1.5/1.6 implies, but should state,
  that it parses the two new keys and ignores malformed ones rather than throwing, since `JsonParser` on the whole
  column is shared with the accent read.
- **Collaborator wiring.** `AuthResult.of` lives on a companion object that `MfaService` calls. Attaching preferences
  there means injecting `UserPreferenceRepository` (or the helper) into `MfaService`, `AuthService` and
  `BetaAccessRoutes`. That is fine, but the executor should expect constructor and wiring changes in `Main.scala` and
  in the test harnesses that build these services.
