## Purpose

Open dashboards as tabs on the rail shell: switch, reorder and close them by mouse or keyboard, keep them saved per user across reloads and devices, keep recently used ones warm so a return is instant, and mark the ones that changed since the user last looked.

## ADDED Requirements

### Requirement: The tab strip is an accessible tablist on the rail-shell dashboard view

On the dashboard view above the 768px breakpoint, the top of the content column SHALL show a tab strip with `role="tablist"` and an accessible name, holding one `role="tab"` per open dashboard in saved order, labelled with the dashboard's name. The active tab SHALL have `aria-selected="true"` and an `--app-accent` indicator on its top edge; the dashboard content SHALL be a `role="tabpanel"` labelled by the active tab. Tab motion is static until the motion foundation lands. At 768px and below no tab strip renders (the phone keeps its own switcher), but selections still update the saved tabs.

#### Scenario: Tabs render with roles

- **WHEN** a user with three open tabs views the dashboard view at 1280px
- **THEN** a tablist with three tabs is present, exactly one is `aria-selected="true"`, and the content region is a tabpanel labelled by it

#### Scenario: No strip on a phone

- **WHEN** the same user views the dashboard view at 375px
- **THEN** no tablist renders

### Requirement: Opening, switching and closing tabs

Selecting an existing dashboard (context list click, palette jump, phone picker) SHALL activate its tab if it is open, otherwise replace the active tab's dashboard with it (or create the first tab when none exists). A newly created, duplicated, imported or proposal-applied dashboard, and a `/dashboards/:id` deep link on load, SHALL open as a new tab after the active one (or activate it if open) and never overwrite a saved tab. On load, a deep link SHALL take precedence over the saved active tab, and otherwise the saved active tab SHALL be shown, with no panel request for any other dashboard first. Deleting the active dashboard SHALL apply the close rule below; deleting an inactive open dashboard SHALL remove its tab. Middle-click, or a click with `⌘` (macOS) or Ctrl held, on a dashboard in the context list SHALL open it as a new tab directly after the active tab without activating it, or do nothing if it is already open. The "+" button SHALL open the palette in an "open in a new tab" mode that lists only dashboards (all of them when the query is empty) and opens the chosen one as a new active tab. Each tab SHALL have a close control; closing the active tab SHALL activate its right neighbour, else its left neighbour; closing the last tab SHALL leave the dashboard view showing its existing empty state, titled "No dashboard open", and an empty saved tab set SHALL stay empty on reload. A tab whose dashboard no longer exists or is no longer accessible SHALL be dropped once the dashboard list has loaded.

#### Scenario: Plain click replaces the active tab

- **WHEN** tabs are [A (active), B] and the user clicks C in the context list
- **THEN** tabs are [C (active), B]

#### Scenario: Clicking an open dashboard activates it

- **WHEN** tabs are [A (active), B] and the user clicks B in the context list
- **THEN** tabs are [A, B (active)]

#### Scenario: Meta-click opens a background tab

- **WHEN** tabs are [A (active), B] and the user Ctrl-clicks C in the context list
- **THEN** tabs are [A (active), C, B] and A's content stays on screen

#### Scenario: Deep link beats the saved active tab

- **WHEN** a user whose saved tabs are [A (active), B] loads `/dashboards/C`
- **THEN** tabs are [A, C (active), B] and no panel request for A is sent before C's

#### Scenario: Deleting the active dashboard

- **WHEN** tabs are [A, B (active), C] and the user deletes dashboard B
- **THEN** tabs are [A, C (active)]

#### Scenario: Closing the active tab

- **WHEN** tabs are [A, B (active), C] and the user closes B
- **THEN** tabs are [A, C (active)]

### Requirement: Tabs are keyboard operable

The tablist SHALL use a roving tab stop: Arrow Left/Right move focus between tabs (wrapping), Home/End to the first/last, Enter or Space activate the focused tab, Delete or Backspace close it, and Alt+Shift+Arrow Left/Right move the focused tab one position. Each tab's pointer close control SHALL be a sibling of the tab (never inside it), hidden from assistive technology, not a tab stop, and titled "Close <name>"; the tab SHALL advertise Delete as its close key (`aria-keyshortcuts` and a description). The "+" button SHALL be reachable by Tab and named "Open a dashboard in a new tab".

#### Scenario: Keyboard reorder

- **WHEN** focus is on tab B in [A, B, C] and the user presses Alt+Shift+Arrow Left
- **THEN** tabs are [B, A, C], focus stays on B, and the new order is saved

#### Scenario: Keyboard close

- **WHEN** focus is on tab C and the user presses Delete
- **THEN** C is closed and focus moves to the tab that became active or the neighbouring tab

### Requirement: Tabs reorder by dragging

Dragging a tab with the pointer SHALL move it to the drop position, with a visible drop indicator while dragging, and save the new order once on drop.

#### Scenario: Drag reorder

- **WHEN** the user drags tab C onto the start of [A, B, C]
- **THEN** tabs are [C, A, B] after the drop and one save is sent

### Requirement: The tab set is saved server-side per user

The ordered tab set, the active tab, and each tab's last-viewed time and the user's own latest content-write time SHALL be stored in the user's preferences record and delivered with every user-returning auth response, so a reload or a sign-in on another device restores the same tabs, order and active tab before the shell first renders. The saved set SHALL hold at most 20 tabs; opening a tab when 20 are open SHALL first close the least recently viewed tab that is not active. Writes SHALL be coalesced (at most one per second during bursts of changes) and flushed when the page is hidden.

#### Scenario: Reload restores tabs

- **WHEN** a user arranges tabs [B, A, C] with C active and reloads
- **THEN** the strip shows [B, A, C] with C active

#### Scenario: Second device

- **WHEN** the same user signs in from a new browser context
- **THEN** the strip shows [B, A, C] with C active

#### Scenario: The cap evicts the least recently viewed inactive tab

- **WHEN** 20 tabs are open and the user Ctrl-clicks a 21st dashboard
- **THEN** the least recently viewed inactive tab is closed and the new tab is added

### Requirement: Recently used tabs stay warm for 15 minutes

Each of the 8 most recently viewed tabs SHALL stay warm for 15 minutes after the user last had it active. Activating a warm tab SHALL render its panels without requesting the dashboard's panel list or any panel's rows again, unless a change invalidated that data: a pipeline run the client observes for one of its outputs (existing freshness rules), a content change by someone other than the user reported after the panel list was captured, or new data for an Output reported after that Output's rows were captured. A refresh of rows while the tab was active SHALL count as a capture. A tab past its TTL, or outside the 8 most recent, SHALL stay in the strip and load its content fresh on activation. The active tab is always live.

#### Scenario: Warm switch makes no panel requests

- **WHEN** the user switches A → B → A within 15 minutes and nothing changed
- **THEN** the switch back to A sends no request for A's panel list or its panels' rows

#### Scenario: A run while active does not void warmth

- **WHEN** a pipeline run refreshes a panel on A while A is active, then the user switches to B and back within 15 minutes
- **THEN** the return sends no request for A's panel list or rows

#### Scenario: Expired tab refetches

- **WHEN** the user returns to A 16 minutes after leaving it
- **THEN** A is still in the strip and activating it requests its panel list and rows

#### Scenario: A run refreshes a warm panel

- **WHEN** a pipeline feeding a panel on warm tab A completes a run while the user is on B, and the user returns to A
- **THEN** that panel's rows are requested again and show the new data

### Requirement: The warm copy survives a reload, per user, bounded, and cleared on logout

The warm state SHALL also be stored in the browser, keyed by user and dashboard, so a reload within the TTL renders warm tabs instantly. A stored copy SHALL be used only for the signed-in user who wrote it, only within the TTL, and only if the change signals report no content change (other than the user's own) after the panel list was captured, and, per row window, no new data for its Output after that window was captured; restored windows SHALL be re-stamped with the current freshness generation; the client SHALL also resume freshness tracking from the run it had observed for each pipeline, so a later run still refreshes it. Each copy SHALL be at most 1 MiB serialized (a larger one is not stored), at most 8 copies per user are kept, and expired copies are deleted. It SHALL contain only dashboard, panel, output metadata and row data the user could already see, never credentials, tokens or share links. Logout, and any sign-out caused by an expired session, SHALL delete every stored copy and the in-memory warm state, and no write pending at that moment SHALL recreate a copy afterwards. Hiding or leaving the page SHALL record the active tab's last-viewed time, so the TTL runs from when the user last saw it.

#### Scenario: Reload within the TTL is warm

- **WHEN** the user reloads within 15 minutes of viewing A and nothing changed
- **THEN** A's panels render without requests for its panel list or rows

#### Scenario: Data changed before reload

- **WHEN** a pipeline feeding a panel on A ran after the stored copy was captured, then the user reloads
- **THEN** A's rows are requested fresh

#### Scenario: Logout clears

- **WHEN** the user signs out and another user signs in on the same browser
- **THEN** no stored warm copy from the first user exists or is read

### Requirement: A dot marks tabs changed since last viewed

An inactive tab SHALL show a changed dot when the dashboard's latest content change is later than both the tab's last-viewed time and the user's own latest content write to it, or when its latest data change is later than the tab's last-viewed time; the user's own writes never hide new data. The last-viewed time SHALL be the moment the user last activated or left the tab, in server time. A content change made by the user's own successful writes (including saves flushed after leaving the tab) SHALL NOT count. The dot SHALL be included in the tab's accessible name ("<name>, changed since you last viewed") and SHALL clear when the tab is activated. Change signals SHALL be refreshed on load, when a tab is added, when the page becomes visible, and every 2 minutes while visible.

#### Scenario: Data arrives while away

- **WHEN** the user leaves tab A and a pipeline run then writes new data for a panel on A
- **THEN** after the next refresh tab A shows the dot, and activating A clears it

#### Scenario: Own edits do not mark

- **WHEN** the user edits dashboard A while it is active and then switches to B
- **THEN** tab A shows no dot

#### Scenario: Own edits never hide new data

- **WHEN** the user edits A, leaves it, and a pipeline run then writes new data for a panel on A
- **THEN** tab A shows the dot after the next refresh

#### Scenario: Own edits stay unmarked after reload and on another device

- **WHEN** the user drags a panel on A, switches to B, and then reloads, or signs in on a second browser
- **THEN** tab A shows no dot

#### Scenario: A deferred own save after leaving does not mark or void warmth

- **WHEN** the user drags a panel or edits a panel title on A, switches to B within 30 seconds (pending edits are saved when A is left), and returns to A
- **THEN** tab A showed no dot while inactive and the return sends no request for A's panel list or rows
