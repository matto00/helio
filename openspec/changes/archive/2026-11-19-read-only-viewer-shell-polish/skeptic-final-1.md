## Skeptic Report — final gate (round 1, skeptic-final-1.md)

**Reviewed:** HEAD `34431b1454bdc66f77f0010ff6a690662271ca6b`.

**Base:** `d8cdfb460f65d130af533770aeadc798dbe30daf`, resolved live with `resolve-review-base.sh` (main, origin).

**main drift:** origin/main is one commit ahead (`dfb65eebb`, HEL-1775: ask, output editor, backend). It shares no file with this diff, and `git merge-tree` merges cleanly.

### What I verified (with evidence)

**Spawn guard:** `assert-cwd.sh` returned READY.

**Scope and sibling lanes:**
- The diff (`git diff d8cdfb460...HEAD --stat`, 42 files) touches nothing under `features/dashboards/tabs/**`, the warm cache, `usePanelData`, `.github/**` or the shard weights. HEL-1783 and HEL-1778 are untouched.
- `dashboardsSlice.ts` changes only `getMostRecentDashboardId` (D6/D7).
- The diff contains no backend change.

**Gates, run by me (nice -n 19, 3 jest workers):**
- `npm run lint`, `npm run typecheck` and `npm run format:check` each exited 0.
- Full frontend jest: 870 suites and 10252 tests passed.
- Targeted jest over the changed areas: 43 suites and 437 tests passed.

**Red-first commits are genuine:**
- I checked out `02eb5def9` in a scratch git worktree (removed afterwards) and ran the new tests against the base source.
  - 14 tests failed across 9 suites, each for the missing behaviour: View only (desktop at tier 3, phone), useLayoutUndoRedo viewer, slice shared-only landing (including after delete), Shelf drop zone, PanelList drop zone, the sidebar and sheet rows, and badge equality.
  - `CreateCommandActions.roles` passed at red. That is expected: D3 is a lock with no code change.
- The viewer undo test seeds history with `pushLayoutSnapshot` and has a non-vacuous editor companion.
- Tests edited after a red commit, none of them weakened:
  - `DashboardRefreshLine.test.tsx`: the viewer case now expects "View only" (the intended behaviour change), and the editor case still expects null.
  - `DashboardChipRow.css.test.ts`: the no-accent check now excludes only the `.dashboard-chip__shared` rule.
  - `PanelList.test.tsx`: an owner control was added.
  - The e2e only gained assertions (label overflow, step-by-step, dismiss).
  - `3b3d4a029` and `238518fdd` add tests only.

**Selector grep (C16):** I grepped `e2e/` for `dashboard-chip__shared`, "No dashboard open", the first-run drop zone, `dashboard-refresh-line`, the meta-facts classes, `mobile-nav-sheet__item` and `dashboard-list__item`.
- `hel1573-motion-primitives` counts `li.dashboard-list__item`. The new footer row is one of those, but it renders only for a user who owns nothing, and that spec's user owns its dashboards, so the count is unaffected.
- `hel813` reads `.mobile-nav-sheet__item`, and the footer row inherits that rule's 44px floor.
- `hel1786` was correctly narrowed to `.dashboard-meta-row__refresh`.

**e2e, run by me against lane DB `helio_hel1782` (DATABASE_URL and DB_USER set for both the servers and Playwright, ANTHROPIC_API_KEY empty, 2 workers):** `hel1782-viewer-shell`, `hel1773-viewer-grantee-dashboard`, `hel1786-shared-dashboard-freshness`, `hel1646-skeleton-refresh-slot`, `hel1583-refresh-line-no-shift` and `hel1575-dashboard-tabs` gave 53/53 passed (7.7 min).

**Acceptance criteria, traced:**
1. **View only, desktop.** `DashboardMetaFacts.tsx` renders it as the first child when `viewOnly`, and `DashboardMetaRow.tsx` passes the role from `selectDashboardAccessRole === "viewer"`.
   - **Phone.** `DashboardRefreshLine.tsx` reads the current role and always renders the line for a viewer.
   - **On the running app.** The phone line is 19.19px (12px × 1.6, the fixed slot) and "View only" has no `aria-hidden` ancestor.
2. **Empty states and CTAs.**
   - A viewer's zero-panel dashboard shows "No panels yet / This dashboard has no panels yet." with no CTA (screenshot `skeptic-viewer-empty-dark`).
   - The panel kebab offers only "View details" (live probe).
   - `cta-audit.md` covers the rest.
3. **Palette.** The registrants are BuiltIn (navigation, theme, assistant, help) and Create (the global creates, plus Add panel, which drops out for a viewer). The e2e asserts no "Add panel" for a viewer.
   - The quick launcher is the assistant, made read-only by HEL-1785.
4. **Shortcuts.** `shortcuts.ts` declares only five global bindings. The only editing ones are `layout-undo` and `layout-redo`, now gated by `when: dashboardId !== null && canEdit`.
   - `useLayoutEditEscape` cannot fire for a viewer, because edit mode is unreachable.
   - The e2e asserts `defaultPrevented === false` and no layout PATCH.
5. **Phone sheet, chips and pull-to-refresh.**
   - Share stays owner-only, and the editor e2e asserts no Share and no View only.
   - The pull and refresh path issues no `/api/outputs` or `/api/pipelines` request (e2e network guard).
6. **Shared-only first run.**
   - `getMostRecentDashboardId` falls back to `dashboards[0]` (owner ruling 1). Live, the newest shared dashboard auto-opened.
   - The drop zone appears on Home below the shelf and on /dashboards through the sidebar and sheet "Build your own dashboard" row (owner ruling 2). I verified both live, on desktop and phone.
7. **Chip badge.** CSS equality is asserted against `.dashboard-list__shared-badge` and `.home-card__shared`, and the e2e compares computed styles.
   - The active chip uses an inverse pill, which stayed legible in both themes (screenshots).
8. **Both themes.** I checked light and dark, desktop (1440) and phone (390). The only console error was the pre-login 401 on `/api/auth/me`.

**Design judgment (DESIGN.md):**
- "View only" is a plain muted mono fact with an Eye icon at `ICON_SIZE.sm`. It has no pill and no accent, follows DESIGN.md §0 accent discipline, and does not compete with the SHARED badge.
- The sidebar row reuses `.dashboard-list__button` and `.dashboard-list__name`, so its type matches the sibling rows, and it carries a leading Plus.
- The sheet row reuses `.mobile-nav-sheet__item`.
- The drop zone is the existing, unchanged component.
- New CSS uses tokens only (`--space-*`, `--app-*`). The one literal `2px` padding mirrors the existing badge recipe.
- Light and dark are consistent.

**Evidence (persisted):** `/home/matt/Development/helio/.concertino/runs/HEL-1782/evidence/.concertino/scratch/HEL-1782/`:
- Desktop: `skeptic-viewer-desktop-a.png` (light), `skeptic-viewer-desktop-dark.png`.
- Shared-only drop zone: `skeptic-sharedonly-dropzone-light.png`, `skeptic-sharedonly-dropzone-dark.png`.
- Viewer zero-panel dashboard: `skeptic-viewer-empty-dark.png`.
- Home: `skeptic-home-sharedonly-dark.png`.
- Phone: `skeptic-phone-viewer-dark.png`, `skeptic-phone-viewer-light.png`, `skeptic-phone-sheet-dark.png`, `skeptic-phone-dropzone-dark.png`.

None of these claims rests on mtime ordering.

**Cleanup:**
- My three throwaway users were deleted by exact id with `buildUserDeleteSql`, which left 0 rows.
- The servers were stopped with `stop-servers.sh` (STOPPED 7214,10121).

### Verdict: CONFIRM

### Non-blocking notes
- **Two create rows in the phone sheet.** For a shared-only user the sheet shows "New dashboard" at the top and "Build your own dashboard" at the bottom: two create affordances with different outcomes (a blank dashboard, or the CSV drop zone). Owner ruling 2 sanctions this. A later copy pass could make the difference clearer.
- **The tab stays after "Build your own".** After "Build your own dashboard" on desktop, the previously open tab stays in the tab bar, inactive. The design expects this (`clearActiveTab`), but it differs from a closed tab. It is HEL-1783's area if anyone wants it changed.
- **Evaluator's `status === "failed"` note (blank pane).** The evaluator noted that a shared-only user could see a blank pane if the dashboards status is `failed` with items retained. That state is unreachable today; I agree it is a follow-up at most.
