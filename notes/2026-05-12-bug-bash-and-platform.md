# Helio — Bug Bash Planning & Agentic Platform Direction

**Date:** 2026-05-12
**Context:** Post HEL-237 vibe-polish session. Branch `task/app-wide-polish/HEL-237` merged via PR #145. Notes captured from product-direction discussion before filing v1.3.1 work.

---

## Agentic Platform Direction

> Agents are a first-class citizen of Helio. Modifying sources, modifying pipelines, and reading data types are **primitive operations** — exposed cleanly enough that an external agent can compose them to build dashboards from any source system.

This is not a v2.0 reframing — it's the framing that should shape every API decision from v1.3 onward.

Implications:

- **API hardening as a near-term thread.** The internal REST API will eventually be the surface an MCP exposes. Endpoints should be coherent, well-typed, idempotent where reasonable, and documented via OpenAPI (already partial via `openspec/`). No "internal-only" shortcuts.
- **MCP integration on the horizon.** The Model Context Protocol server will wrap source/pipeline/type operations as tools. Each tool maps roughly 1:1 to an existing REST verb. We should design routes with this in mind: cleanly composable, with clear pre/postconditions.
- **Primitives must be self-describing.** Agents need to introspect: list sources, list pipelines, list types, get a type's schema. Those introspection endpoints should be first-class, not afterthoughts.
- **"Smart" / pre-configured pipelines.** A useful primitive: a pipeline that reduces a source to a single row (latest, top-N, aggregate). Agents compose these as building blocks for panels that expect a specific data shape. Worth defining a small library of canonical pipeline shapes (single-row, time-series, top-N) so panels can declare what they need and binding becomes "I need a single-row DataType."
- **Hands-off goal.** The endgame: a user (or an agent on their behalf) says "build me a sales dashboard from this Snowflake source," and Helio's agent layer composes sources + smart pipelines + panels.

---

## v1.3.1 Bug Bash — Triage

Discussed 14 items. Not all are bug-bash sized; pulled out the architectural ones into their own epics so they don't get lost in a "polish bag."

### Epic A — Panel System v2

> Big enough to be its own epic. Items share the same binding model, so they want to be planned together; fixing them in isolation would mean redoing the same wiring twice.

- **Panel config redesign** for metric, text, markdown, image. Better integration with DataTypes via a "filter" field or smart pipelines (pre-configured reductions to a single row). Image upload via `FileSystem`-backed `/api/uploads/image` endpoint (blob storage migration coming, so this fits). **Markdown ↔ uploaded-image cross-reference** is an interesting case to support — a markdown panel can render an image previously uploaded for an image panel.
- **Collections** as a panel sub-type. **Homogeneous** (collection of one type, not mixed) for v1.5 scope. A Collection-of-Metrics renders N metrics from a multi-row DataType; useful with the agentic flow once smart pipelines exist.
- **Per-chart-type config.** Different chart types need different config surfaces (line: series, x/y; pie: slice/value; bar: orientation, stacking; scatter: x/y/size). Brainstorm during ticket execution.
- **Remove Divider panel type.** Provides little value. Canvas panel sub-type is roadmap-only for future creative-tools exploration.
- **Panel ↔ DataType binding solidification** (P0 — front-load this).
  Today, a properly populated DataType sometimes doesn't show up on a panel. This breaks the product's core promise. Treat as the highest-priority sub-issue inside this epic, and don't ship Epic A without it.

### Epic B — Data Grid Standardization

> Own epic. Substantial but well-bounded.

- One full data-grid component + one preview component (or unify into one with a `mode` prop)
- Cell density: condensed / normal / spacious
- Draggable column widths
- **No `overflow: hidden`** — better scroll support, resize as needed
- Table panel config rework

### Epic C — v1.3.1 Bug Bash & Hardening

Smaller items grouped as a single bug-bash epic with individual tickets.

- **Data Source schema disappearance** (CSV regression on restart) — **lift out of this epic as P0** if it blocks demos. Otherwise top of bug bash.
- Dashboard-create button sizing (too large)
- Panel count / create button / zoom controls layout rework. Idea: zoom controls → bottom-right; panel create → right of panel count. Open to other UI nits in this ticket.
- Color customization UX rework. Color-mix blending is fantastic but hard to find a working combo; needs better guidance.
- Pipeline detail hardening: lock source toggle; replace "+ Add source" with explicit **"Edit Source"** and **"Edit Type"** buttons. Pipelines are _contracts_; editing inputs/outputs should be deliberate. (Item 10. Note: multi-source pipelines are a v1.4 stretch goal — copy stays singular for now.)
- Inferred type schema dummy-data audit. No dummy data should appear when a type is inferred from a real source.
- Compute column step rework: multi-column support, `$col` syntax for variable references, constants, possibly string operations.
- Aggregate step UI cleanup + correctness audit.
- Remove Join op from step list until implemented.

### Roadmap-Only

- **Canvas panel sub-type** — future creative-tools exploration. File as v1.5+ roadmap ticket, no commitment.

---

## Decisions Locked

| Question                             | Answer                                                       |
| ------------------------------------ | ------------------------------------------------------------ |
| Image upload storage                 | FileSystem-backed endpoint (blob storage migration imminent) |
| Collections shape                    | Homogeneous (one panel-type per collection)                  |
| Multi-source pipelines               | v1.4 stretch, copy stays "Edit Source" singular for now      |
| CSV schema bug priority              | P0 — lift out if blocking demos                              |
| Markdown referencing uploaded images | Yes, support this                                            |

---

## Product Direction Themes That Emerged

1. **Pipelines are contracts.** Once a pipeline exists, its inputs and outputs are commitments. Edits should be deliberate, surfaced as explicit actions, not casual toggles. This frames much of Epic C's pipeline-hardening work as guardrails rather than polish.
2. **Smart pipelines are the bridge to agentic.** Single-row / top-N / time-series reductions are the building blocks an agent composes. Defining a small canonical library early shapes both the panel-binding model (Epic A) and the eventual MCP tool surface.
3. **The API is the agent surface.** Every endpoint we add is a future MCP tool. Internal coherence and clean OpenAPI specs are foundations of the agentic vision, not separate from it.
4. **Sources and the schema must be rock solid.** Data Source schema disappearance (item 9) and DataType binding (item 5) are both trust failures. Fix urgently; they invalidate everything downstream.

---

## Next Step

File Epic A, Epic B, Epic C as Linear epics with sub-issues attached. Lift the CSV schema bug (item 9) and the Panel↔DataType binding (item 5) as P0 sub-issues with explicit priority labels so they don't blend into the rest of their epics.
