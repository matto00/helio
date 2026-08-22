# Domain

Core domain vocabulary and logic, split into `model/` (data types),
`connectors/` (data-source connector implementations), `engine/` (pipeline
execution/analysis/schema-inference logic), `util/` (small dependency-free
helpers), plus the pre-existing `steps/`, `shapes/`, `panels/` (per-step
transform logic, smart-shape expansion, per-panel-type config — unchanged by
this split). See each subdirectory's own README for what belongs there.

At this root: `package.scala` only — `package object domain` re-exporting
`domain.steps`'s ~51 step/config types so `import com.helio.domain._`
keeps resolving them. It re-exports nothing from `model/connectors/engine/util`
(those are reached via their own explicit imports); it stays here rather
than moving into `model/` because doing so would either rename it to
`package object model` (breaking the ~141 main+test call sites that import
it) or leave a path that lies about its package.
