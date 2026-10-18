## MODIFIED Requirements

### Requirement: Phone dashboard view shows the refresh line
On the phone shell's authenticated dashboard view, the dashboard view SHALL show a mono caption line as the first
item of the panel list, directly above the dashboard chip row, with the same refresh fact the desktop meta row shows ("refreshed <ago>",
"last run failed <ago>" or "not refreshed yet"), derived from `useDashboardMeta` through one shared
text helper used by both surfaces. The line SHALL show no text when the refresh state is unknown, SHALL be absent
on the public shared-dashboard route, and SHALL expose the timestamp through a `<time>` element.

For a pipeline-fed dashboard (at least one output panel bound to an Output), the line's slot SHALL be reserved from
the first paint of the dashboard view, including while the panel skeleton is showing, as an empty, `aria-hidden`
element of the same height and margin as the filled line, so that neither skeleton placeholders nor real cards move
when the panels or the refresh fact arrive. Before panels load, "pipeline-fed" SHALL be read from the dashboard
list's `hasPipelineFedPanels`; once panels load, the loaded panels SHALL decide. A dashboard that is not
pipeline-fed SHALL have no slot at any point.

#### Scenario: A dashboard fed by a pipeline that has run
- **WHEN** a phone user opens a dashboard whose feeding pipeline last ran successfully 9 hours ago
- **THEN** "refreshed 9h ago" shows above the chip row, the same text (and, for a failed run, the
  same danger dot) the desktop meta row shows for that dashboard

#### Scenario: Unknown refresh state
- **WHEN** no feeding pipeline is known for a dashboard that is not pipeline-fed
- **THEN** no refresh line and no reserved slot render

#### Scenario: Unknown refresh state on a pipeline-fed dashboard
- **WHEN** a pipeline-fed dashboard's refresh state resolves to unknown
- **THEN** the empty reserved slot stays in place and no card moves

#### Scenario: Skeleton placeholders sit where the real cards land
- **WHEN** a phone user at 375px or 430px, in light or dark theme, opens a pipeline-fed dashboard and the panels
  fetch is slow
- **THEN** the reserved slot is present while the skeleton shows, and the top of the first skeleton placeholder
  equals the top of the first real card that replaces it (within 0.5px), with no layout shift across the swap

#### Scenario: Markdown-only dashboard is unchanged
- **WHEN** a phone user opens a dashboard with only markdown panels and the panels fetch is slow
- **THEN** no slot is reserved during the skeleton or after the panels load

#### Scenario: Switching from a pipeline-fed to a markdown-only dashboard
- **WHEN** a phone user on a pipeline-fed dashboard switches to a markdown-only dashboard and its panels fetch is slow
- **THEN** no slot is reserved while the target dashboard's skeleton shows, nor after its panels load

#### Scenario: Switching from a markdown-only to a pipeline-fed dashboard
- **WHEN** a phone user on a markdown-only dashboard switches to a pipeline-fed dashboard and its panels fetch is slow
- **THEN** the slot is reserved while the target's skeleton shows, and placeholder and real-card tops are equal across
  the swap

#### Scenario: Deleting the last panel of a pipeline-fed dashboard
- **WHEN** a phone user deletes the only panel of a pipeline-fed dashboard
- **THEN** no reserved slot remains above the empty state, and a later slow-fetch reopen of that dashboard reserves no
  slot

#### Scenario: The phone command bar height is unchanged
- **WHEN** the line renders at 320px and 375px
- **THEN** the phone command bar keeps its existing height, and the line sits in normal flow above
  the chips, 12px from the screen edge

## ADDED Requirements

### Requirement: Dashboard list carries a pipeline-fed flag
Each dashboard returned by `GET /api/dashboards` SHALL carry a boolean `hasPipelineFedPanels`, true exactly when the
dashboard has at least one output panel whose bound Output id is non-empty, and false otherwise (no panels,
or only markdown/form/other non-output panels). The flag SHALL be computed for the whole page in a
bounded number of queries, independent of the page size. The dashboard JSON Schema SHALL declare the field; other
single-dashboard responses MAY omit it, and a client SHALL NOT drop a previously-known value when a response omits it.

#### Scenario: Pipeline-fed and markdown-only dashboards in one list
- **WHEN** a user owning one dashboard with a bound output panel and one with only markdown panels lists dashboards
- **THEN** the first item has `hasPipelineFedPanels: true` and the second `hasPipelineFedPanels: false`

#### Scenario: A rename response omits the flag
- **WHEN** the client renames a pipeline-fed dashboard and the response has no `hasPipelineFedPanels`
- **THEN** the client still treats the dashboard as pipeline-fed

#### Scenario: The flag follows in-session panel changes
- **WHEN** a phone user adds the first bound output panel to a markdown-only dashboard, switches away, and switches
  back with a slow panels fetch
- **THEN** the slot is reserved during that dashboard's skeleton
