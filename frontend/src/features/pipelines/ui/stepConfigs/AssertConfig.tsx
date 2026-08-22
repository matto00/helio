// AssertConfig — rule-row editor for the "assert" pipeline op (HEL-454 /
// 419-A). Renders one row per configured rule (kind select, field select
// shown only for field-requiring kinds, kind-specific params inputs,
// severity select, remove button) plus an add-rule button — mirrors
// AggregateConfig.tsx's aggregation-row structure (add/remove rows, no
// section headers needed for a single flat list) with WindowConfig.tsx's
// per-kind conditional-field pattern (design.md Decision 4: `notNull`/
// `unique`/`range`/`regex` require `field`; `rowCountMin`/`rowCountMax` are
// dataset-level and never show the field picker). This is the identity
// pass-through step's editor — no evaluation/results UI (419-B).

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

import { Select, TextField } from "../../../../shared/ui/index";
import type { SchemaField } from "../../types/pipelineStep";

export const ASSERT_RULE_KINDS = [
  "notNull",
  "unique",
  "range",
  "rowCountMin",
  "rowCountMax",
  "regex",
] as const;

export type AssertRuleKind = (typeof ASSERT_RULE_KINDS)[number];

/** Kinds that reference a specific `field` (design.md Decision 4 — used
 *  identically by the backend's `PipelineAnalyzeService.inferAssert`). */
const FIELD_REQUIRED_KINDS: readonly AssertRuleKind[] = ["notNull", "unique", "range", "regex"];

export const ASSERT_SEVERITIES = ["warn", "error"] as const;
export type AssertSeverity = (typeof ASSERT_SEVERITIES)[number];

const KIND_OPTIONS = ASSERT_RULE_KINDS.map((kind) => ({ value: kind, label: kind }));
const SEVERITY_OPTIONS = ASSERT_SEVERITIES.map((severity) => ({
  value: severity,
  label: severity,
}));

export interface AssertRuleValue {
  kind: string;
  field?: string | null;
  params: Record<string, unknown>;
  severity: string;
}

export interface AssertConfigValue {
  rules: AssertRuleValue[];
}

interface AssertConfigProps {
  /** Parsed config object from the step's persisted config. */
  config: AssertConfigValue;
  /** Full schema fields from the analyze endpoint's inputSchema — field selector for field-requiring kinds. */
  analyzeSchema: SchemaField[];
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: AssertConfigValue) => void;
}

function numberParam(params: Record<string, unknown>, key: string): number | "" {
  const value = params[key];
  return typeof value === "number" ? value : "";
}

function stringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

export function AssertConfig({ config, analyzeSchema, onChange }: AssertConfigProps) {
  function emit(next: AssertConfigValue) {
    onChange(next);
  }

  function handleRuleChange(index: number, updated: AssertRuleValue) {
    const rules = config.rules.map((r, i) => (i === index ? updated : r));
    emit({ ...config, rules });
  }

  function handleAddRule() {
    const defaultField = analyzeSchema.length > 0 ? analyzeSchema[0].name : "";
    const newRule: AssertRuleValue = {
      kind: "notNull",
      field: defaultField,
      params: {},
      // New-rule default is "error" — deliberately different from the
      // decode-tolerance default of "warn" (design.md Decision 3).
      severity: "error",
    };
    emit({ ...config, rules: [...config.rules, newRule] });
  }

  function handleRemoveRule(index: number) {
    const rules = config.rules.filter((_, i) => i !== index);
    emit({ ...config, rules });
  }

  function handleParamChange(index: number, key: string, value: number | string | undefined) {
    const rule = config.rules[index];
    const params = { ...rule.params };
    if (value === undefined || value === "") delete params[key];
    else params[key] = value;
    handleRuleChange(index, { ...rule, params });
  }

  return (
    <div className="pipeline-detail-page__aggregate-config">
      <div className="pipeline-detail-page__aggregate-section">
        <span className="pipeline-detail-page__aggregate-section-label">Assertion rules</span>
        <p className="pipeline-detail-page__aggregate-section-description">
          Rules are recorded now; evaluating them against run data comes in a later step. Rows pass
          through unchanged.
        </p>

        <div className="pipeline-detail-page__aggregate-agg-rows">
          {config.rules.map((rule, index) => {
            const kind = rule.kind as AssertRuleKind;
            const showField = FIELD_REQUIRED_KINDS.includes(kind);

            return (
              <div key={index} className="pipeline-detail-page__aggregate-agg-row">
                {/* Kind dropdown */}
                <Select
                  ariaLabel={`Kind for rule ${index + 1}`}
                  value={rule.kind}
                  options={KIND_OPTIONS}
                  onChange={(next) => handleRuleChange(index, { ...rule, kind: next })}
                />

                {/* Field dropdown — only for field-requiring kinds */}
                {showField && (
                  <Select
                    ariaLabel={`Field for rule ${index + 1}`}
                    value={rule.field ?? ""}
                    placeholder="— select field —"
                    options={analyzeSchema.map((f) => ({ value: f.name, label: f.name }))}
                    onChange={(next) => handleRuleChange(index, { ...rule, field: next })}
                  />
                )}

                {/* Kind-specific params */}
                {kind === "range" && (
                  <>
                    <TextField
                      type="number"
                      aria-label={`Minimum for rule ${index + 1}`}
                      placeholder="min"
                      value={numberParam(rule.params, "min")}
                      onChange={(e) =>
                        handleParamChange(
                          index,
                          "min",
                          e.target.value === "" ? undefined : Number(e.target.value),
                        )
                      }
                    />
                    <TextField
                      type="number"
                      aria-label={`Maximum for rule ${index + 1}`}
                      placeholder="max"
                      value={numberParam(rule.params, "max")}
                      onChange={(e) =>
                        handleParamChange(
                          index,
                          "max",
                          e.target.value === "" ? undefined : Number(e.target.value),
                        )
                      }
                    />
                  </>
                )}

                {(kind === "rowCountMin" || kind === "rowCountMax") && (
                  <TextField
                    type="number"
                    aria-label={`Row count for rule ${index + 1}`}
                    placeholder="count"
                    value={numberParam(rule.params, "count")}
                    onChange={(e) =>
                      handleParamChange(
                        index,
                        "count",
                        e.target.value === "" ? undefined : Number(e.target.value),
                      )
                    }
                  />
                )}

                {kind === "regex" && (
                  <TextField
                    aria-label={`Pattern for rule ${index + 1}`}
                    placeholder="pattern"
                    value={stringParam(rule.params, "pattern")}
                    onChange={(e) => handleParamChange(index, "pattern", e.target.value)}
                  />
                )}

                {/* Severity dropdown */}
                <Select
                  ariaLabel={`Severity for rule ${index + 1}`}
                  value={rule.severity}
                  options={SEVERITY_OPTIONS}
                  onChange={(next) => handleRuleChange(index, { ...rule, severity: next })}
                />

                {/* Remove button */}
                <button
                  type="button"
                  className="pipeline-detail-page__row-remove-btn"
                  aria-label={`Remove rule ${index + 1}`}
                  onClick={() => handleRemoveRule(index)}
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="pipeline-detail-page__filter-add-btn"
          onClick={handleAddRule}
        >
          + Add rule
        </button>
      </div>
    </div>
  );
}
