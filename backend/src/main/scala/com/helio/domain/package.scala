package com.helio

/** Re-exports per-step types from [[com.helio.domain.steps]] into
 *  [[com.helio.domain]] so the wildcard `import com.helio.domain._` continues
 *  to resolve every step / config type after the cycle-3 per-file restructure.
 *  The actual definitions live one package down — these aliases keep the
 *  service / repo / test call sites untouched. */
package object domain {

  // ── Step subtypes ──────────────────────────────────────────────────────────
  type RenameStep    = steps.RenameStep
  val  RenameStep    = steps.RenameStep
  type FilterStep    = steps.FilterStep
  val  FilterStep    = steps.FilterStep
  type JoinStep      = steps.JoinStep
  val  JoinStep      = steps.JoinStep
  type ComputeStep   = steps.ComputeStep
  val  ComputeStep   = steps.ComputeStep
  type GroupByStep   = steps.GroupByStep
  val  GroupByStep   = steps.GroupByStep
  type CastStep      = steps.CastStep
  val  CastStep      = steps.CastStep
  type SelectStep    = steps.SelectStep
  val  SelectStep    = steps.SelectStep
  type LimitStep     = steps.LimitStep
  val  LimitStep     = steps.LimitStep
  type SortStep      = steps.SortStep
  val  SortStep      = steps.SortStep
  type AggregateStep = steps.AggregateStep
  val  AggregateStep = steps.AggregateStep
  type SplitTextStep = steps.SplitTextStep
  val  SplitTextStep = steps.SplitTextStep
  type ExtractHeadingsStep = steps.ExtractHeadingsStep
  val  ExtractHeadingsStep = steps.ExtractHeadingsStep

  // ── Typed configs ──────────────────────────────────────────────────────────
  type RenameConfig    = steps.RenameConfig
  val  RenameConfig    = steps.RenameConfig
  type FilterCondition = steps.FilterCondition
  val  FilterCondition = steps.FilterCondition
  type FilterConfig    = steps.FilterConfig
  val  FilterConfig    = steps.FilterConfig
  type JoinConfig      = steps.JoinConfig
  val  JoinConfig      = steps.JoinConfig
  type ComputeConfig   = steps.ComputeConfig
  val  ComputeConfig   = steps.ComputeConfig
  type GroupByConfig   = steps.GroupByConfig
  val  GroupByConfig   = steps.GroupByConfig
  type CastConfig      = steps.CastConfig
  val  CastConfig      = steps.CastConfig
  type SelectConfig    = steps.SelectConfig
  val  SelectConfig    = steps.SelectConfig
  type LimitConfig     = steps.LimitConfig
  val  LimitConfig     = steps.LimitConfig
  type SortKey         = steps.SortKey
  val  SortKey         = steps.SortKey
  type SortConfig      = steps.SortConfig
  val  SortConfig      = steps.SortConfig
  type AggregateField  = steps.AggregateField
  val  AggregateField  = steps.AggregateField
  type Aggregation     = steps.Aggregation
  val  Aggregation     = steps.Aggregation
  type AggregateConfig = steps.AggregateConfig
  val  AggregateConfig = steps.AggregateConfig
  type SplitTextConfig = steps.SplitTextConfig
  val  SplitTextConfig = steps.SplitTextConfig
  type ExtractHeadingsConfig = steps.ExtractHeadingsConfig
  val  ExtractHeadingsConfig = steps.ExtractHeadingsConfig
}
