import "./PipelineProposalReview.css";
import type {
  PipelineProposal,
  PipelineProposalOutput,
  PipelineProposalStep,
} from "../../types/pipelineProposal";
import { buildProposalLaneGraph } from "../../utils/proposalLaneGraph";
import { secondaryInputOf } from "../../state/laneLayout";
import type { PipelineStepConfig } from "../../types/pipelineStep";

/** Truncated, best-effort JSON summary of a step/source's `config` — never a
 *  per-kind switch (design.md D4). A step kind the frontend doesn't yet
 *  recognize still renders this way instead of crashing. */
function summarizeConfig(config: Record<string, unknown> | undefined): string {
  if (!config || Object.keys(config).length === 0) return "—";
  const json = JSON.stringify(config);
  return json.length > 140 ? `${json.slice(0, 140)}…` : json;
}

function SourceSummary({ source }: { source: PipelineProposal["roots"][number] }) {
  if (source.sourceId) {
    return (
      <dl className="pipeline-proposal-review__meta">
        <div className="pipeline-proposal-review__meta-row">
          <dt>Source</dt>
          <dd className="mono">Existing source ({source.sourceId})</dd>
        </div>
      </dl>
    );
  }

  const configEntries = Object.entries(source.config ?? {});
  return (
    <dl className="pipeline-proposal-review__meta">
      <div className="pipeline-proposal-review__meta-row">
        <dt>Source</dt>
        <dd className="mono">
          New {source.type ?? "unknown"} source{source.name ? ` "${source.name}"` : ""}
        </dd>
      </div>
      {configEntries.map(([key, value]) => (
        <div key={key} className="pipeline-proposal-review__meta-row">
          <dt>{key}</dt>
          <dd className="mono">{typeof value === "string" ? value : JSON.stringify(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** HEL-914 task 6.8: `step`'s config, when it names a `lane`-kind secondary input (a rejoin --
 *  join/union/lookup consuming another node's frame instead of a fresh DataSource), surfaces
 *  that second input's step clientId. `secondaryInputOf` is the SAME shape-check
 *  `computeLaneLayout` already uses to build `rejoinEdges` -- reused here, not re-derived. */
function rejoinSecondInputOf(step: PipelineProposalStep): string | undefined {
  const secondary = secondaryInputOf(step.config as unknown as PipelineStepConfig);
  return secondary?.kind === "lane" ? secondary.stepId : undefined;
}

function StepRow({
  step,
  index,
  outputsByStep,
}: {
  step: PipelineProposalStep;
  index: number;
  outputsByStep: Map<string, PipelineProposalOutput[]>;
}) {
  const rejoinTarget = rejoinSecondInputOf(step);
  const boundOutputs = outputsByStep.get(step.clientId) ?? [];
  return (
    <li className="pipeline-proposal-review__step">
      <div className="pipeline-proposal-review__step-head">
        <span className="pipeline-proposal-review__step-index mono">{index + 1}</span>
        <span className="pipeline-proposal-review__type">{step.type}</span>
        {step.enabled === false && (
          <span className="pipeline-proposal-review__disabled">Disabled</span>
        )}
      </div>
      {!step.parentStepId && step.rootClientId && (
        <p className="pipeline-proposal-review__step-config mono">root: {step.rootClientId}</p>
      )}
      {rejoinTarget && (
        <p className="pipeline-proposal-review__step-config mono">
          second input (rejoin): step {rejoinTarget}
        </p>
      )}
      <p className="pipeline-proposal-review__step-config mono">{summarizeConfig(step.config)}</p>
      {boundOutputs.length > 0 && (
        <p className="pipeline-proposal-review__step-config mono">
          Outputs: {boundOutputs.map((o) => o.name).join(", ")}
        </p>
      )}
    </li>
  );
}

/** One proposed Output (HEL-907 task 4.1 — replaces the retired single
 *  `outputDataTypeName` row). `nodeStepClientId` absent means it attaches
 *  directly to a root. */
function OutputRow({ output, index }: { output: PipelineProposalOutput; index: number }) {
  return (
    <li className="pipeline-proposal-review__step">
      <div className="pipeline-proposal-review__step-head">
        <span className="pipeline-proposal-review__step-index mono">{index + 1}</span>
        <span className="pipeline-proposal-review__type">{output.kind}</span>
      </div>
      <dl className="pipeline-proposal-review__meta">
        <div className="pipeline-proposal-review__meta-row">
          <dt>Name</dt>
          <dd className="mono">{output.name}</dd>
        </div>
        <div className="pipeline-proposal-review__meta-row">
          <dt>Attached to</dt>
          <dd className="mono">
            {output.nodeStepClientId ? `step ${output.nodeStepClientId}` : "a root"}
          </dd>
        </div>
      </dl>
    </li>
  );
}

interface PipelineProposalSummaryProps {
  proposal: PipelineProposal;
}

/** Read-only render of a `PipelineProposal`'s roots, lane structure, and
 *  proposed Outputs (design.md D4/D5, HEL-914 task 6.8) — reused unmodified inside
 *  `CombinedProposalReview`. Renders nothing else; the Modal chrome +
 *  Accept/Reject footer live in the wrapping `PipelineProposalReview`. */
export function PipelineProposalSummary({ proposal }: PipelineProposalSummaryProps) {
  const stepByClientId = new Map(proposal.steps.map((s) => [s.clientId, s]));
  const outputsByStep = new Map<string, PipelineProposalOutput[]>();
  for (const output of proposal.outputs ?? []) {
    if (!output.nodeStepClientId) continue;
    const existing = outputsByStep.get(output.nodeStepClientId);
    if (existing) existing.push(output);
    else outputsByStep.set(output.nodeStepClientId, [output]);
  }
  const { graph } = buildProposalLaneGraph(proposal.steps);

  return (
    <div className="pipeline-proposal-review__summary">
      <section aria-label="Proposed roots">
        <p className="eyebrow pipeline-proposal-review__section-label">
          {proposal.roots.length} root{proposal.roots.length === 1 ? "" : "s"}
        </p>
        {proposal.roots.map((root, index) => (
          <div key={root.clientId ?? index} className="pipeline-proposal-review__step">
            <div className="pipeline-proposal-review__step-head">
              <span className="pipeline-proposal-review__step-index mono">{index + 1}</span>
            </div>
            <SourceSummary source={root} />
          </div>
        ))}
      </section>

      <section aria-label="Proposed steps">
        <p className="eyebrow pipeline-proposal-review__section-label">
          {proposal.steps.length} step{proposal.steps.length === 1 ? "" : "s"}
          {graph.lanes.length > 1 ? ` across ${graph.lanes.length} lanes` : ""}
        </p>
        {proposal.steps.length === 0 ? (
          <p className="pipeline-proposal-review__empty">No transform steps proposed.</p>
        ) : (
          graph.lanes.map((lane) => (
            <div key={lane.id} className="pipeline-proposal-review__lane">
              <p className="pipeline-proposal-review__lane-label mono">
                {lane.id === graph.primaryLaneId
                  ? "Primary lane"
                  : `Lane branching off step ${lane.parentStepId}`}
              </p>
              <ul className="pipeline-proposal-review__steps">
                {lane.steps.map((laneStep) => {
                  const original = stepByClientId.get(laneStep.id);
                  if (!original) return null;
                  const overallIndex = proposal.steps.indexOf(original);
                  return (
                    <StepRow
                      key={laneStep.id}
                      step={original}
                      index={overallIndex}
                      outputsByStep={outputsByStep}
                    />
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>

      <section aria-label="Proposed outputs">
        <p className="eyebrow pipeline-proposal-review__section-label">
          {(proposal.outputs ?? []).length} Output{(proposal.outputs ?? []).length === 1 ? "" : "s"}
        </p>
        {(proposal.outputs ?? []).length === 0 ? (
          <p className="pipeline-proposal-review__empty">No Outputs proposed yet.</p>
        ) : (
          <ul className="pipeline-proposal-review__steps">
            {(proposal.outputs ?? []).map((output, index) => (
              <OutputRow key={index} output={output} index={index} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
