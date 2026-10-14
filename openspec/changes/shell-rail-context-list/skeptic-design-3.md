## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: HEAD e0376657d1940b2c084abc65fdece74a7001283e. The planning artifacts are uncommitted in the change dir (`git status`: `?? openspec/changes/shell-rail-context-list/`).
The spawn-cwd guard returned `READY ambient=/home/matt/Development/helio branch=feature/shell-rail-context-list/HEL-1574`.

### What I verified (with evidence)

- **Round-2 CR1 (users RLS) is resolved.**
  - D2 (design.md:72-76) now says `users` has **no** RLS, citing V88. It says isolation is application-level: the endpoint takes no user id, and the merge is keyed only on the session user's id. A route test proves that B's PATCH leaves A's stored preferences byte-identical. It also says "No RLS change to `users`".
  - The `user-ui-preferences` spec's "Preferences are private to their user" requirement now has the route-level byte-identical scenario. It no longer has a NOBYPASSRLS scenario.
  - C3 (tasks.md:5) and task 4.3 (tasks.md:47) now cover only the two folder tables. Task 4.4 carries the B-PATCH byte-identical check.
  - I ran `grep -rni "rls|row.level|bypassrls"` across proposal, design, tasks and specs. No remaining hit claims RLS on `users` or on preferences. Every RLS hit refers to the folder tables, the V62 schedules or the RLS-scoped pool.
- **Round-2 CR2 (769 media query) is resolved.**
  - D1 (design.md:23-25) makes the rail grid the default unqueried layout, overridden under the existing `(max-width: 768px)`. It says explicitly that no `769` query is introduced, per DESIGN.md §4.
  - C5 (tasks.md:7) says the same, and adds that `useIsPhoneShell` uses the same query.
  - `grep -rn 769` on the artifacts finds only two hits:
    - design.md:24, the sentence saying no 769 query is added.
    - Task 4.6's Playwright viewport widths (768 vs 769 vs 820). These are test viewport sizes, not CSS media values, so they are correct and desirable.
  - DESIGN.md:419 confirms the §4 rule ("CSS media queries use these values only").
  - The current shell CSS already uses `@media (max-width: 768px)` (`app/App.css:577`, `shared/chrome/BottomNav.css:9`), so the override approach fits the existing pattern.
- **Spec and design agree.**
  - The app-shell spec says the rail is absent at 768 and below and present above. That matches D1 and C5.
  - The `user-ui-preferences` spec (partial PATCH, 400 cases, merge in both orders, preferences on all six auth responses) matches D2 and tasks 1.5, 1.6 and 4.4.
  - The `dashboard-folders` spec's RLS requirement matches D7 and task 4.3.
  - The delete-on-detail-page requirement matches D12, which now names `SourceDetailPanel.tsx`, the fetch on mount, the carried-over pipeline warning text, and parity visibility. Task 3.5 matches as well.
- **The round-2 non-blocking notes are all folded in:**
  - SourceDetailPanel (D12, task 3.5);
  - the references fetch on mount (D12);
  - the pipeline warning text (D12);
  - delete visibility at parity with the sidebar (D12: "no new gating");
  - `getPreferences` parsing the new keys and dropping invalid values (D2);
  - wiring in `AuthService`, `MfaService`, `BetaAccessRoutes`, `Main.scala` and the test harnesses (D2).
- **V134 is still free.** The newest migration is V133 in both the worktree and `origin/main` (I fetched it fresh).
- **The schema paths are plausible.** `schemas/auth/` exists. No preferences or user-response schema exists yet (`grep accentColor schemas` returns nothing), so task 1.7's new files do not collide with anything.

### Verdict: CONFIRM

### Non-blocking notes

- The `owner-usage-admin` spec says "The phone bottom nav is unchanged". In context that means "Usage stays there". Read literally, it sits awkwardly beside the Home tab that `nav-section-registry` adds. Consider rewording it to "keeps its Usage tab" when the spec is synced.
- The design decisions run D10, D12, D11 out of numeric order. This is cosmetic.
- The `user-ui-preferences` spec requires rejecting unknown fields with `400`. spray-json ignores unknown fields by default, so the executor needs an explicit key check, and task 4.4's "400 cases" should include an unknown-field case.
