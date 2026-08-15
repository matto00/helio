## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Scope.** `git diff --name-only origin/main...HEAD` — 22 `frontend/**` files + openspec artifacts,
no backend/schema files. Matches `files-modified.md`/evaluation-1.md's claim.

**1. `renderRowAction` sibling-not-nested claim + live pin/unpin behavior.**
Read `frontend/src/shared/chrome/SidebarItemList.tsx` in full (not the evaluator's/prior skeptic's
narrative). Confirmed structurally: the row's own `<button onClick={() => onSelect(item)}>`
(lines 183-201) and the `renderRowAction` slot (lines 222-224, `<span
className="dashboard-list__row-action">{renderRowAction(item)}</span>`) are genuine siblings inside
the shared `dashboard-list__item-row` div — exactly the same DOM position `ActionsMenu` already
occupies (lines 225-236), just gated on its own prop. `SidebarBody.tsx`'s `chat` branch
(lines 253-269) passes a real `<button>` with its own `onClick` dispatching `togglePinned` — no
nesting, no `stopPropagation()` needed or used.

Live-reproduced (Playwright, real backend data at `localhost:6096/chat`, 7 real conversations):
with "Test skeptic verification message" selected/active, clicked "Unpin" on the different,
non-selected, pinned conversation "Show me revenue trends for Q3". Result: its pin badge and
row-action label toggled (`Unpin` → `Pin`), the `PATCH` fired — but the active/pressed row and the
`ActiveConversationPanel`'s title ("Test skeptic verification message", "2 messages") were
unchanged. Re-pinned it to restore state. Then independently clicked a genuine unselected
conversation row ("Show me total revenue by region") and confirmed selection *did* move (title +
"1 messages" updated, active-dot moved) — proving the row action and the row's own selection click
are genuinely independent handlers, not that selection is simply broken. Also ran
`SidebarItemList.test.tsx`'s `renderRowAction` describe block (3 tests, including "clicking the row
action does not also dispatch onSelect") and `App.test.tsx`'s chat phone-sheet tests myself — pass.
**Claim 1 confirmed.**

**2. `navDestinations.ts` "automatic" claim (D1) vs. the genuinely-required mobile-switch edits (D2).**
Read `frontend/src/shared/chrome/navDestinations.ts` (6 entries, Chat appended), `App.tsx`
(sidebar `nav` maps `navDestinations` directly, lines 466-476 — zero per-entry logic) and
`BottomNav.tsx` (maps `navDestinations` directly, lines 15-30 — also zero per-entry logic).
`git diff` confirms `BottomNav.tsx` itself has **zero** lines changed (only its test's expected-tab
list gained "Chat"). D1's "automatic" claim is accurate for both consumers.

Separately, confirmed `SidebarBody.tsx`'s `sectionFromPathname` (lines 280-289, new
`"/chat"` branch + union member) and `App.tsx`'s `breadcrumbLabel` (lines 80-88), `mobileSheetItems`
switch (lines 153-206, new `case "chat"`), `mobileSheetEmptyMessage` Record (lines 218-225, new
`chat:` key), and `handleMobileSheetSelect` switch (lines 227-248, new `case "chat"`) all received
genuine new code — not generated/inferred. **Claim 2 confirmed, both halves.**

**3. `mobile-bottom-nav` spec correction (four→six) — accurate and disclosed.**
Read the live base spec `openspec/specs/mobile-bottom-nav/spec.md`: current text says "exactly the
**four** section destinations... (`/`, `/sources`, `/pipelines`, `/registry`)" — Metrics is absent
(pre-existing HEL-553 gap, confirmed `navDestinations.ts` already had 5 entries before this ticket).
The change's delta (`specs/mobile-bottom-nav/spec.md` in the change dir) correctly lands on "six...
(`/`, `/sources`, `/pipelines`, `/registry`, `/metrics`, `/chat`)". `proposal.md` lines 41-46
("Modified Capabilities") states this accurately as "corrected from **four**... to **six**...folds
in that pre-existing spec-sync repair... self-approved, disclosed explicitly (see design.md D8)" —
a real disclosure, not smuggled. `openspec validate chat-nav-destination --strict` reproduced
myself: `Change 'chat-nav-destination' is valid`. **Claim 3 confirmed.**

**4. No delete affordance / no composer / minimal placeholder.**
`grep -rn "delete\|Delete"` across `frontend/src/features/assistant/` (excluding tests) returns
nothing. Read `ActiveConversationPanel.tsx` in full: renders only a title + `{transcript.length}
messages` plus the 3 DESIGN.md §7 states (empty/loading/error) — no message list, no composer, no
send button, no textarea. Read `ChatPage.tsx`: fetches the list and renders the placeholder panel,
nothing else. Live-confirmed no delete UI anywhere in the chat section (`document.querySelectorAll`
sanity plus visual/accessibility-tree read). **Claim 4 confirmed.**

**5. No regression to the 5 existing sections (AC3).**
Ran the full suite myself: `npx jest --config jest.config.cjs` → **164 suites / 1650 tests passed**
(matches evaluation-1.md's claim exactly, reproduced independently, not trusted). `npm run lint`
clean (zero warnings), `npm run format:check` clean. Live spot-check: navigated to `/sources` —
renders all 40+ real sources, delete `ActionsMenu`/confirm flow intact, breadcrumb shows "Data
Sources / HEL-328 smoke source (renamed)" (the selected item), no stray `renderRowAction` slot
(sources doesn't pass the prop). **Claim 5 confirmed.**

**Additional checks:**
- `npm --prefix frontend run build` not re-run (evaluator's report already showed a clean production
  build and no source changed since; lint/test/format re-runs above are the higher-signal checks for
  this diff).
- `npm run check:openspec` reproduced: fails with the same "complete (27/27) but not archived"
  message the executor's bypassed-hook commit cites — expected, archiving is the orchestrator's job.
- Light/dark parity: toggled theme live on `/chat` — `--app-*` tokens repaint correctly in both
  modes, no hardcoded-color artifacts (`ActiveConversationPanel.css`/`ChatPage.css` read in full,
  100% token-based).
- Console: zero errors/warnings scoped to this navigation across list load, pin, unpin, select,
  theme toggle.

### A real gap the evaluator and both design-gate rounds missed

Design.md D4 claims: **"Route/page/slice pattern mirrors Type Registry/Sources exactly
('Redux-selection' flavor)."** I checked this specific claim against live behavior, not just the
mechanical wiring the evaluator checked (list rendering, selection dispatch).

`App.tsx`'s `breadcrumbItemName` (lines 129-145) is the mechanism that resolves the *currently
selected item's name* into the desktop breadcrumb ("Data Sources / \<source name\>") and the phone
section-switcher pill's "current: \<name\>" label (`mobileTitleDisplayName`, line 215). It has arms
for `"sources"`, `"pipelines"` (route-id based), `"registry"`, and `"metrics"` (route-id based) —
**but no `"chat"` arm; it falls through to `return null`.**

Live-verified at both 1440px and 768px, and confirmed against the exact sibling section (`sources`,
also a Redux-selection section per D4, not a route-per-item one like pipelines/metrics):

- `/sources` with a source selected: desktop breadcrumb reads **"Data Sources / HEL-328 smoke
  source (renamed)"**; on `/chat` with "Show me total revenue by region" selected and its panel
  showing that exact title, the breadcrumb reads only **"Chat"** — no conversation name, ever,
  regardless of selection.
- Mobile pill (768px): `sources` shows `aria-label="Switch data sources (current: HEL-328 smoke
  source (renamed))"`. `chat`'s pill shows `aria-label="Switch chat (current: Chat)"` — literally
  the section label repeated as the "current" value, never the actual selected conversation's title.
  This means a phone user cannot tell which conversation is open from the chrome without opening the
  sheet and checking which row is marked "Current" — a real information loss, not a cosmetic one, on
  the one surface (mobile) where the sidebar list itself is hidden.

This is not a disclosed scope cut. `design.md` D2's explicit "MobileNavSheet parity requires
explicit parallel edits" list names exactly four functions needing a `"chat"` arm —
`sectionFromPathname`, `mobileSheetItems`, `mobileSheetEmptyMessage`, `handleMobileSheetSelect`,
`breadcrumbLabel` — and `breadcrumbItemName` appears in **none** of design.md, proposal.md, or
tasks.md (grepped all four planning artifacts; zero hits). `tasks.md` 2.3 scopes the mobile-switch
work to the same four functions design.md names. Both skeptic-design rounds (skeptic-design-1.md,
skeptic-design-2.md) verified those same four functions and never checked `breadcrumbItemName`.
evaluation-1.md's Phase 3 literally quotes the aria-label `"Switch chat (current: Chat)"` as
evidence AC1 passed, without noticing it never varies with the actual selection — i.e., it recorded
the *literal* output faithfully but didn't cross-check it against the equivalent sibling-section
behavior, which is exactly the comparison a "matching the existing section pattern" AC demands and
exactly the kind of check the mechanical evaluator role isn't positioned to catch. No test in
`App.test.tsx` asserts the chat breadcrumb ever reflects a selected conversation's title (contrast
with the `/pipelines` test at line 631 that asserts `toHaveTextContent("Revenue ETL")` after
selection) — confirming this was never exercised, not just unlucky to catch live.

This directly contradicts D4's specific "mirrors ... exactly" claim for the one piece of the
Redux-selection pattern that surfaces the current selection outside the sidebar list itself, and it
sits squarely inside AC1's "matching the existing section pattern... per the established mobile-pwa
convention" — the exact area both the evaluator and this final review are meant to verify.

### Verdict: REFUTE

### Change Requests

1. **`App.tsx`'s `breadcrumbItemName` needs a `"chat"` case, resolving the effective selected
   conversation's title, mirroring the `"sources"` case exactly (D4's own stated pattern).**
   `frontend/src/app/App.tsx:129-145` — add:
   ```
   if (mobileSection === "chat") {
     const id = conversations.selectedConversationId ?? conversations.items[0]?.id ?? null;
     return conversations.items.find((c) => c.id === id)?.title ?? null;
   }
   ```
   (the `conversations` selector is already destructured at line 115). This fixes both the desktop
   breadcrumb ("Chat / \<conversation title\>") and the mobile pill's "current:" label, bringing chat
   to real parity with `sources`/`registry` as D4 claims. Add a regression test in `App.test.tsx`
   analogous to the existing `/pipelines` breadcrumb-reflects-selection test (line ~631) — assert the
   breadcrumb's `toHaveTextContent` includes the selected conversation's title after selection, for
   both the initial fallback-to-first-item case and after an explicit `onSelect`/sheet selection.

### Non-blocking notes

- `ActiveConversationPanel.tsx:75` — `"{transcript.length} messages"` doesn't pluralize (a
  1-message conversation reads "1 messages"). Already flagged by the evaluator as cosmetic and
  explicitly deferred to HEL-665's real message-rendering UI; agree it's not blocking.
- Pre-existing `SidebarItemList` narrow-sidebar-column horizontal-overflow (long item names require
  horizontal scroll to reach the row action/badge) reproduces identically on `/sources` with
  unmodified code — confirmed live at both breakpoints, not introduced or worsened by this ticket's
  `renderRowAction`/`renderBadge` additions. Already flagged by the evaluator; agree it's
  out-of-scope for this ticket.
