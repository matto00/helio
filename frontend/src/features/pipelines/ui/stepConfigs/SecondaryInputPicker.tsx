// SecondaryInputPicker — HEL-912 task 5.3. A single picker for `union`/
// `lookup`'s `SecondaryInput` (P2.1 engine contract item 1): a "data
// source" option group (unchanged from HEL-911) plus an "other lane"
// option group listing every other node in the pipeline.
//
// Eligibility is a PROPERTY, not a name list (design.md Decision 3 / task
// 5.4): every node except the configuring step itself is offered; ONLY the
// step's own ancestors are disabled, each with a visible cycle reason.
// There is deliberately no terminal-only filter, no single-consumer
// filter, and no left-of/above-of ordering filter — the P2.1 engine
// contract (items 6, 6b) permits all three shapes, and 6b names exactly
// this mistake.

import { useEffect } from "react";

import { fetchSources } from "../../../sources/state/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import { Select } from "../../../../shared/ui/index";
import { computeAncestorIds } from "../../state/laneLayout";
import type { SecondaryInput } from "../../types/pipelineStep";
import type { Step } from "../../types/step";

interface SecondaryInputPickerProps {
  label: string;
  value: SecondaryInput;
  allSteps: Step[];
  currentStepId: string;
  onChange: (next: SecondaryInput) => void;
}

// A data-source option's value and a lane-node option's value can collide
// (both are arbitrary ids) — encode the option's kind into the `<Select>`
// value so the change handler can unambiguously widen it back out.
const SOURCE_PREFIX = "source:";
const LANE_PREFIX = "lane:";

function encode(input: SecondaryInput): string {
  return input.kind === "source"
    ? `${SOURCE_PREFIX}${input.dataSourceId}`
    : `${LANE_PREFIX}${input.stepId}`;
}

function decode(value: string): SecondaryInput | undefined {
  if (value.startsWith(SOURCE_PREFIX))
    return { kind: "source", dataSourceId: value.slice(SOURCE_PREFIX.length) };
  if (value.startsWith(LANE_PREFIX))
    return { kind: "lane", stepId: value.slice(LANE_PREFIX.length) };
  return undefined;
}

export function SecondaryInputPicker({
  label,
  value,
  allSteps,
  currentStepId,
  onChange,
}: SecondaryInputPickerProps) {
  const dispatch = useAppDispatch();
  const { items: dataSources } = useAppSelector((state) => state.sources);

  useEffect(() => {
    void dispatch(fetchSources());
  }, [dispatch]);

  const ancestorIds = computeAncestorIds(allSteps, currentStepId);

  const sourceOptions = dataSources.map((ds) => ({
    value: `${SOURCE_PREFIX}${ds.id}`,
    label: `Data source: ${ds.name}`,
  }));

  const laneOptions = allSteps
    .filter((s) => s.id !== currentStepId)
    .map((s) => {
      const disabled = ancestorIds.has(s.id);
      return {
        value: `${LANE_PREFIX}${s.id}`,
        label: disabled ? `Lane node: ${s.label} (would create a cycle)` : `Lane node: ${s.label}`,
        disabled,
      };
    });

  return (
    <div className="pipeline-detail-page__compute-field">
      <span className="pipeline-detail-page__compute-label">{label}</span>
      <Select
        ariaLabel={label}
        value={encode(value)}
        placeholder="— select a source or lane node —"
        options={[...sourceOptions, ...laneOptions]}
        onChange={(next) => {
          const decoded = decode(next);
          if (decoded) onChange(decoded);
        }}
      />
    </div>
  );
}
