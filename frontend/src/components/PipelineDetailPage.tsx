import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import "./PipelineDetailPage.css";
import { fetchSources } from "../features/sources/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { fetchPipelines } from "../services/pipelineService";
import type { DataSource, Pipeline } from "../types/models";

// ── Op types ────────────────────────────────────────────────────────────────

interface OpType {
  id: string;
  label: string;
  icon: string;
}

const OP_TYPES: OpType[] = [
  { id: "rename", label: "Rename column", icon: "✏️" },
  { id: "filter", label: "Filter rows", icon: "🔍" },
  { id: "join", label: "Join tables", icon: "🔗" },
  { id: "compute", label: "Compute column", icon: "🧮" },
  { id: "aggregate", label: "Group & aggregate", icon: "📊" },
  { id: "cast", label: "Cast type", icon: "⇄" },
];

// ── Step data ────────────────────────────────────────────────────────────────

interface Step {
  id: string;
  opType: OpType;
  label: string;
  rowCount: number;
}

let stepCounter = 0;
function makeStep(opType: OpType): Step {
  stepCounter += 1;
  return {
    id: `step-${stepCounter}`,
    opType,
    label: opType.label,
    rowCount: Math.floor(Math.random() * 50000) + 1000,
  };
}

// ── Static SVG ribbon ────────────────────────────────────────────────────────

function RibbonSegment() {
  return (
    <svg
      className="pipeline-detail-page__ribbon"
      viewBox="0 0 800 50"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {/* Band 1 */}
      <path
        d="M0,5 C400,5 400,5 800,5 L800,15 C400,15 400,15 0,15 Z"
        fill="var(--app-accent)"
        fillOpacity="0.15"
        stroke="var(--app-accent)"
        strokeOpacity="0.3"
        strokeWidth="0.5"
      />
      {/* Band 2 */}
      <path
        d="M0,17 C400,17 400,17 800,17 L800,28 C400,28 400,28 0,28 Z"
        fill="var(--app-accent-strong)"
        fillOpacity="0.12"
        stroke="var(--app-accent-strong)"
        strokeOpacity="0.25"
        strokeWidth="0.5"
      />
      {/* Band 3 */}
      <path
        d="M0,30 C400,30 400,30 800,30 L800,38 C400,38 400,38 0,38 Z"
        fill="var(--app-accent)"
        fillOpacity="0.08"
        stroke="var(--app-accent)"
        strokeOpacity="0.2"
        strokeWidth="0.5"
      />
      {/* Band 4 */}
      <path
        d="M0,40 C400,40 400,40 800,40 L800,46 C400,46 400,46 0,46 Z"
        fill="var(--app-accent-mid)"
        fillOpacity="0.1"
        stroke="var(--app-accent-mid)"
        strokeOpacity="0.2"
        strokeWidth="0.5"
      />
    </svg>
  );
}

// ── Op-type dropdown ─────────────────────────────────────────────────────────

interface OpDropdownProps {
  onSelect: (opType: OpType) => void;
  onClose: () => void;
}

function OpDropdown({ onSelect, onClose }: OpDropdownProps) {
  const ref = useRef<HTMLUListElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <ul className="pipeline-detail-page__op-dropdown" ref={ref} role="menu">
      {OP_TYPES.map((op) => (
        <li key={op.id} role="none">
          <button
            type="button"
            role="menuitem"
            className="pipeline-detail-page__op-dropdown-item"
            onClick={() => {
              onSelect(op);
              onClose();
            }}
          >
            <span aria-hidden="true">{op.icon}</span> {op.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── Step card ────────────────────────────────────────────────────────────────

interface StepCardProps {
  step: Step;
  onRemove: (id: string) => void;
}

function StepCard({ step, onRemove }: StepCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`pipeline-detail-page__step-card${expanded ? " pipeline-detail-page__step-card--expanded" : ""}`}
    >
      <button
        type="button"
        className="pipeline-detail-page__step-card-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="pipeline-detail-page__step-card-icon" aria-hidden="true">
          {step.opType.icon}
        </span>
        <span className="pipeline-detail-page__step-card-label">{step.label}</span>
        <span className="pipeline-detail-page__step-card-count">
          {step.rowCount.toLocaleString()} rows
        </span>
        <span
          className={`pipeline-detail-page__step-card-chevron${expanded ? " pipeline-detail-page__step-card-chevron--open" : ""}`}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>

      {expanded && (
        <div className="pipeline-detail-page__step-card-body">
          <p className="pipeline-detail-page__step-card-desc">
            Configure this {step.opType.label.toLowerCase()} step.
          </p>
          <div className="pipeline-detail-page__step-card-diff">
            <span className="pipeline-detail-page__step-card-diff-chip pipeline-detail-page__step-card-diff-chip--added">
              + col_a
            </span>
            <span className="pipeline-detail-page__step-card-diff-chip pipeline-detail-page__step-card-diff-chip--removed">
              − col_b
            </span>
            <span className="pipeline-detail-page__step-card-diff-chip pipeline-detail-page__step-card-diff-chip--changed">
              ~ col_c
            </span>
          </div>
          <div className="pipeline-detail-page__step-card-actions">
            <button type="button" className="pipeline-detail-page__step-card-preview-btn">
              Preview data
            </button>
            <button
              type="button"
              className="pipeline-detail-page__step-card-remove-btn"
              onClick={() => onRemove(step.id)}
            >
              Remove step
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Source chip ──────────────────────────────────────────────────────────────

interface SourceChipProps {
  source: DataSource;
}

function SourceChip({ source }: SourceChipProps) {
  const [active, setActive] = useState(true);
  const [previewing, setPreviewing] = useState(false);

  const mockRows = [
    ["id", "name", "value"],
    ["1", "Alpha", "42"],
    ["2", "Beta", "91"],
    ["3", "Gamma", "17"],
  ];

  return (
    <div className="pipeline-detail-page__source-chip-wrapper">
      <div
        className={`pipeline-detail-page__source-chip${active ? " pipeline-detail-page__source-chip--active" : ""}`}
      >
        <button
          type="button"
          className="pipeline-detail-page__source-chip-toggle"
          onClick={() => setActive((v) => !v)}
          aria-pressed={active}
        >
          <span className="pipeline-detail-page__source-chip-name">{source.name}</span>
          <span className="pipeline-detail-page__source-chip-count">—</span>
        </button>
        <button
          type="button"
          className="pipeline-detail-page__source-chip-preview-btn"
          onClick={() => setPreviewing((v) => !v)}
          aria-label={`Preview ${source.name}`}
          aria-pressed={previewing}
          title="Preview data"
        >
          ⊞
        </button>
      </div>

      {previewing && active && (
        <div className="pipeline-detail-page__source-preview">
          <table className="pipeline-detail-page__source-preview-table">
            <thead>
              <tr>
                {mockRows[0].map((col) => (
                  <th key={col} className="pipeline-detail-page__source-preview-th">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mockRows.slice(1).map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className="pipeline-detail-page__source-preview-td">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function PipelineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const dispatch = useAppDispatch();
  const { items: sources, status: sourcesStatus } = useAppSelector((state) => state.sources);

  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [dropdownOpenAt, setDropdownOpenAt] = useState<"bottom" | null>(null);
  const [outputName, setOutputName] = useState("");
  const [editingOutputName, setEditingOutputName] = useState(false);

  useEffect(() => {
    if (sourcesStatus === "idle") {
      void dispatch(fetchSources());
    }
  }, [dispatch, sourcesStatus]);

  useEffect(() => {
    fetchPipelines()
      .then((items) => {
        const found = items.find((p) => p.id === id);
        if (found) {
          setPipeline(found);
          setOutputName(found.name);
        }
      })
      .catch(() => {
        // degrade gracefully — show id as name
      });
  }, [id]);

  const pipelineName = pipeline?.name ?? id ?? "Pipeline";

  function handleAddStep(opType: OpType) {
    setSteps((prev) => [...prev, makeStep(opType)]);
  }

  function handleRemoveStep(stepId: string) {
    setSteps((prev) => prev.filter((s) => s.id !== stepId));
  }

  function handleRunPipeline() {
    window.alert("Pipeline execution coming soon");
  }

  return (
    <div className="pipeline-detail-page">
      {/* ── Source selector bar ── */}
      <div className="pipeline-detail-page__source-bar">
        <span className="pipeline-detail-page__source-bar-label">DATA SOURCES</span>
        <div className="pipeline-detail-page__source-chips">
          {sourcesStatus === "loading" && (
            <span className="pipeline-detail-page__source-bar-loading">Loading…</span>
          )}
          {sources.map((source) => (
            <SourceChip key={source.id} source={source} />
          ))}
          <button type="button" className="pipeline-detail-page__connect-source-btn">
            + Connect source
          </button>
        </div>
      </div>

      {/* ── River view ── */}
      <div className="pipeline-detail-page__river">
        <div className="pipeline-detail-page__river-inner">
          {steps.length === 0 ? (
            <div className="pipeline-detail-page__empty-state">
              <p className="pipeline-detail-page__empty-state-text">
                Add your first transformation step
              </p>
              <button
                type="button"
                className="pipeline-detail-page__add-step-btn"
                onClick={() => setDropdownOpenAt("bottom")}
              >
                + Add step
              </button>
              {dropdownOpenAt === "bottom" && (
                <OpDropdown onSelect={handleAddStep} onClose={() => setDropdownOpenAt(null)} />
              )}
            </div>
          ) : (
            <>
              <RibbonSegment />
              {steps.map((step, idx) => (
                <div key={step.id} className="pipeline-detail-page__step-section">
                  <StepCard step={step} onRemove={handleRemoveStep} />
                  {idx < steps.length - 1 && <RibbonSegment />}
                </div>
              ))}
              <div className="pipeline-detail-page__add-step-row">
                <button
                  type="button"
                  className="pipeline-detail-page__add-step-dashed-btn"
                  onClick={() => setDropdownOpenAt("bottom")}
                >
                  + Add transformation step
                </button>
                {dropdownOpenAt === "bottom" && (
                  <OpDropdown onSelect={handleAddStep} onClose={() => setDropdownOpenAt(null)} />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Footer bar ── */}
      <div className="pipeline-detail-page__footer">
        <div className="pipeline-detail-page__footer-left">
          <span className="pipeline-detail-page__footer-output-label">OUTPUT</span>
          {editingOutputName ? (
            <input
              className="pipeline-detail-page__footer-output-input"
              value={outputName}
              aria-label="Output name"
              onChange={(e) => setOutputName(e.target.value)}
              onBlur={() => setEditingOutputName(false)}
              autoFocus
            />
          ) : (
            <button
              type="button"
              className="pipeline-detail-page__footer-output-name"
              onClick={() => setEditingOutputName(true)}
              aria-label="Edit output name"
            >
              {outputName || pipelineName}
            </button>
          )}
          <span className="pipeline-detail-page__footer-schema">
            <span className="pipeline-detail-page__footer-schema-chip">id</span>
            <span className="pipeline-detail-page__footer-schema-chip">name</span>
            <span className="pipeline-detail-page__footer-schema-chip">value</span>
            <em className="pipeline-detail-page__footer-inferred">inferred</em>
          </span>
        </div>
        <div className="pipeline-detail-page__footer-right">
          <span className="pipeline-detail-page__footer-stats">
            {steps.length} step{steps.length !== 1 ? "s" : ""}
          </span>
          <button type="button" className="pipeline-detail-page__preview-btn">
            Preview
          </button>
          <button
            type="button"
            className="pipeline-detail-page__run-btn"
            onClick={handleRunPipeline}
          >
            Run pipeline ▶
          </button>
        </div>
      </div>

      {/* ── Back breadcrumb shown inside page ── */}
      <nav className="pipeline-detail-page__back-nav" aria-label="Breadcrumb">
        <Link to="/pipelines" className="pipeline-detail-page__back-link">
          ← Data Pipelines
        </Link>
        <span className="pipeline-detail-page__back-sep" aria-hidden="true">
          /
        </span>
        <span className="pipeline-detail-page__back-current">{pipelineName}</span>
      </nav>
    </div>
  );
}
