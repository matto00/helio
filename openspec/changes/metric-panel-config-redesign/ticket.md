# HEL-243: Metric panel config redesign — DataType integration

**Epic:** HEL-239 (Helio v1.5 — Panel System v2)
**Project:** Helio v1.5 — Panel System v2
**Priority:** Medium

## Description

Rework Metric panel config to integrate cleanly with DataTypes. Today Metric
panels bind to a DataType but the connection between "I want one value" and
"this DataType has many rows" is implicit. The user has to manually engineer
a single-row reduction in the pipeline.

### Approach options (decide during execution)

- **Filter field** on the panel config — narrow down to a specific row by
  some predicate.
- **Smart pipeline reference** — pre-configured single-row reduction (latest
  / aggregate). Panel declares "I need a single-row DataType"; user picks a
  smart-pipeline shape applied to the source.

Lean toward the smart-pipeline route because it sets up the agentic vision
(agents compose smart pipelines).

## Definition of done

- Metric panel config UI clearly expresses how the panel selects its single
  value from the DataType
- Field mapping is intuitive (no more "value/label" slot ambiguity)
- Re-running the pipeline updates the metric automatically
- Config UI shares language with text/markdown/image panels (Epic A items
  3-5)

Depends on the panel-DataType binding fix (sibling ticket, HEL-242 — already
shipped).

---

## Additional orchestrator-supplied context

This ticket is the **pattern-setter** for the whole config-redesign line in
epic HEL-239. HEL-244 (Text config), HEL-245 (Markdown config), and HEL-247
(Collections) are all specified as "same pattern as Metric." The
DataType-integration config approach established here is a reusable contract
those follow-on tickets will copy.

**Design requirement:** design.md MUST document the reusable pattern
explicitly (not just the Metric-specific application) so HEL-244/245/247 can
mirror it without re-deriving the approach.

**Build on current Metric panel state** — this session already shipped, on
top of the base panel/DataType binding (HEL-242):

- HEL-292 — metric aggregation
- HEL-293 — literal label/unit overrides
- HEL-295 — unit rendering + no-false-"No data"
- HEL-297 — display rounding

Do **not** regress any of this behavior. The config redesign should
surface/organize these existing capabilities coherently within the new
DataType-integration UI, not replace or duplicate them.

**Reuse, don't reinvent:**

- HEL-242's panel <-> DataType binding foundation is the base to build on.
- Bind to `DESIGN.md` for all frontend work (tokens, spacing/type scales,
  shared components, UI-state patterns).
- Reuse existing shared config primitives (e.g. any shared field-mapping /
  config-panel UI components already in the codebase) rather than inventing
  new ones.

**Parallel work note:** HEL-249 (remove Divider panel type) is running
concurrently on a separate branch cut from the same base. It only touches
the panel-type picker/divider removal — minimal overlap expected. If a
conflict appears, rebase onto `origin/main` before finalizing (do not
force-push without explicit human approval).
