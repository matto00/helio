// useStepCardState — local editor state + persistence helpers for one
// pipeline-step row inside StepCard.
//
// Extracted from StepCard.tsx purely as a structural decomposition: the
// hook owns the eight per-op-kind editor states, keeps them in sync with
// the persisted `step.config` via the during-render `prev*` pattern, and
// exposes a single `persist` plus eight typed change handlers that update
// local state and PATCH in lockstep. StepCard.tsx becomes a presentational
// shell over this hook.

import { useState } from "react";

import { updatePipelineStep } from "../services/pipelineService";
import {
  aggregateConfigOf,
  castsOf,
  computeConfigOf,
  filterConfigOf,
  limitCountOf,
  renamesOf,
  selectedFieldsOf,
  sortConfigOf,
} from "../state/stepNarrowing";
import type { PipelineStepConfig } from "../types/pipelineStep";
import type { Step } from "../types/step";
import type { AggregateConfigValue } from "../ui/AggregateConfig";
import type { ComputeConfigValue } from "../ui/ComputeFieldConfig";
import type { FilterConfigValue } from "../ui/FilterConfig";
import type { SortKey } from "../ui/SortConfig";

export interface StepCardStateHandlers {
  selectedFields: string[];
  renames: Record<string, string>;
  casts: Record<string, string>;
  filterConfig: FilterConfigValue;
  computeConfig: ComputeConfigValue;
  aggregateConfig: AggregateConfigValue;
  limitCount: number;
  sortConfig: SortKey[];
  onFieldToggle: (field: string, checked: boolean) => void;
  onRenameChange: (field: string, newName: string) => void;
  onCastChange: (field: string, targetType: string) => void;
  onFilterChange: (config: FilterConfigValue) => void;
  onComputeChange: (config: ComputeConfigValue) => void;
  onAggregateChange: (config: AggregateConfigValue) => void;
  onLimitChange: (config: { count: number }) => void;
  onSortChange: (config: { sortBy: SortKey[] }) => void;
}

export function useStepCardState(
  step: Step,
  /** Called after a successful PATCH so the parent can keep step.config in sync. */
  onConfigChange: (stepId: string, config: PipelineStepConfig) => void,
): StepCardStateHandlers {
  // Derived state: sync local editor state when the persisted config or
  // opType changes (during-render pattern). CS2c-3a: `step.config` is
  // already a typed object, so the narrowing helpers replace the per-render
  // JSON parsing the pre-CS2c-3a editor performed.
  const [prevConfig, setPrevConfig] = useState(step.config);
  const [prevOpTypeId, setPrevOpTypeId] = useState(step.opType.id);
  const [selectedFields, setSelectedFields] = useState<string[]>(() => selectedFieldsOf(step));
  const [renames, setRenames] = useState<Record<string, string>>(() => renamesOf(step));
  const [casts, setCasts] = useState<Record<string, string>>(() => castsOf(step));
  const [filterConfig, setFilterConfig] = useState<FilterConfigValue>(() => filterConfigOf(step));
  const [computeConfig, setComputeConfig] = useState<ComputeConfigValue>(() =>
    computeConfigOf(step),
  );
  const [aggregateConfig, setAggregateConfig] = useState<AggregateConfigValue>(() =>
    aggregateConfigOf(step),
  );
  const [limitCount, setLimitCount] = useState<number>(() => limitCountOf(step));
  const [sortConfig, setSortConfig] = useState<SortKey[]>(() => sortConfigOf(step));
  if (prevConfig !== step.config || prevOpTypeId !== step.opType.id) {
    setPrevConfig(step.config);
    setPrevOpTypeId(step.opType.id);
    setSelectedFields(selectedFieldsOf(step));
    setRenames(renamesOf(step));
    setCasts(castsOf(step));
    setFilterConfig(filterConfigOf(step));
    setComputeConfig(computeConfigOf(step));
    setAggregateConfig(aggregateConfigOf(step));
    setLimitCount(limitCountOf(step));
    setSortConfig(sortConfigOf(step));
  }

  /** Shared persistence path — PATCHes the typed config, then notifies the
   *  parent. Local editor state is updated by the caller (so the UI stays
   *  responsive regardless of network result). */
  function persist(newConfig: PipelineStepConfig): void {
    void updatePipelineStep(step.id, newConfig)
      .then(() => {
        onConfigChange(step.id, newConfig);
      })
      .catch(() => {
        // No-op: local state always reflects user intent even if PATCH fails.
      });
  }

  function onFieldToggle(field: string, checked: boolean) {
    const next = checked ? [...selectedFields, field] : selectedFields.filter((f) => f !== field);
    setSelectedFields(next);
    persist({ fields: next });
  }

  function onRenameChange(field: string, newName: string) {
    const next = { ...renames };
    if (newName) next[field] = newName;
    else delete next[field];
    setRenames(next);
    persist({ renames: next });
  }

  function onCastChange(field: string, targetType: string) {
    const next = { ...casts };
    if (targetType) next[field] = targetType;
    else delete next[field];
    setCasts(next);
    persist({ casts: next });
  }

  function onFilterChange(newConfig: FilterConfigValue) {
    setFilterConfig(newConfig);
    persist({
      combinator: newConfig.combinator,
      conditions: newConfig.conditions,
    });
  }

  function onComputeChange(newConfig: ComputeConfigValue) {
    setComputeConfig(newConfig);
    persist(newConfig);
  }

  function onAggregateChange(newConfig: AggregateConfigValue) {
    setAggregateConfig(newConfig);
    persist(newConfig);
  }

  function onLimitChange(newConfig: { count: number }) {
    setLimitCount(newConfig.count);
    persist(newConfig);
  }

  function onSortChange(newConfig: { sortBy: SortKey[] }) {
    setSortConfig(newConfig.sortBy);
    persist(newConfig);
  }

  return {
    selectedFields,
    renames,
    casts,
    filterConfig,
    computeConfig,
    aggregateConfig,
    limitCount,
    sortConfig,
    onFieldToggle,
    onRenameChange,
    onCastChange,
    onFilterChange,
    onComputeChange,
    onAggregateChange,
    onLimitChange,
    onSortChange,
  };
}
