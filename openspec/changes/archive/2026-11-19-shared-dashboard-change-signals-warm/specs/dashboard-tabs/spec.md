## MODIFIED Requirements

### Requirement: Recently used tabs stay warm for 15 minutes

Each of the 8 most recently viewed tabs SHALL stay warm for 15 minutes after the user last had it active. Activating a warm tab SHALL render its panels without requesting the dashboard's panel list or any panel's rows again, unless a change invalidated that data: a pipeline run the client observes for one of its outputs (existing freshness rules), a content change by someone other than the user reported after the panel list was captured, or new data for an Output reported after that Output's rows were captured. A refresh of rows while the tab was active SHALL count as a capture. A tab past its TTL, or outside the 8 most recent, SHALL stay in the strip and load its content fresh on activation. The active tab is always live. A dashboard the caller does not own SHALL stay warm under the same rules, with its data re-read only through the dashboard-scoped per-panel routes: its warm copy SHALL hold only the panel list and row windows (no Output metadata and no run baselines), SHALL be used only while the caller's current role on that dashboard is known and is still not owner (and an owner's copy only while the caller still owns it), and activating it SHALL make no request to `/api/outputs/*` or `/api/pipelines/*`.

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

#### Scenario: Warm switch on a shared dashboard makes no panel requests

- **WHEN** a dashboard-only viewer switches from shared dashboard A to B and back within 15 minutes and nothing changed
- **THEN** the switch back to A sends no request for A's panel list or its panels' rows, and no request to `/api/outputs/*` or `/api/pipelines/*`

#### Scenario: New data refreshes a warm shared panel through the per-panel route

- **WHEN** the owner runs the pipeline feeding a panel on shared dashboard A while a dashboard-only viewer is on B, and the viewer returns to A within 15 minutes
- **THEN** that panel's rows are re-read through the per-panel rows route and show the new data, with no request to `/api/outputs/*` or `/api/pipelines/*`

### Requirement: The warm copy survives a reload, per user, bounded, and cleared on logout

The warm state SHALL also be stored in the browser, keyed by user and dashboard, so a reload within the TTL renders warm tabs instantly. A stored copy SHALL be used only for the signed-in user who wrote it, only within the TTL, and only if the change signals report no content change (other than the user's own) after the panel list was captured, and, per row window, no new data for its Output after that window was captured; restored windows SHALL be re-stamped with the current freshness generation; the client SHALL also resume freshness tracking from the run it had observed for each pipeline (for a dashboard the caller does not own: from each restored window's capture time, through the dashboard panel status), so a later run still refreshes it. Each copy SHALL be at most 1 MiB serialized (a larger one is not stored), at most 8 copies per user are kept, and expired copies are deleted. It SHALL contain only dashboard, panel, output metadata and row data the user could already see, never credentials, tokens or share links. Logout, and any sign-out caused by an expired session, SHALL delete every stored copy and the in-memory warm state, and no write pending at that moment SHALL recreate a copy afterwards. Hiding or leaving the page SHALL record the active tab's last-viewed time, so the TTL runs from when the user last saw it.

#### Scenario: Reload within the TTL is warm

- **WHEN** the user reloads within 15 minutes of viewing A and nothing changed
- **THEN** A's panels render without requests for its panel list or rows

#### Scenario: Data changed before reload

- **WHEN** a pipeline feeding a panel on A ran after the stored copy was captured, then the user reloads
- **THEN** A's rows are requested fresh

#### Scenario: Logout clears

- **WHEN** the user signs out and another user signs in on the same browser
- **THEN** no stored warm copy from the first user exists or is read
