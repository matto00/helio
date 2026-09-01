import "./PipelineProposalReview.css";
import type {
  PipelineProposal,
  PipelineProposalOutput,
  PipelineProposalStep,
} from "../../types/pipelineProposal";

/** Truncated, best-effort JSON summary of a step/source's `config` — never a
 *  per-kind switch (design.md D4). A step kind the frontend doesn't yet
 *  recognize still renders this way instead of crashing. */
function summarizeConfig(config: Record<string, unknown> | undefined): string {
  if (!config || Object.keys(config).length === 0) return "—";
  const json = JSON.stringify(config);
  return json.length > 140 ? `${json.slice(0, 140)}…` : json;
}

function SourceSummary({ source }: { source: PipelineProposal["source"] }) {
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

function StepRow({ step, index }: { step: PipelineProposalStep; index: number }) {
  return (
    <li className="pipeline-proposal-review__step">
      <div className="pipeline-proposal-review__step-head">
        <span className="pipeline-proposal-review__step-index mono">{index + 1}</span>
        <span className="pipeline-proposal-review__type">{step.type}</span>
        {step.enabled === false && (
          <span className="pipeline-proposal-review__disabled">Disabled</span>
        )}
      </div>
      <p className="pipeline-proposal-review__step-config mono">{summarizeConfig(step.config)}</p>
    </li>
  );
}

/** One proposed Output (HEL-907 task 4.1 — replaces the retired single
 *  `outputDataTypeName` row). `nodeStepClientId` absent means it attaches
 *  directly to the pipeline's source. */
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
            {output.nodeStepClientId ? `step ${output.nodeStepClientId}` : "source"}
          </dd>
        </div>
      </dl>
    </li>
  );
}

interface PipelineProposalSummaryProps {
  proposal: PipelineProposal;
}

/** Read-only render of a `PipelineProposal`'s source, ordered steps, and
 *  proposed Outputs (design.md D4/D5, retargeted HEL-907 task 4.1) — reused unmodified inside
 *  `CombinedProposalReview`. Renders nothing else; the Modal chrome +
 *  Accept/Reject footer live in the wrapping `PipelineProposalReview`. */
export function PipelineProposalSummary({ proposal }: PipelineProposalSummaryProps) {
  return (
    <div className="pipeline-proposal-review__summary">
      <section aria-label="Proposed source">
        <p className="eyebrow pipeline-proposal-review__section-label">Source</p>
        <SourceSummary source={proposal.source} />
      </section>

      <section aria-label="Proposed steps">
        <p className="eyebrow pipeline-proposal-review__section-label">
          {proposal.steps.length} step{proposal.steps.length === 1 ? "" : "s"}
        </p>
        {proposal.steps.length === 0 ? (
          <p className="pipeline-proposal-review__empty">No transform steps proposed.</p>
        ) : (
          <ul className="pipeline-proposal-review__steps">
            {proposal.steps.map((step, index) => (
              <StepRow key={index} step={step} index={index} />
            ))}
          </ul>
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
