# Helio — Product Roadmap — v1

**Last updated:** 2026-03-20
**Version:** v1 (initial planning session)
**Product vision:** Multi-tenant SaaS dashboard builder where users connect data sources, define types through a TypeRegistry, and visualize data in rich panel layouts.

---

## Roadmap Philosophy

Build toward a product that is **compelling before it is secure**. Auth is necessary for SaaS, but users need something worth protecting first. The revised priority order is:

1. Make panels display real content (Panel Type System)
2. Make data flow into those panels (Data Ingestion + TypeRegistry)
3. Lock down ownership and access (Auth + Multi-tenancy)
4. Polish and platform capabilities

---

## Phase 1 — Panel Type System

**Status:** In Linear backlog (HEL-22, 23, 24) | **Priority:** High

Give panels a purpose. Each panel has a type that determines how it renders.

| Ticket | Task                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------- |
| HEL-22 | Add `type` field to panel data model and API (`metric` / `chart` / `text` / `table`, default: `metric`) |
| HEL-23 | Type selector in the panel create flow                                                                  |
| HEL-24 | Per-type rendering in the grid (placeholder UIs per type to start)                                      |

**Definition of done:** A user can create a panel of type "chart" and see a chart placeholder distinct from a "metric" placeholder.

---

## Phase 2 — Data Ingestion + TypeRegistry

**Status:** Not yet in Linear — needs spec | **Priority:** Critical (core differentiator)

The TypeRegistry is Helio's defining concept. Users connect a data source; Helio inspects it and infers a schema. That schema is registered as a named type. Panels then bind to a type and display real data.

### Design principles

- **Infer by default:** connect a source and Helio proposes field names and types automatically
- **Progressive disclosure:** simple users never see "schema" language; advanced users get full control
- **Extensible:** new source types (Kafka, S3, etc.) plug into the same registry framework

### Sub-features

#### 2a — Data Source Manager

- Data source list / management page (per-user or per-org in the future)
- Connector types: SQL database, REST/HTTP API, CSV file upload, manual/static entry
- Later: cloud storage (S3, GCS, Azure Blob), event streams (Kafka)
- Test connection + preview first N rows

#### 2b — TypeRegistry

- On connection, inspect source and infer field names, data types, nullability
- Register the inferred schema as a named `DataType` in the registry
- Advanced view: rename fields, override inferred types, add computed fields, add transforms
- DataType versioning for schema evolution

#### 2c — Panel ↔ Data Binding

- Panel creation flow: pick a registered DataType
- Field mapping UI: assign fields to panel "slots" (e.g. for a metric panel: value field, label, unit)
- Query/filter layer for structured sources (WHERE clause builder for SQL, query params for REST)
- Refresh interval setting per panel

#### 2d — Per-type rendering (extends HEL-24)

- **Metric panel:** single value, label, trend indicator (up/down/neutral), sparkline optional
- **Chart panel:** line, bar, pie — configurable axes from DataType fields
- **Text panel:** markdown content, optionally data-driven (template strings with field refs)
- **Table panel:** paginated / scrollable tabular view of a DataType

**Relationship to existing tickets:**

- Supersedes HEL-29 (Data source connectivity) — go further than that spec
- Extends HEL-40 (ACL type registry) — DataType registry is the same extensibility concept applied to data

---

## Phase 3 — User Authentication + Multi-tenancy

**Status:** In Linear backlog (HEL-27 group, 12 tickets) | **Priority:** High (required for SaaS)

Full user auth system with ownership and sharing. Defer until Phase 1+2 give users something worth protecting.

| Ticket | Task                                                          |
| ------ | ------------------------------------------------------------- |
| HEL-30 | DB schema: users table                                        |
| HEL-31 | DB schema: user_sessions table                                |
| HEL-32 | Google OAuth login                                            |
| HEL-33 | Email/password login & registration                           |
| HEL-34 | Session middleware + request authentication                   |
| HEL-35 | ACL model: resource ownership (owner_id on dashboards/panels) |
| HEL-36 | ACL model: sharing + per-resource permissions (viewer/editor) |
| HEL-37 | ACL enforcement in all API routes                             |
| HEL-38 | Frontend: authSlice, protected routes, login/registration UI  |
| HEL-39 | Frontend: Google OAuth button + redirect flow                 |
| HEL-40 | ACL extensibility: generic resource type registry             |

**Multi-tenancy considerations beyond current tickets:**

- Org/workspace model (users belong to orgs, dashboards scoped to orgs)
- Invitation flow (email invite to join an org or share a dashboard)
- Role hierarchy: owner > editor > viewer
- Audit log for sensitive actions (delete, permission changes)

---

## Phase 4 — Polish + Platform

**Status:** Mix of existing Linear tickets and new ideas | **Priority:** Medium

| Item                              | Ticket | Notes                                                           |
| --------------------------------- | ------ | --------------------------------------------------------------- |
| Undo/redo layout changes          | HEL-26 | Cmd/Ctrl+Z; per-session history stack                           |
| Dashboard export/import JSON      | HEL-28 | Snapshot format; share dashboard configs                        |
| Dashboard duplication             | —      | UI button exists but is disabled; implement                     |
| Search/filter dashboards + panels | —      | As content scales, discoverability matters                      |
| Empty state guidance              | —      | First-run onboarding when a new dashboard is created            |
| Customization popover UX fix      | —      | Click-outside / Escape should dismiss; popovers shouldn't stack |
| Panel templates / starter types   | —      | Preset configs for common panel types                           |
| Mobile/responsive layout          | —      | Current layout targets desktop; plan for responsive access      |

---

## Future / Horizon

These are directional ideas, not yet specced:

- **Scheduled refreshes + alerting:** panels that poll on a schedule and notify on threshold breach
- **Dashboard sharing via URL:** read-only public link or authenticated share link
- **Embedding:** embed a single panel or full dashboard in an external page (iframe + token)
- **Variables + parameters:** dashboard-level variables that filter all panels simultaneously (like Grafana variables)
- **Annotations:** mark events on time-series charts (deploys, incidents)
- **Calculated fields:** define derived fields in the TypeRegistry (e.g. revenue per user = revenue / users)
- **Data refresh history:** per-panel log of fetch times, row counts, errors
