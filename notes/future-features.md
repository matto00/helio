# Helio — Future Features Brainstorm

**Last updated:** 2026-03-20
**Note:** This is a living document. Add ideas as they come up — we'll prioritize them in roadmap planning sessions.

---

## TypeRegistry — Core Concept

The TypeRegistry is Helio's most distinctive idea. Users should never have to think "I need to define a schema" — they just connect a source and the platform figures it out. But power users should be able to reach in and customize everything.

### Ideas for the TypeRegistry

- **Auto-type inference:** connect a SQL table or CSV and infer field names, data types, nullable, primary keys
- **Suggested panel types:** based on the inferred schema, suggest which panel type fits best (e.g., a single numeric column → Metric; time + value columns → Chart)
- **Field aliases:** rename `revenue_usd_cents` to "Revenue" in the UI without changing the source
- **Computed fields:** define derived fields in the registry (`profit_margin = revenue / cost * 100`)
- **Type versioning:** when a source schema changes, flag affected panels and allow migration
- **Type library:** shared types within an org — define "User" once, use it in multiple panels across dashboards
- **Type preview:** before binding to a panel, preview the first 10 rows of data from the type

---

## Data Sources — Extended Connectors

Beyond the four core types (SQL, REST, CSV, static), there's a long tail of connectors worth considering in priority order:

| Source                    | Notes                                                             |
| ------------------------- | ----------------------------------------------------------------- |
| **PostgreSQL**            | First SQL target; direct connection string                        |
| **REST API**              | JSON endpoint, configurable auth (Bearer, API key, OAuth)         |
| **CSV upload**            | File-based, one-shot or auto-refreshing from URL                  |
| **Static / manual**       | Enter values directly in the UI                                   |
| **Google Sheets**         | High demand; OAuth-authenticated                                  |
| **MySQL / SQLite**        | Expand SQL support                                                |
| **S3 / GCS / Azure Blob** | CSV/Parquet files in cloud storage; useful for data teams         |
| **Kafka / event streams** | Real-time streaming panels; significant infrastructure investment |
| **BigQuery**              | Common in data-heavy teams                                        |
| **Webhooks**              | Push data into a panel from an external system                    |
| **GraphQL**               | Alternative to REST for modern APIs                               |

---

## Panel Types — Extended Set

Beyond the four core types (Metric, Chart, Text, Table):

- **Gauge panel:** circular or linear gauge with min/max/threshold bands (e.g., CPU usage)
- **Stat/KPI panel:** multiple metrics side-by-side with trend arrows (like a scoreboard)
- **Map panel:** geographic data — choropleth, point maps, heatmap
- **Timeline/Gantt panel:** task or event ranges over time
- **Heatmap panel:** matrix of values, great for correlation or calendar views
- **Image panel:** display a static or dynamically fetched image
- **Iframe/Embed panel:** embed an external URL in a panel
- **Log/stream panel:** scrolling real-time log output

---

## Dashboard-Level Features

- **Variables/parameters:** define dashboard-level filter variables (e.g., `$region`, `$date_range`) that apply to all panels simultaneously — like Grafana template variables. This is a high-leverage feature; it turns a static dashboard into a parameterized reporting tool.
- **Annotations:** mark point-in-time events on time-series charts (deploys, incidents, releases). Shared across all chart panels in a dashboard.
- **Dashboard versions / snapshots:** save named snapshots of a dashboard state; compare or restore
- **Dashboard templates:** start a new dashboard from a pre-built template (e.g., "Web Analytics", "Sales Pipeline", "System Health")
- **Presentation mode:** full-screen, read-only, auto-cycling mode for display on a TV/monitor
- **Print / PDF export:** generate a static report from a dashboard
- **Mobile view:** responsive layout optimized for phone screens (current layout is desktop-only)

---

## Collaboration Features

- **Comments on panels:** leave comments attached to a specific panel (useful for async data review)
- **Dashboard sharing via link:** read-only public URL or authenticated share link
- **Embed panels:** iframe embed a single panel with a token (for embedding in Confluence, Notion, etc.)
- **Activity feed:** per-dashboard log of who changed what and when
- **@mentions in comments:** notify teammates in panel comments

---

## Alerting + Monitoring

These features are further out but create strong retention:

- **Threshold alerts:** trigger a notification when a metric crosses a value (email, Slack, webhook)
- **Scheduled reports:** email a dashboard PDF on a schedule (daily digest, weekly summary)
- **Anomaly detection:** flag unusual values automatically using simple statistical models
- **SLA tracking:** mark a panel as an SLA indicator; alert when it goes red

---

## Developer / Power User Features

- **Dashboard-as-code / JSON config:** define dashboards in JSON and push via API (for GitOps workflows)
- **Dashboard export/import** (HEL-28): already planned
- **Webhook-as-data-source:** accept incoming POST payloads and surface them in panels
- **Plugin system:** allow third-party panel type or data connector plugins (long-term platform play)
- **API key management:** per-user or per-org API keys for programmatic access

---

## Ideas to Triage (not yet evaluated)

Add new ideas here as they come up:

-
